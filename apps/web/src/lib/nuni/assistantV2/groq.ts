import { maskMessages } from './privacy';
import { bounded, bytes, object, V2Error, type Model, type ModelResult, type ToolCall } from './contracts';
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const PROVIDER_USER_MESSAGES: Record<string, string> = {
  PROVIDER_EGRESS_DENIED: '模型服務目前拒絕此主機連線。若未設定備援，請稍後再試或改用校園頁面查詢。',
  PROVIDER_FORBIDDEN: '模型服務拒絕此次連線，請稍後再試或改用校園頁面查詢。',
  PROVIDER_MODEL_FORBIDDEN: '指定模型目前無法使用，請稍後再試或改用校園頁面查詢。',
  PROVIDER_AUTH_FAILED: '模型服務設定有誤，請稍後再試或改用校園頁面查詢。',
  PROVIDER_UNAVAILABLE: '模型服務暫時無法使用，請稍後再試或改用校園頁面查詢。',
  PROVIDER_ALL_FAILED: '主要與備援模型都無法連線，請稍後再試，或改用校園頁面查詢課表、作業與點餐。',
  PROVIDER_NETWORK_ERROR: '無法連線模型服務，請稍後再試或改用校園頁面查詢。',
  PROVIDER_TIMEOUT: '模型回應逾時，請稍後再試。',
  PROVIDER_CIRCUIT_OPEN: '模型服務暫時中斷，請稍後再試或改用校園頁面查詢。',
  PROVIDER_INVALID_RESPONSE: '模型回覆無法使用，請稍後再試。',
  PROVIDER_RATE_LIMITED: '模型查詢次數已達上限，請稍後再試。',
};
export function providerUserMessage(code: string): string {
  return PROVIDER_USER_MESSAGES[code] || '查詢未完成，請稍後再試或改用校園頁面。';
}
export function logProviderError(provider: string, status: number, errorClass: string, providerCode?: string) {
  console.info(
    JSON.stringify({
      event: 'provider.http_error',
      provider,
      status,
      errorClass,
      ...(providerCode ? { providerCode } : {}),
    }),
  );
}
export function fallbackReady(): boolean {
  const account = process.env.CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID?.trim() || '';
  const token = process.env.CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN?.trim() || '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(account) && token.length >= 8 && token.length <= 256;
}
export function fallbackUrl(account: string): string {
  return (
    'https://api.cloudflare.com/client/v4/accounts/' +
    encodeURIComponent(account) +
    '/ai/v1/chat/completions'
  );
}
export function providerError(status: number, body: string, retryAfter?: string | null) {
  const parsed =
    retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : retryAfter
        ? (Date.parse(retryAfter) - Date.now()) / 1000
        : 30;
  const seconds = Math.max(1, Math.min(60, Number.isFinite(parsed) ? Math.ceil(parsed) : 30));
  if (status === 400) {
    let code: unknown;
    try {
      code = JSON.parse(body)?.error?.code;
    } catch {}
    const allowed = [
      'tool_use_failed',
      'json_validate_failed',
      'context_length_exceeded',
      'invalid_request_error',
    ];
    return new V2Error(
      400,
      'PROVIDER_BAD_REQUEST',
      undefined,
      typeof code === 'string' && allowed.includes(code) ? code : 'invalid_request_error',
    );
  }
  if (status === 401) return new V2Error(503, 'PROVIDER_AUTH_FAILED');
  if (status === 403)
    return new V2Error(
      503,
      body.includes('Access denied. Please check your network settings.')
        ? 'PROVIDER_EGRESS_DENIED'
        : /model.*(permission|not allowed|access|blocked)/i.test(body)
          ? 'PROVIDER_MODEL_FORBIDDEN'
          : 'PROVIDER_FORBIDDEN',
    );
  if (status === 429) return new V2Error(429, 'PROVIDER_RATE_LIMITED', seconds);
  return new V2Error(503, 'PROVIDER_UNAVAILABLE');
}
async function body(response: Response, signal: AbortSignal, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new V2Error(502, 'PROVIDER_INVALID_RESPONSE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await bounded(() => reader.read(), signal, 12000);
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        if (!response.ok) {
          chunks.push(value.subarray(0, Math.max(0, max - (size - value.byteLength))));
          break;
        }
        throw new V2Error(502, 'PROVIDER_INVALID_RESPONSE');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    void reader.cancel().catch(() => {});
  }
}
export function groqModel(key: string | undefined, fetcher: typeof fetch = fetch): Model {
  let blockedUntil = 0;
  return async (input) => {
    if (!key) throw new V2Error(503, 'PROVIDER_UNAVAILABLE');
    if (Date.now() < blockedUntil) throw new V2Error(503, 'PROVIDER_CIRCUIT_OPEN');
    const { signal, ...payload } = input;
    let response: Response;
    try {
      response = await fetcher(GROQ_URL, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          messages: maskMessages(payload.messages),
          model: 'openai/gpt-oss-120b',
          reasoning_effort: 'low',
          include_reasoning: false,
        }),
      });
    } catch {
      const code = signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR';
      logProviderError('groq', signal.aborted ? 504 : 0, code);
      throw new V2Error(signal.aborted ? 504 : 503, code);
    }
    const raw = await body(response, signal, response.ok ? 65536 : 2048);
    if (!response.ok) {
      if (response.status === 403) blockedUntil = Date.now() + 60000;
      const error = providerError(response.status, raw, response.headers.get('Retry-After'));
      logProviderError('groq', response.status, error.code, error.providerCode);
      throw error;
    }
    return parseCompletion(raw);
  };
}
function parseCompletion(raw: string, estimate = 0): ModelResult {
  try {
    const data = object(JSON.parse(raw));
    if (!Array.isArray(data.choices) || data.choices.length !== 1) throw new Error();
    const choice = object(data.choices[0]),
      message = object(choice.message);
    const calls = message.tool_calls;
    if (
      calls !== undefined &&
      (!Array.isArray(calls) ||
        calls.length > 16 ||
        calls.some((c) => {
          const v = object(c),
            f = object(v.function);
          return (
            v.type !== 'function' ||
            typeof v.id !== 'string' ||
            v.id.length > 150 ||
            typeof f.name !== 'string' ||
            f.name.length > 100 ||
            typeof f.arguments !== 'string' ||
            f.arguments.length > 8192
          );
        }))
    )
      throw new Error();
    if (
      (!Array.isArray(calls) || !calls.length) &&
      (typeof message.content !== 'string' || !message.content.trim())
    )
      throw new Error();
    const usage = data.usage && typeof data.usage === 'object' ? object(data.usage) : {};
    const complete =
      ['prompt_tokens', 'completion_tokens', 'total_tokens'].every(
        (k) => Number.isSafeInteger(usage[k]) && Number(usage[k]) >= 0,
      ) && usage.total_tokens === Number(usage.prompt_tokens) + Number(usage.completion_tokens);
    const completion = bytes(message.content ?? '') + (calls ? bytes(calls) : 0);
    return {
      message: {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        ...(calls ? { tool_calls: calls as ToolCall[] } : {}),
      },
      usage: complete
        ? (usage as ModelResult['usage'])
        : {
            prompt_tokens: Math.max(1, estimate),
            completion_tokens: completion,
            total_tokens: Math.max(1, estimate) + completion,
          },
      finishReason: String(choice.finish_reason),
    };
  } catch {
    throw new V2Error(502, 'PROVIDER_INVALID_RESPONSE');
  }
}
export function fallbackModel(fetcher: typeof fetch = fetch): Model | null {
  if (!fallbackReady()) return null;
  const account = process.env.CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID!.trim();
  const token = process.env.CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN!.trim();
  const modelName = process.env.CAMPUS_ASSISTANT_V2_FALLBACK_MODEL?.trim() || '@hf/nousresearch/hermes-2-pro-mistral-7b';
  if (!/^@[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(modelName)) return null;
  return async (input) => {
    const { signal, ...payload } = input;
    let response: Response;
    try {
      response = await fetcher(fallbackUrl(account), {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          messages: maskMessages(payload.messages),
          model: modelName,
        }),
      });
    } catch {
      const code = signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR';
      logProviderError('fallback', signal.aborted ? 504 : 0, code);
      throw new V2Error(signal.aborted ? 504 : 503, code);
    }
    const raw = await body(response, signal, response.ok ? 65536 : 2048);
    if (!response.ok) {
      const error = providerError(response.status, raw, response.headers.get('Retry-After'));
      logProviderError('fallback', response.status, error.code, error.providerCode);
      throw error;
    }
    return parseCompletion(raw, bytes({ messages: payload.messages, tools: payload.tools }));
  };
}
export function createProviderModel(fetcher: typeof fetch = fetch): Model {
  const primary = groqModel(process.env.GROQ_API_KEY, fetcher);
  return async (input) => {
    try {
      return await primary(input);
    } catch (error) {
      if (input.signal.aborted) throw error;
      const code = error instanceof V2Error ? error.code : '';
      if (code === 'PROVIDER_BAD_REQUEST') throw error;
      const backup = fallbackModel(fetcher);
      if (!backup) throw error;
      try {
        return await backup(input);
      } catch (fallbackError) {
        if (input.signal.aborted) throw fallbackError;
        throw new V2Error(503, 'PROVIDER_ALL_FAILED');
      }
    }
  };
}
