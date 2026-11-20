import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CampusDatabase } from '../database';
import { DomainError } from '../domain-error';
import type { PlatformAccountService } from '../accounts/platform-account-service';
import { PersonalImportSyncError, PersonalImportSyncService, type ImportSyncActor } from './service';

const prefix = '/v1/auth/platform/personal-imports';
export function isPersonalImportSyncRoute(method: string, path: string) {
  return method === 'POST' && (path === `${prefix}/read` || path === `${prefix}/write`);
}
export function registerPersonalImportSyncRoutes(app: FastifyInstance, db: CampusDatabase, accounts: PlatformAccountService) {
  if (process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED !== 'true') return;
  const service = new PersonalImportSyncService(db);
  // The ledger itself is <=8 MiB; the bounded envelope is allowed a further 16 KiB.
  const options = { bodyLimit: 8 * 1024 * 1024 + 16 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const run = (action: (actor: ImportSyncActor, body: unknown) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: { header(name: string, value: string): unknown }) => {
      reply.header('Cache-Control', 'no-store');
      if (request.url.includes('?')) throw new DomainError('PERSONAL_IMPORT_INVALID_INPUT', '這個操作不接受查詢字串。', 422);
      const actor = await accounts.resolveSession(request.headers.authorization);
      const handle = request.headers.authorization!.trim().split(/\s+/u)[1]!;
      const sessionHash = createHash('sha256').update(handle).digest('hex');
      try { return await action({ ...actor, sessionHash }, request.body); }
      catch (error) {
        if (error instanceof PersonalImportSyncError) {
          const message = error.statusCode === 401 ? '登入已失效，請重新登入後再同步。'
            : error.statusCode === 409 ? '其他裝置的資料已改變，請重新取得資料後再同步。'
              : error.statusCode === 429 ? '同步資料已達上限，請先整理資料。'
                : '這份資料無法同步，請先檢查內容。';
          throw new DomainError(error.code, message, error.statusCode);
        }
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (['23505', '40001', '40P01'].includes(code))
          throw new DomainError('PERSONAL_IMPORT_REVISION_CONFLICT', '資料已改變，請重新取得後再同步。', 409);
        throw error;
      }
    };
  app.post(`${prefix}/read`, { ...options, bodyLimit: 4096 }, run((actor, body) => service.read(actor, body)));
  app.post(`${prefix}/write`, options, run((actor, body) => service.write(actor, body)));
}
