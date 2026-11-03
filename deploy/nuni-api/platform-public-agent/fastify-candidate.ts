import { PublicAgentError, type PlatformTaskActor } from './contract';
import {
  PlatformPublicAgentLedger,
  type PublicAgentDatabase,
  type PublicAgentPolicy,
} from './ledger';
import { PlatformPublicTaskService } from './service';
import type { PublicCatalogReader } from './navigation';
import type { PlatformSessionResolver } from './admission';

const prefix = '/v1/auth/platform/public-agent';
const actions = [
  'capability',
  'preview',
  'prepareGroq',
  'confirm',
  'execute',
  'read',
  'status',
  'ack',
  'route',
  'reconcile',
] as const;
type Action = (typeof actions)[number];
/** Minimal structural subset, modelled on the pinned API overlay. */
type Request = {
  url: string;
  headers: {
    authorization?: string | string[];
    origin?: string | string[];
    'sec-fetch-site'?: string | string[];
    'content-type'?: string | string[];
  };
  body: unknown;
  raw: {
    aborted?: boolean;
    once(name: 'aborted', listener: () => void): unknown;
    removeListener(name: 'aborted', listener: () => void): unknown;
  };
};
type Reply = {
  header(name: string, value: string): unknown;
  code(status: number): Reply;
  send(body: unknown): unknown;
  raw: {
    writableEnded: boolean;
    destroyed?: boolean;
    once(name: 'close', listener: () => void): unknown;
    removeListener(name: 'close', listener: () => void): unknown;
  };
};
export type FastifyCandidate = {
  post(
    path: string,
    options: { bodyLimit: number; config: { rateLimit: { max: number; timeWindow: string } } },
    handler: (request: Request, reply: Reply) => Promise<unknown>,
  ): unknown;
};
type Options = {
  enabled?: boolean;
  db: PublicAgentDatabase;
  accounts: PlatformSessionResolver;
  policy: PublicAgentPolicy;
  /** Must be a trusted, server-owned public catalog capability; never pass browser input as rows. */
  readPublicCatalog: PublicCatalogReader;
  timeoutMs?: number;
  /** Host must separately verify the selected organization is on its free tier. */
  freeTierVerified?: boolean;
  groqPlan?: (
    input: { schoolId: string; query: string; fingerprint: string },
    signal: AbortSignal,
    beforeSend: (signal: AbortSignal) => Promise<void>,
  ) => Promise<unknown>;
};
const validAction = (action: string): action is Action => actions.some((value) => value === action);
/** For host authorization review only. This predicate is NOT wired into the API guard. */
export function isPlatformPublicTaskRoute(method: string, path: string, enabled = false): boolean {
  return (
    enabled === true &&
    method === 'POST' &&
    path.startsWith(`${prefix}/`) &&
    validAction(path.slice(prefix.length + 1))
  );
}
/**
 * Unregistered candidate: no env flag, DB migration, grant, cookie, provider or source is configured here.
 * The host must separately bind the authenticated BFF, vetted reader and PG schema before considering activation.
 */
export function registerPlatformPublicTaskRoutes(app: FastifyCandidate, options: Options): void {
  if (options.enabled !== true) return;
  if (
    typeof app?.post !== 'function' ||
    typeof options.accounts?.resolveSession !== 'function' ||
    typeof options.db?.transaction !== 'function' ||
    typeof options.readPublicCatalog !== 'function'
  )
    throw new PublicAgentError('PUBLIC_AGENT_NOT_CONFIGURED', 503);
  const ledger = new PlatformPublicAgentLedger(options.db, options.policy);
  const service = new PlatformPublicTaskService({
    accounts: options.accounts,
    ledger,
    readPublicCatalog: options.readPublicCatalog,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.freeTierVerified === true && options.groqPlan
      ? { groqPlan: options.groqPlan }
      : {}),
  });
  const routeOptions = {
    bodyLimit: 8192,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  };
  for (const action of actions) {
    app.post(`${prefix}/${action}`, routeOptions, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      const abort = new AbortController();
      let rejectStop!: (error: PublicAgentError) => void;
      const stopped = new Promise<never>((_, reject) => {
        rejectStop = reject;
      });
      void stopped.catch(() => {});
      const onAbort = () => {
        abort.abort();
        rejectStop(new PublicAgentError('PUBLIC_AGENT_TIMEOUT', 503));
      };
      const onClose = () => {
        if (!reply.raw.writableEnded) onAbort();
      };
      const timer = setTimeout(onAbort, options.timeoutMs ?? 10_000);
      request.raw.once('aborted', onAbort);
      reply.raw.once('close', onClose);
      if (request.raw.aborted || reply.raw.destroyed || reply.raw.writableEnded) onAbort();
      let started = false;
      try {
        if (abort.signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_CANCELLED', 503);
        // The browser uses the same-origin BFF. A Platform bearer is server-owned and never in JSON or cookies here.
        if (
          request.url.includes('?') ||
          request.headers.origin !== undefined ||
          request.headers['sec-fetch-site'] !== undefined
        )
          throw new PublicAgentError('PUBLIC_AGENT_ORIGIN_DENIED', 403);
        if (
          request.headers['content-type']?.toString().split(';')[0]?.trim() !== 'application/json'
        )
          throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT', 415);
        const authorization = request.headers.authorization;
        if (typeof authorization !== 'string')
          throw new PublicAgentError('PUBLIC_AGENT_SESSION_INVALID', 401);
        const value = await Promise.race([
          (async () => {
            const actor = verifiedActor(await options.accounts.resolveSession(authorization));
            if (abort.signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_TIMEOUT', 503);
            started = true;
            const result = await (action === 'reconcile'
              ? service.reconcileNoDispatch(authorization, request.body, abort.signal)
              : service[action](authorization, request.body, abort.signal));
            if (abort.signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_TIMEOUT', 503);
            const current = verifiedActor(await options.accounts.resolveSession(authorization));
            if (abort.signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_TIMEOUT', 503);
            if (!sameActor(actor, current))
              throw new PublicAgentError('PUBLIC_AGENT_SESSION_INVALID', 401);
            return result;
          })(),
          stopped,
        ]);
        return reply.send(value);
      } catch (error) {
        const known = error instanceof PublicAgentError ? error : null;
        if (
          started &&
          (action === 'execute' ||
            action === 'ack' ||
            action === 'confirm' ||
            action === 'reconcile') &&
          (!known ||
            [
              'PUBLIC_AGENT_SESSION_INVALID',
              'PUBLIC_AGENT_SESSION_CHECK_UNAVAILABLE',
              'PUBLIC_AGENT_TIMEOUT',
              'PUBLIC_AGENT_CANCELLED',
            ].includes(known.code))
        )
          return reply.code(503).send({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
        if (known) return reply.code(known.statusCode).send({ code: known.code });
        const invalid =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'PLATFORM_SESSION_INVALID';
        return reply.code(invalid ? 401 : 503).send({
          code: invalid ? 'PUBLIC_AGENT_SESSION_INVALID' : 'PUBLIC_AGENT_STATE_UNAVAILABLE',
        });
      } finally {
        clearTimeout(timer);
        request.raw.removeListener('aborted', onAbort);
        reply.raw.removeListener('close', onClose);
      }
    });
  }
}
function sameActor(
  a: Omit<PlatformTaskActor, 'sessionHash'>,
  b: Omit<PlatformTaskActor, 'sessionHash'>,
): boolean {
  return (
    a.platformAccountId === b.platformAccountId &&
    a.credentialId === b.credentialId &&
    a.expiresAt === b.expiresAt
  );
}

function verifiedActor(
  value: Omit<PlatformTaskActor, 'sessionHash'>,
): Omit<PlatformTaskActor, 'sessionHash'> {
  if (
    !value ||
    typeof value.platformAccountId !== 'string' ||
    !/^pa_[a-f0-9-]{36}$/u.test(value.platformAccountId) ||
    typeof value.credentialId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(value.credentialId) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now()
  )
    throw new PublicAgentError('PUBLIC_AGENT_SESSION_CHECK_UNAVAILABLE', 503);
  return {
    platformAccountId: value.platformAccountId,
    credentialId: value.credentialId,
    expiresAt: value.expiresAt,
  };
}
