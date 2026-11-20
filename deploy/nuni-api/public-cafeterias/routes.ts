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
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const orderingPath =
  /^\/v1\/(?:.*\/)?food\/(?:.*\/)?(?:orders|quotes|pos-orders|pickup[^/]*)(?:\/|$)/;
const merchantOrderPath =
  /^\/v1\/(?:auth\/platform\/)?merchant-workspaces\/[^/]+\/[^/]+\/orders(?:\/|$)/;

export function resetPublicCafeteriaLimiter() {
  limiter.reset();
}

/** 未設或不是字面 true 就是關；本機測試要開才明確設 ONLINE_ORDERING_ENABLED=true。 */
export function onlineOrderingEnabled() {
  return process.env.ONLINE_ORDERING_ENABLED === 'true';
}

export function isOrderingRoute(path: string) {
  const pathname = path.split('?', 1)[0] ?? path;
  if (/\/purchase-orders(?:\/|$)/.test(pathname)) return false;
  return orderingPath.test(pathname) || merchantOrderPath.test(pathname);
}

export function isOrderingWrite(method: string, path: string) {
  return WRITE_METHODS.has(method.toUpperCase()) && isOrderingRoute(path);
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
  app.addHook('onRequest', async (request, reply) => {
    if (onlineOrderingEnabled() || !isOrderingWrite(request.method, request.url)) return;
    return reply.code(412).send({
      error: { code: 'ONLINE_ORDERING_DISABLED', message: '線上點餐尚未開放' },
    });
  });
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
