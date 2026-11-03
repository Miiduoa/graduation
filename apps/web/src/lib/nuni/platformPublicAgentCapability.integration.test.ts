// @vitest-environment node
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

type Handler = (request: never, reply: never) => Promise<unknown>;
let registerPlatformPublicTaskRoutes: (
  app: { post: (path: string, options: unknown, handler: Handler) => void },
  options: unknown,
) => void;
let compiled: string;
beforeAll(async () => {
  const root = resolve(process.cwd(), '../..');
  const source = join(root, 'deploy/nuni-api/platform-public-agent');
  compiled = mkdtempSync(join(tmpdir(), 'campus-capability-wire-'));
  const run = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      ...readdirSync(source)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(source, name)),
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--types',
      'node',
      '--typeRoots',
      realpathSync(join(root, 'node_modules/@types')),
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--skipLibCheck',
      '--outDir',
      compiled,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(run.stdout + run.stderr);
  const compiledApi = await import(
    /* @vite-ignore */ pathToFileURL(join(compiled, 'fastify-candidate.js')).href
  );
  registerPlatformPublicTaskRoutes = compiledApi.registerPlatformPublicTaskRoutes;
});
afterAll(() => {
  if (compiled) rmSync(compiled, { recursive: true, force: true });
});

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3_600_000 };
const catalog = {
  schoolId: 'pu',
  updatedAt: '2026-10-19',
  label: '合成公開目錄',
  places: [
    { id: 'a', name: '甲樓', lat: 24, lng: 120, sourceUrl: 'https://www.openstreetmap.org/way/1' },
    {
      id: 'b',
      name: '乙館',
      lat: 24.1,
      lng: 120.1,
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    },
  ],
};
const calls = { provider: 0, transactions: 0 };
const handlers = new Map<string, (request: never, reply: never) => Promise<unknown>>();
let offline = false;
beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-test-session-secret-over-32-characters');
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_PUBLIC_AGENT_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.example.test');
  calls.provider = 0;
  calls.transactions = 0;
  offline = false;
  handlers.clear();
  registerPlatformPublicTaskRoutes(
    {
      post(path, _options, handler) {
        handlers.set(path, handler as never);
      },
    },
    {
      enabled: true,
      db: {
        transaction: async () => {
          calls.transactions++;
          throw new Error('not a capability read');
        },
      },
      accounts: {
        resolveSession: async (authorization: string | undefined) => {
          if (authorization !== `Platform ${session.sessionHandle}`) throw new Error('invalid');
          return {
            platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
            credentialId: 'credential',
            expiresAt: session.expiresAt,
          };
        },
      },
      policy: { providerBudgetKey: 'test', providerDailyLimit: 10, accountDailyLimit: 5 },
      readPublicCatalog: async (schoolId: string) => {
        if (offline) throw new Error('source offline');
        return schoolId === 'pu' ? catalog : null;
      },
      freeTierVerified: true,
      groqPlan: async () => {
        calls.provider++;
        throw new Error('must not execute');
      },
    },
  );
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.example.test' || !init) throw new Error('unexpected network');
    const handler = handlers.get(url.pathname);
    if (!handler) return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    const raw = new EventEmitter();
    const replyRaw = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
    let status = 200;
    const headers = new Headers();
    const reply = {
      raw: replyRaw,
      header(name: string, value: string) {
        headers.set(name, value);
        return this;
      },
      code(value: number) {
        status = value;
        return this;
      },
      send(value: unknown) {
        replyRaw.writableEnded = true;
        return Response.json(value, { status, headers });
      },
    };
    return handler(
      {
        url: url.pathname,
        headers: Object.fromEntries(new Headers(init.headers)),
        body: JSON.parse(String(init.body)),
        raw,
      } as never,
      reply as never,
    );
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function request(schoolId: string, context = sessionContext(session)) {
  return new NextRequest('https://nuni.tw/api/nuni/public-agent/capability', {
    method: 'POST',
    headers: {
      Origin: 'https://nuni.tw',
      'Content-Type': 'application/json',
      'X-Campus-Session': context,
      Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
    },
    body: JSON.stringify({ schoolId }),
  });
}
it('connects authenticated BFF to the actual Fastify handler and server-owned school catalog', async () => {
  const known = await handleNuni(request('pu'), ['public-agent', 'capability']);
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual({
    schoolId: 'pu',
    modes: ['deterministic'],
    source: { date: '2026-10-19', label: '合成公開目錄' },
  });
  expect(known.headers.get('cache-control')).toContain('no-store');
  const unknown = await handleNuni(request('other'), ['public-agent', 'capability']);
  expect(await unknown.json()).toEqual({ schoolId: 'other', modes: [], source: null });
  offline = true;
  const unavailable = await handleNuni(request('pu'), ['public-agent', 'capability']);
  expect(unavailable.status).toBe(503);
  expect((await unavailable.json()).error).toBe('PUBLIC_AGENT_SOURCE_UNAVAILABLE');
  expect((await handleNuni(request('pu', 'stale'), ['public-agent', 'capability'])).status).toBe(
    409,
  );
  expect(calls).toEqual({ provider: 0, transactions: 0 });
});
