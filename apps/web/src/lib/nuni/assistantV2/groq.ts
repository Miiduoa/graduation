import { bounded, object, V2Error, type Model, type ModelResult, type ToolCall } from './contracts';
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
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
          model: 'openai/gpt-oss-120b',
          reasoning_effort: 'low',
          include_reasoning: false,
        }),
      });
    } catch {
      throw new V2Error(
        signal.aborted ? 504 : 503,
        signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
      );
    }
    const raw = await body(response, signal, response.ok ? 65536 : 2048);
    if (!response.ok) {
      if (response.status === 403) blockedUntil = Date.now() + 60000;
      throw providerError(response.status, raw, response.headers.get('Retry-After'));
    }
    try {
      const data = object(JSON.parse(raw));
      if (!Array.isArray(data.choices) || data.choices.length !== 1) throw new Error();
      const choice = object(data.choices[0]),
        message = object(choice.message),
        usage = object(data.usage);
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
      if (
        ['prompt_tokens', 'completion_tokens', 'total_tokens'].some(
          (k) => !Number.isSafeInteger(usage[k]) || Number(usage[k]) < 0,
        )
      )
        throw new Error();
      if (usage.total_tokens !== Number(usage.prompt_tokens) + Number(usage.completion_tokens))
        throw new Error();
      return {
        message: {
          role: 'assistant',
          content: typeof message.content === 'string' ? message.content : null,
          ...(calls ? { tool_calls: calls as ToolCall[] } : {}),
        },
        usage: usage as ModelResult['usage'],
        finishReason: String(choice.finish_reason),
      };
    } catch {
      throw new V2Error(502, 'PROVIDER_INVALID_RESPONSE');
    }
  };
}
