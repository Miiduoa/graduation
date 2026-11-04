import { Confirmations } from './confirmation';
import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
type SessionResolver = {
  resolveSession(authorization: string | undefined): Promise<{ platformAccountId: string }>;
};
import { DomainError } from '../domain-error';
import { AssistantService } from './service';
import { AssistantError } from './publicContext';
import { groqProvider } from './groq';
import { fakeProvider } from './fake';
const prefix = '/v1/auth/platform/assistant/';
const actions = ['preview', 'ask', 'route', 'execute', 'enqueue'];
export function isAssistantRoute(method: string, path: string) {
  return (
    (method === 'GET' && path === prefix + 'capability') ||
    (method === 'POST' && actions.some((action) => path === prefix + action))
  );
}
export function registerAssistantRoutes(
  app: FastifyInstance,
  accounts: SessionResolver,
  secret: string,
) {
  if (process.env.CAMPUS_ASSISTANT_ENABLED !== 'true') return;
  const provider = process.env.CAMPUS_ASSISTANT_PROVIDER ?? 'groq';
  if (!['groq', 'fake'].includes(provider)) throw new AssistantError('PROVIDER_UNAVAILABLE');
  if (!secret || secret.length < 32) throw new AssistantError('CONFIGURATION_REQUIRED');
  const key = createHmac('sha256', secret).update('campus-public-assistant-key:v1').digest();
  const service = new AssistantService(
    provider === 'fake' ? fakeProvider() : groqProvider(),
    Date.now,
    new Confirmations(key),
  );
  for (const action of ['capability', ...actions]) {
    app.route({
      method: action === 'capability' ? 'GET' : 'POST',
      url: prefix + action,
      bodyLimit: 8192,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      async handler(request, reply) {
        reply.header('Cache-Control', 'no-store');
        const actor = await accounts.resolveSession(request.headers.authorization);
        if (request.url.includes('?')) throw new DomainError('INVALID_INPUT', '請檢查輸入。', 422);
        const sessionHash = createHash('sha256')
          .update(request.headers.authorization ?? '')
          .digest('hex');
        try {
          return await service.run(action, request.body, {
            account: actor.platformAccountId,
            sessionHash,
            ip: request.ip,
          });
        } catch (error) {
          if (error instanceof AssistantError) {
            if (error.statusCode === 429) reply.header('Retry-After', '60');
            throw new DomainError(
              error.code,
              '目前無法完成查詢，請重新選擇公開服務或稍後再試。',
              error.statusCode,
            );
          }
          throw error;
        }
      },
    });
  }
}
