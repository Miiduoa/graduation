import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  PublicCafeteriaError,
  PublicCafeteriaService,
  createWindowLimiter,
  requirePublicSchoolId,
} from './service';

const listPath = /^\/v1\/public\/schools\/([^/]+)\/cafeterias\/?$/;
const missingSchoolPath = /^\/v1\/public\/(?:schools\/)?cafeterias\/?$/;
const limiter = createWindowLimiter({ max: 60, windowMs: 60_000 });

export function isPublicCafeteriaRoute(method: string, path: string) {
  const normalized = method.toUpperCase();
  return (
    listPath.test(path) ||
    missingSchoolPath.test(path) ||
    (normalized !== 'GET' && path.startsWith('/v1/public/schools/') && path.includes('/cafeterias'))
  );
}

function clientKey(request: FastifyRequest) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.ip || 'anon';
}

export function registerPublicCafeteriaRoutes(
  app: FastifyInstance,
  db: { query: PublicCafeteriaService['list'] extends never ? never : ConstructorParameters<typeof PublicCafeteriaService>[0]['query'] },
) {
  const service = new PublicCafeteriaService(db);
  const send = async (request: FastifyRequest, reply: FastifyReply, schoolId: unknown) => {
    if (request.method !== 'GET') {
      throw new PublicCafeteriaError(405, 'METHOD_NOT_ALLOWED', '餐廳目錄只提供讀取');
    }
    if (!limiter.allow(clientKey(request))) {
      throw new PublicCafeteriaError(429, 'RATE_LIMITED', '查詢過於頻繁，請稍後再試');
    }
    const catalog = await service.list(schoolId);
    reply.header('Cache-Control', 'public, max-age=60');
    return catalog;
  };
  app.get('/v1/public/schools/:schoolId/cafeterias', async (request, reply) =>
    send(request, reply, (request.params as { schoolId?: string }).schoolId),
  );
  app.get('/v1/public/cafeterias', async () => {
    requirePublicSchoolId('');
  });
  app.get('/v1/public/schools/cafeterias', async () => {
    requirePublicSchoolId('');
  });
}
