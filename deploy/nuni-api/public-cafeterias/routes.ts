import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  PublicCafeteriaError,
  PublicCafeteriaService,
  createWindowLimiter,
} from './service';

const listPath = /^\/v1\/public\/schools\/([^/]+)\/cafeterias\/?$/;
const missingSchoolPath = /^\/v1\/public\/(?:schools\/)?cafeterias\/?$/;
const limiter = createWindowLimiter({ max: 60, windowMs: 60_000 });
const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function resetPublicCafeteriaLimiter() {
  limiter.reset();
}

export function isPublicCafeteriaRoute(_method: string, path: string) {
  const pathname = path.split('?', 1)[0] ?? path;
  return listPath.test(pathname) || missingSchoolPath.test(pathname);
}

function clientKey(request: FastifyRequest) {
  return request.ip || 'anon';
}

export function registerPublicCafeteriaRoutes(
  app: FastifyInstance,
  db: { query: PublicCafeteriaService['list'] extends never ? never : ConstructorParameters<typeof PublicCafeteriaService>[0]['query'] },
) {
  const service = new PublicCafeteriaService(db);
  const send = async (request: FastifyRequest, reply: FastifyReply, schoolId: unknown) => {
    try {
      if (request.method !== 'GET') {
        throw new PublicCafeteriaError(405, 'METHOD_NOT_ALLOWED', '餐廳目錄只提供讀取');
      }
      if (!limiter.allow(clientKey(request))) {
        throw new PublicCafeteriaError(429, 'RATE_LIMITED', '查詢過於頻繁，請稍後再試');
      }
      const catalog = await service.list(schoolId);
      reply.header('Cache-Control', 'public, max-age=60');
      return catalog;
    } catch (error) {
      if (error instanceof PublicCafeteriaError) {
        if (error.status === 405) reply.header('Allow', 'GET');
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  };
  app.route({
    method: [...ROUTE_METHODS],
    url: '/v1/public/schools/:schoolId/cafeterias',
    handler: async (request, reply) =>
      send(request, reply, (request.params as { schoolId?: string }).schoolId),
  });
  app.route({
    method: [...ROUTE_METHODS],
    url: '/v1/public/cafeterias',
    handler: async (request, reply) => send(request, reply, ''),
  });
  app.route({
    method: [...ROUTE_METHODS],
    url: '/v1/public/schools/cafeterias',
    handler: async (request, reply) => send(request, reply, ''),
  });
}
