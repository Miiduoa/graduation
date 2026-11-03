import { PublicAgentError } from './contract';
import { PlatformPublicTaskService } from './service';

export type HttpSession = { authorization: string; context: string };
type Options = {
  enabled?: boolean;
  requestTimeoutMs?: number;
  origin: string;
  service: PlatformPublicTaskService;
  /** Trusted BFF adapter: resolve signed HttpOnly platform cookie; never use identity JSON. */
  resolveHttpSession: (request: Request) => Promise<HttpSession>;
};
const prefix = '/api/platform-public-agent/';
const actions = ['preview', 'confirm', 'execute', 'read'] as const;
/** No registration or env switch. The host must explicitly assemble this handler. */
export function createPlatformPublicAgentHandler(options: Options) {
  const origin = new URL(options.origin).origin;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new PublicAgentError('PUBLIC_AGENT_NOT_CONFIGURED', 503);
  if (origin !== options.origin || typeof options.resolveHttpSession !== 'function')
    throw new PublicAgentError('PUBLIC_AGENT_NOT_CONFIGURED', 503);
  const handle = async (request: Request): Promise<Response> => {
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    try {
      if (options.enabled !== true) return reply({ code: 'PUBLIC_AGENT_UNAVAILABLE' }, 404);
      const url = new URL(request.url);
      const action = url.pathname.slice(prefix.length) as (typeof actions)[number];
      if (
        !url.pathname.startsWith(prefix) ||
        !actions.includes(action) ||
        url.search ||
        url.origin !== origin
      )
        return reply({ code: 'PUBLIC_AGENT_NOT_FOUND' }, 404);
      if (request.method !== 'POST') return reply({ code: 'PUBLIC_AGENT_METHOD_NOT_ALLOWED' }, 405);
      if (
        request.headers.get('origin') !== origin ||
        request.headers.get('sec-fetch-site') === 'cross-site' ||
        request.headers.get('x-public-task') !== '1'
      )
        return reply({ code: 'PUBLIC_AGENT_ORIGIN_DENIED' }, 403);
      if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
        return reply({ code: 'PUBLIC_AGENT_INVALID_INPUT' }, 415);
      // Stream-bound before parse; Content-Length alone is not trustworthy.
      const reader = request.body?.getReader();
      if (!reader) return reply({ code: 'PUBLIC_AGENT_INVALID_INPUT' }, 422);
      const cancelBody = () => {
        void reader.cancel().catch(() => {});
      };
      request.signal.addEventListener('abort', cancelBody, { once: true });
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8192) {
            await reader.cancel();
            return reply({ code: 'PUBLIC_AGENT_INPUT_TOO_LARGE' }, 413);
          }
          chunks.push(value);
        }
      } finally {
        request.signal.removeEventListener('abort', cancelBody);
        reader.releaseLock();
      }
      if (request.signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_CANCELLED', 503);
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply({ code: 'PUBLIC_AGENT_INVALID_INPUT' }, 422);
      }
      const session = await options.resolveHttpSession(request);
      if (!session.context || request.headers.get('x-session-context') !== session.context)
        return reply({ code: 'PUBLIC_AGENT_SESSION_CHANGED' }, 409);
      const result = await options.service[action](session.authorization, input, request.signal);
      // Re-resolve the signed session on every delivery, including completed reads.
      const current = await options.resolveHttpSession(request);
      if (current.authorization !== session.authorization || current.context !== session.context)
        return reply({ code: 'PUBLIC_AGENT_SESSION_CHANGED' }, 409);
      return reply(result);
    } catch (error) {
      if (error instanceof PublicAgentError) return reply({ code: error.code }, error.statusCode);
      return reply({ code: 'PUBLIC_AGENT_STATE_UNAVAILABLE' }, 503);
    }
  };
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    let settle!: (response: Response) => void;
    const stopped = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    const halt = () => {
      controller.abort();
      settle(
        new Response(JSON.stringify({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' }), {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        }),
      );
    };
    request.signal.addEventListener('abort', halt, { once: true });
    if (request.signal.aborted) halt();
    const timer = setTimeout(halt, timeoutMs);
    try {
      return await Promise.race([
        handle(new Request(request, { signal: controller.signal })),
        stopped,
      ]);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', halt);
    }
  };
}
