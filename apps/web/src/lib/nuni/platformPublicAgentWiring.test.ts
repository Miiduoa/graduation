// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const root = resolve(process.cwd(), '../..');
let compiled: string;
let service: { [key: string]: (auth: string, input: unknown) => Promise<unknown> };
let authorization: string;
let account: { sessionHandle: string; expiresAt: number };
let executions = 0;
const catalog = {
  schoolId: 'pu',
  updatedAt: '2026-10-19',
  label: '合成資料',
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
beforeAll(async () => {
  compiled = mkdtempSync(join(tmpdir(), 'campus-web-wire-'));
  const source = join(root, 'deploy/nuni-api/platform-public-agent');
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  const run = spawnSync(
    process.execPath,
    [
      compiler,
      ...readdirSync(source)
        .filter((x) => x.endsWith('.ts'))
        .map((x) => join(source, x)),
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
  process.env.PLATFORM_AGENT_COMPILED = compiled;
  const fixturePath = pathToFileURL(join(root, 'scripts/platform-public-agent/fixtures.mjs')).href;
  const fixture = await import(/* @vite-ignore */ fixturePath);
  const { PlatformPublicTaskService } = await import(
    pathToFileURL(join(compiled, 'service.js')).href
  );
  const { exactNavigation } = await import(pathToFileURL(join(compiled, 'navigation.js')).href);
  const f = fixture.admissionFixture();
  f.db.now = Date.now();
  f.actor.expiresAt = f.db.now + 3_600_000;
  f.db.data.sessions.get(f.actor.sessionHash).expiresAt = f.actor.expiresAt;
  authorization = f.authorization;
  account = {
    sessionHandle: authorization.slice('Platform '.length),
    expiresAt: f.actor.expiresAt,
  };
  const accounts = {
    resolveSession: async (value: string) => {
      if (value !== authorization)
        throw Object.assign(new Error('invalid'), { code: 'PLATFORM_SESSION_INVALID' });
      return {
        platformAccountId: f.actor.platformAccountId,
        credentialId: f.actor.credentialId,
        expiresAt: f.actor.expiresAt,
      };
    },
  };
  service = new PlatformPublicTaskService({
    accounts,
    ledger: f.ledger,
    clock: () => f.db.now,
    readPublicCatalog: async () => structuredClone(catalog),
    execute: async (task: { data: { query: string } }, snapshot: unknown) => {
      executions++;
      return exactNavigation(task.data.query, snapshot);
    },
  });
});
afterAll(() => {
  if (compiled) rmSync(compiled, { recursive: true, force: true });
  delete process.env.PLATFORM_AGENT_COMPILED;
});
beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-test-session-secret-over-32-characters');
  vi.stubEnv('CAMPUS_PUBLIC_AGENT_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function webRequest(
  action: string,
  body: unknown,
  options: { cookie?: string; origin?: string; context?: string } = {},
) {
  return new NextRequest(`https://nuni.tw/api/nuni/public-agent/${action}`, {
    method: 'POST',
    headers: {
      Origin: options.origin ?? 'https://nuni.tw',
      'Content-Type': 'application/json',
      'X-Campus-Session': options.context ?? sessionContext(account),
      Cookie: options.cookie ?? `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, account)}`,
    },
    body: JSON.stringify(body),
  });
}
function apiServer() {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toMatch(
      /^https:\/\/api\.example\.test\/v1\/auth\/platform\/public-agent\/(preview|confirm|execute|read|status|ack)$/,
    );
    expect(new Headers(init.headers).get('authorization')).toBe(authorization);
    const action = url.split('/').at(-1)!;
    try {
      return Response.json(await service[action]!(authorization, JSON.parse(String(init.body))));
    } catch (error) {
      const e = error as { code?: string; statusCode?: number };
      return Response.json({ code: e.code ?? 'UNKNOWN' }, { status: e.statusCode ?? 500 });
    }
  });
}
it('defaults off and rejects forged browser session or cross-origin before upstream', async () => {
  const server = apiServer();
  vi.stubGlobal('fetch', server);
  vi.stubEnv('CAMPUS_PUBLIC_AGENT_ENABLED', 'false');
  expect(
    (
      await handleNuni(webRequest('status', { task: 'public-campus-navigation', schoolId: 'pu' }), [
        'public-agent',
        'status',
      ])
    ).status,
  ).toBe(404);
  vi.stubEnv('CAMPUS_PUBLIC_AGENT_ENABLED', 'true');
  expect(
    (
      await handleNuni(
        webRequest(
          'status',
          { task: 'public-campus-navigation', schoolId: 'pu' },
          { origin: 'https://evil.invalid' },
        ),
        ['public-agent', 'status'],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleNuni(
        webRequest(
          'status',
          { task: 'public-campus-navigation', schoolId: 'pu' },
          { context: 'bad' },
        ),
        ['public-agent', 'status'],
      )
    ).status,
  ).toBe(409);
  expect(server).not.toHaveBeenCalled();
});
it('wires signed session through BFF, real task service and ledger to a verified receipt', async () => {
  const server = apiServer();
  vi.stubGlobal('fetch', server);
  const call = async (action: string, body: unknown) => {
    const response = await handleNuni(webRequest(action, body), ['public-agent', action]);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(JSON.stringify(result)).not.toContain(account.sessionHandle);
    expect(JSON.stringify(result)).not.toContain('executionToken');
    return result;
  };
  expect(await call('status', { task: 'public-campus-navigation', schoolId: 'pu' })).toBeNull();
  const p = await call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'wire_journey_1',
  });
  expect(executions).toBe(0);
  const c = await call('confirm', { approved: true, request: p.request });
  const result = await call('execute', { confirmationId: c.confirmationId, request: p.request });
  expect(result.status).toBe('completed');
  expect(result.result.receipt.from.name).toBe('甲樓');
  expect((await call('status', { task: 'public-campus-navigation', schoolId: 'pu' })).status).toBe(
    'completed',
  );
  const ack = await call('ack', {
    task: 'public-campus-navigation',
    schoolId: 'pu',
    operationId: result.operationId,
    approved: true,
  });
  expect(ack.status).toBe('acknowledged');
  expect(executions).toBe(1);
  expect(server).toHaveBeenCalledTimes(6);
});
