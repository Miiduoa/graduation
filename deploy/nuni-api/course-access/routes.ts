import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CampusDatabase } from '../database';
import { DomainError } from '../domain-error';
import type { PlatformAccountService } from '../accounts/platform-account-service';
import { CourseAccessService } from './service';
import { CourseAccessError, courseAccessErrorMessage } from './courseAccess';

const prefix = '/v1/auth/platform/course-access';
const actions = ['match', 'workspace-course', 'student-requests', 'teacher-requests', 'requests', 'reviews'];
const requestAction = /^\/requests\/car_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:withdraw|decide)$/u;
export function isCourseAccessRoute(method: string, path: string) {
  if (method !== 'POST' || !path.startsWith(prefix)) return false;
  const suffix = path.slice(prefix.length);
  return actions.some(action => suffix === `/${action}`) || requestAction.test(suffix);
}
export function registerCourseAccessRoutes(app: FastifyInstance, db: CampusDatabase, accounts: PlatformAccountService) {
  // The candidate source is not an instruction to switch on the production service.
  if (process.env.CAMPUS_COURSE_ACCESS_ENABLED !== 'true') return;
  const service = new CourseAccessService(db);
  const options = { bodyLimit: 8192, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const run = (action: (request: FastifyRequest, actor: Awaited<ReturnType<PlatformAccountService['resolveSession']>>) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: { header(name: string, value: string): unknown }) => {
      reply.header('Cache-Control', 'no-store');
      if (request.url.includes('?')) throw new DomainError('COURSE_INVALID_INPUT', '此操作不接受查詢字串。', 422);
      const actor = await accounts.resolveSession(request.headers.authorization);
      try { return await action(request, actor); }
      catch (error) {
        if (error instanceof CourseAccessError) throw new DomainError(error.code, courseAccessErrorMessage(error), error.statusCode);
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (['23505', '40001', '40P01'].includes(code)) throw new DomainError('COURSE_STATE_CHANGED', '資料已改變，請重新查詢後再試。', 409);
        if (code === '42501') throw new DomainError('COURSE_REVIEW_REQUIRED', '此課班需要有效的管理員審核，不會直接授予權限。', 403);
        throw error;
      }
    };
  app.post(`${prefix}/match`, options, run((request, actor) => service.match(actor, request.body)));
  app.post(`${prefix}/workspace-course`, options, run((request, actor) => service.workspace(actor, request.body)));
  app.post(`${prefix}/student-requests`, options, run((request, actor) => service.student(actor, request.body)));
  app.post(`${prefix}/teacher-requests`, options, run((request, actor) => service.teacher(actor, request.body)));
  app.post(`${prefix}/requests`, options, run((request, actor) => service.list(actor, request.body)));
  app.post(`${prefix}/reviews`, options, run((request, actor) => service.list(actor, request.body, true)));
  app.post(`${prefix}/requests/:id/withdraw`, options, run((request, actor) =>
    service.withdraw(actor, (request.params as { id: string }).id, request.body)));
  app.post(`${prefix}/requests/:id/decide`, options, run((request, actor) =>
    service.decide(actor, (request.params as { id: string }).id, request.body)));
}
