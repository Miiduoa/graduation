import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../domain-error';
import { NuniError } from './nuni';
import { NUNI_LOST_FOUND_BODY_LIMIT, isNuniLostFoundAction } from './contracts';
import { PlatformLostFoundError, PlatformLostFoundService, type LostFoundActor, type LostFoundDatabase } from './service';

const prefix = '/v1/auth/platform/lost-found/';
type PlatformSessionResolver = {
  resolveSession(authorization: string | undefined): Promise<Omit<LostFoundActor, 'sessionHash'>>;
};
export function isPlatformLostFoundRoute(method: string, path: string) {
  return method === 'POST' && path.startsWith(prefix) && isNuniLostFoundAction(path.slice(prefix.length));
}

/** The general campus-auth prehandler is skipped only for these separately platform-authenticated routes. */
export function registerPlatformLostFoundRoutes(app: FastifyInstance, db: LostFoundDatabase, accounts: PlatformSessionResolver) {
  if (process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED !== 'true') return;
  const service = new PlatformLostFoundService(db);
  for (const action of ['list', 'get', 'create', 'update', 'resolve', 'remove', 'export'] as const) {
    const read = action === 'list' || action === 'get' || action === 'export';
    app.post(prefix + action, { bodyLimit: NUNI_LOST_FOUND_BODY_LIMIT,
      config: { rateLimit: { max: read ? 60 : 30, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.url.includes('?')) throw new DomainError('LOST_FOUND_INVALID_INPUT', '這個操作不接受查詢字串。', 422);
      const actor = await accounts.resolveSession(request.headers.authorization);
      const handle = request.headers.authorization!.trim().split(/\s+/u)[1]!;
      const sessionHash = createHash('sha256').update(handle).digest('hex');
      try { return await service[action]({ ...actor, sessionHash }, request.body); }
      catch (error) {
        if (error instanceof PlatformLostFoundError || error instanceof NuniError) {
          const status = error instanceof PlatformLostFoundError ? error.statusCode : error.status;
          const message = status === 401 ? '登入已失效，請重新登入。'
            : status === 404 ? '找不到這則失物招領。'
              : status === 410 ? '這則失物招領已下架。'
                : status === 409 ? '這則資料已變更，請重新載入後再操作。'
                  : status === 429 ? '操作過於頻繁或資料已達上限，請稍後再試。'
                    : '失物招領資料格式不正確，請檢查後再試。';
          throw new DomainError(error.code, message, status);
        }
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (['23505', '40001', '40P01'].includes(code))
          throw new DomainError('LOST_FOUND_VERSION_CONFLICT', '資料已變更，請重新載入後再操作。', 409);
        throw error;
      }
    });
  }
}
