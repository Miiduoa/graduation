import type { Provider } from './provider';
import { AssistantError } from './publicContext';
export function groqProvider(): Provider {
  const key = process.env.GROQ_API_KEY;
  return {
    name: 'groq',
    model: 'openai/gpt-oss-120b',
    ready: !!key,
    async ask(input) {
      if (!key) throw new AssistantError('PROVIDER_UNAVAILABLE');
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            temperature: 0,
            max_completion_tokens: 512,
            reasoning_effort: 'low',
            include_reasoning: false,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'Return only a JSON object with the requested intent. No tools. Use only the supplied public sources.',
              },
              { role: 'user', content: JSON.stringify(input) },
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AssistantError(
            response.status === 429
              ? 'PROVIDER_RATE_LIMITED'
              : response.status === 401
                ? 'PROVIDER_UNAUTHORIZED'
                : 'PROVIDER_UNAVAILABLE',
            response.status === 429 ? 429 : 503,
          );
        }
        if (!response.body) throw new AssistantError('PROVIDER_INVALID_RESPONSE');
        const reader = response.body.getReader();
        let size = 0;
        const parts: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 8192) throw new AssistantError('PROVIDER_INVALID_RESPONSE');
            parts.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
        const data = JSON.parse(Buffer.concat(parts).toString()) as {
          choices?: { message?: { content?: string; tool_calls?: unknown } }[];
        };
        const message = data.choices?.[0]?.message;
        if (!message?.content || message.tool_calls)
          throw new AssistantError('PROVIDER_INVALID_RESPONSE');
        return JSON.parse(message.content) as unknown;
      } catch (error) {
        if (error instanceof AssistantError) throw error;
        throw new AssistantError(
          error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'PROVIDER_TIMEOUT'
            : 'PROVIDER_INVALID_RESPONSE',
        );
      }
    },
  };
}
