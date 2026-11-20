import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const Fastify = require('fastify');
const rateLimit = require('@fastify/rate-limit');
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function modules() {
  const temporary = await mkdtemp(resolve(tmpdir(), 'campus-assistant-modules-'));
  const result = await build({
    stdin: {
      contents: `export * from './deploy/nuni-api/assistant/service'; export * from './deploy/nuni-api/assistant/routes'; export * from './deploy/nuni-api/assistant/fake'; export * from './deploy/nuni-api/assistant/groq'; export * from './deploy/nuni-api/assistant/confirmation'; export * from './deploy/nuni-api/assistant/permissions'; export * from './deploy/nuni-api/assistant/publicContext';`,
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'packaging',
        setup(builder) {
          builder.onResolve({ filter: /sharedMapLookup$/ }, () => ({
            path: resolve(root, 'packages/shared/src/campusMapLookup.ts'),
          }));
          builder.onResolve({ filter: /sharedPermissions$/ }, () => ({
            path: resolve(root, 'packages/shared/src/assistantPermissions.ts'),
          }));
          builder.onResolve({ filter: /domain-error$/ }, () => ({
            path: 'domain-error',
            namespace: 'test-contract',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test-contract' }, () => ({
            contents: `export class DomainError extends Error { constructor(code, message, statusCode) { super(message); this.code=code; this.statusCode=statusCode; } }`,
          }));
        },
      },
    ],
  });
  const file = resolve(temporary, 'modules.mjs');
  await writeFile(file, result.outputFiles[0].text);
  const mod = await import(file);
  await rm(temporary, { recursive: true });
  return mod;
}
export const fixtureHandle = 'ps_' + 't'.repeat(43);
export const fixtureSecret = 'local-public-assistant-fixture-only-'.repeat(2);
export async function createFixture({ enabled = true, production = false, logStream, provider = 'fake' } = {}) {
  const mod = await modules();
  process.env.CAMPUS_ASSISTANT_ENABLED = String(enabled);
  process.env.CAMPUS_ASSISTANT_PROVIDER = provider;
  process.env.NODE_ENV = production ? 'production' : 'test';
  const app = Fastify({ logger: logStream ? { level: 'info', stream: logStream } : false, logController: new Fastify.LogController({ disableRequestLogging: true }) });
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
  const state = { active: true, resolutions: 0, resolverError: null };
  app.addHook('preHandler', async (request) => {
    if (!mod.isAssistantRoute(request.method, request.url.split('?')[0])) {
      const error = new Error('guard');
      error.statusCode = 401;
      throw error;
    }
  });
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error.statusCode ?? 503).send({ error: { code: error.code ?? 'UNAVAILABLE' } }),
  );
  mod.registerAssistantRoutes(
    app,
    {
      async resolveSession(auth) {
        state.resolutions++;
        if (state.resolverError) throw state.resolverError;
        if (!state.active || auth !== 'Platform ' + fixtureHandle) {
          const e = new Error('invalid session');
          e.code = 'INVALID_SESSION';
          e.statusCode = 401;
          throw e;
        }
        return { platformAccountId: 'fixture-account', credentialId: 'fixture-credential' };
      },
    },
    fixtureSecret,
  );
  await app.ready();
  return { app, state, mod };
}
