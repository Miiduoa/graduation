import { NuniError, nuniRecord } from '@campus/shared/src/nuni';
import { apiOrigin, boundedJson, HANDLE } from './server';
import type { PublicAgentAction, PublicAgentTransport } from './platformPublicAgentGateway';

// Candidate contract shared with the unregistered Fastify adapter; not a registered route.
const PATHS: Record<PublicAgentAction, string> = {
  capability: '/v1/auth/platform/public-agent/capability',
  preview: '/v1/auth/platform/public-agent/preview',
  prepareGroq: '/v1/auth/platform/public-agent/prepareGroq',
  confirm: '/v1/auth/platform/public-agent/confirm',
  execute: '/v1/auth/platform/public-agent/execute',
  route: '/v1/auth/platform/public-agent/route',
  read: '/v1/auth/platform/public-agent/read',
  status: '/v1/auth/platform/public-agent/status',
  reconcile: '/v1/auth/platform/public-agent/reconcile',
  ack: '/v1/auth/platform/public-agent/ack',
};
const FAILURES: Record<string, number> = {
  PUBLIC_AGENT_INVALID_INPUT: 422,
  PUBLIC_AGENT_CONFIRMATION_REQUIRED: 409,
  PUBLIC_AGENT_SESSION_INVALID: 401,
  PUBLIC_AGENT_SESSION_EXPIRED: 401,
  PUBLIC_AGENT_SOURCE_CHANGED: 409,
  PUBLIC_AGENT_SOURCE_UNAVAILABLE: 503,
  PUBLIC_AGENT_DESTINATION_UNCLEAR: 422,
  PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE: 429,
  PUBLIC_AGENT_OPEN_OPERATION: 409,
  PUBLIC_AGENT_OPERATION_NOT_FOUND: 404,
  PUBLIC_AGENT_OUTCOME_UNKNOWN: 503,
};
function matchesFailure(code: string, status: number): boolean {
  return (
    Object.hasOwn(FAILURES, code) &&
    (FAILURES[code] === status || (code === 'PUBLIC_AGENT_OUTCOME_UNKNOWN' && status === 409))
  );
}
/** Single fetch, server only. Caller must independently provide a reviewed projector. */
export function createPlatformPublicAgentTransport(timeoutMs = 12_000): PublicAgentTransport {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new NuniError(503, 'PUBLIC_AGENT_NOT_CONFIGURED');
  return async ({ action, session, body, signal }) => {
    if (!Object.hasOwn(PATHS, action) || !process.env.NUNI_API_BASE_URL?.trim())
      throw new NuniError(503, 'PUBLIC_AGENT_NOT_CONFIGURED');
    if (
      !session ||
      !HANDLE.test(session.sessionHandle) ||
      session.pendingLogout ||
      session.expiresAt <= Date.now()
    )
      throw new NuniError(401, 'PUBLIC_AGENT_SESSION_INVALID');
    const origin = apiOrigin(),
      path = PATHS[action];
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded, 'utf8') > 8192) throw new NuniError(413, 'BODY_TOO_LARGE');
    const controller = new AbortController();
    let reject!: (reason: NuniError) => void;
    const stopped = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const halt = () => {
      controller.abort();
      reject(new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN'));
    };
    signal.addEventListener('abort', halt, { once: true });
    if (signal.aborted) halt();
    const timer = setTimeout(halt, timeoutMs);
    try {
      return await Promise.race([
        stopped,
        (async () => {
          if (controller.signal.aborted) throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
          const response = await fetch(`${origin}${path}`, {
            method: 'POST',
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Platform ${session.sessionHandle}`,
            },
            body: encoded,
          });
          const payload = await boundedJson(response, 16_384);
          if (!response.ok) {
            const row = nuniRecord(payload);
            const code =
              typeof row.code === 'string'
                ? row.code
                : typeof row.error === 'object' && row.error !== null
                  ? nuniRecord(row.error).code
                  : row.error;
            if (typeof code === 'string' && matchesFailure(code, response.status))
              throw new NuniError(response.status, code);
            throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
          }
          return payload;
        })(),
      ]);
    } catch (error) {
      if (error instanceof NuniError && matchesFailure(error.code, error.status)) throw error;
      // A POST can have committed after a network or response failure.
      throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', halt);
    }
  };
}
