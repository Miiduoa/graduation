// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { handleNuni } from './api';
import {
  readPlatformAssistantPermissions,
  savePlatformAssistantPermissions,
} from './platformAssistantPermissionStore';
import { SESSION_COOKIE, sealCookie, sessionContext, type PlatformSession } from './server';

vi.mock('./platformAssistantPermissionStore', () => ({
  readPlatformAssistantPermissions: vi.fn(),
  savePlatformAssistantPermissions: vi.fn(),
}));
const read = vi.mocked(readPlatformAssistantPermissions);
const save = vi.mocked(savePlatformAssistantPermissions);
const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const otherId = 'pa_22222222-2222-4222-8222-222222222222';
const permissions = { createPersonalEvent: true, prepareFoodOrder: false };
const state = (id = accountId, revision = 1) => ({
  scope: 'platform-account' as const,
  accountId: id,
  revision,
  permissions,
});
const fetcher = vi.fn();
const session = (): PlatformSession => ({
  sessionHandle: 'ps_' + 'a'.repeat(43),
  expiresAt: Date.now() + 3600_000,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function request(
  input?: unknown,
  options: {
    session?: PlatformSession;
    context?: string;
    origin?: string;
    method?: string;
    query?: string;
    cookie?: boolean;
  } = {},
) {
  const current = options.session ?? session();
  const method = options.method ?? (input === undefined ? 'GET' : 'POST');
  return new NextRequest('https://nuni.tw/api/nuni/assistant-permissions' + (options.query ?? ''), {
    method,
    headers: {
      ...(options.cookie !== false
        ? { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, current)}` }
        : {}),
      'X-Campus-Session': options.context ?? sessionContext(current),
      ...(method !== 'GET'
        ? { Origin: options.origin ?? 'https://nuni.tw', 'Content-Type': 'application/json' }
        : {}),
    },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  });
}
const handle = (req: NextRequest) => handleNuni(req, ['assistant-permissions']);

function nativeRequest(input?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest('https://nuni.tw/api/nuni/assistant-permissions', {
    method: input === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Platform ${session().sessionHandle}`,
      ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  });
}

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'assistant-settings-test-secret-longer-than-thirty-two');
  fetcher
    .mockReset()
    .mockImplementation(async () =>
      json({ authenticated: true, platformAccountId: accountId, isPlatformOperator: false }),
    );
  vi.stubGlobal('fetch', fetcher);
  read.mockReset().mockImplementation(async (id) => state(id));
  save
    .mockReset()
    .mockImplementation(async (id, revision, value) => ({
      ...state(id, revision + 1),
      permissions: value,
    }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('shares account preferences with authenticated native requests without browser cookies', async () => {
  const loaded = await handle(nativeRequest());
  expect(loaded.status).toBe(200);
  expect(await loaded.json()).toEqual(state());
  const saved = await handle(nativeRequest({ expectedRevision: 1, permissions }));
  expect(saved.status).toBe(200);
  expect(save).toHaveBeenCalledExactlyOnceWith(accountId, 1, permissions);
  expect(
    fetcher.mock.calls.every(
      ([, init]) => init.headers.Authorization === `Platform ${session().sessionHandle}`,
    ),
  ).toBe(true);
});

it('rejects invalid native credentials, mixed identities and browser cross-origin bearer requests', async () => {
  expect(
    (await handle(nativeRequest(undefined, { Authorization: 'Platform invalid' }))).status,
  ).toBe(401);
  expect(
    (
      await handle(
        nativeRequest(undefined, {
          Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session())}`,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handle(
        nativeRequest({ expectedRevision: 1, permissions }, { Origin: 'https://other.example' }),
      )
    ).status,
  ).toBe(403);
  expect((await handle(nativeRequest(undefined, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(
    403,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('checks revoked native credentials with the upstream before reading or writing preferences', async () => {
  fetcher.mockImplementation(async () => json({ error: { code: 'AUTH_REQUIRED' } }, 401));
  expect((await handle(nativeRequest())).status).toBe(401);
  expect((await handle(nativeRequest({ expectedRevision: 1, permissions }))).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('loads and saves only the upstream-verified Google account without changing its cookie', async () => {
  const loaded = await handle(request());
  expect(loaded.status).toBe(200);
  expect(await loaded.json()).toEqual(state());
  expect(loaded.headers.get('cache-control')).toContain('no-store');
  const saved = await handle(request({ expectedRevision: 1, permissions }));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual(state(accountId, 2));
  expect(saved.headers.has('set-cookie')).toBe(false);
  expect(save).toHaveBeenCalledExactlyOnceWith(accountId, 1, permissions);
  expect(
    fetcher.mock.calls.every(
      ([url]) => url === 'https://api.nuni.tw/v1/auth/platform/sessions/current',
    ),
  ).toBe(true);
});

it('gets independent state when the verified account changes', async () => {
  await handle(request());
  fetcher.mockImplementation(async () =>
    json({ authenticated: true, platformAccountId: otherId, isPlatformOperator: false }),
  );
  const changed = await handle(
    request(undefined, { session: { ...session(), sessionHandle: 'ps_' + 'b'.repeat(43) } }),
  );
  expect((await changed.json()).accountId).toBe(otherId);
  expect(read.mock.calls).toEqual([[accountId], [otherId]]);
});

it.each([
  { cookie: false },
  { session: { sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: 1 } },
  {
    session: {
      sessionHandle: 'ps_' + 'a'.repeat(43),
      expiresAt: Date.now() + 3600_000,
      pendingLogout: true as const,
    },
  },
])('rejects missing, expired and pending-logout sessions before storage', async (options) => {
  expect((await handle(request({ expectedRevision: 1, permissions }, options))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('rejects old session context and cross-origin writes before storage', async () => {
  expect(
    (await handle(request({ expectedRevision: 1, permissions }, { context: 'old-context' })))
      .status,
  ).toBe(409);
  expect(
    (
      await handle(
        request({ expectedRevision: 1, permissions }, { origin: 'https://other.example' }),
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('cannot read or save preferences with an upstream-revoked session', async () => {
  fetcher.mockImplementation(async () => json({ error: { code: 'AUTH_REQUIRED' } }, 401));
  expect((await handle(request())).status).toBe(401);
  expect((await handle(request({ expectedRevision: 1, permissions }))).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it.each([
  { expectedRevision: 1, permissions, accountId: otherId },
  { expectedRevision: 1, permissions, uid: 'firebase-user' },
  { expectedRevision: -1, permissions },
  { expectedRevision: 1.5, permissions },
  { expectedRevision: 0, permissions: { createPersonalEvent: true } },
  { expectedRevision: 0, permissions: { ...permissions, prepareFoodOrder: 'false' } },
  { expectedRevision: 0, permissions: { ...permissions, isAdmin: true } },
  [],
  null,
])('rejects unrecognized identity fields and invalid permission requests', async (input) => {
  expect((await handle(request(input))).status).toBe(422);
  expect(save).not.toHaveBeenCalled();
});

it('returns revision conflicts and unavailable persistence without a false receipt', async () => {
  save.mockRejectedValueOnce(new NuniError(409, 'ASSISTANT_PERMISSION_REVISION_CONFLICT'));
  const conflict = await handle(request({ expectedRevision: 1, permissions }));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: 'ASSISTANT_PERMISSION_REVISION_CONFLICT' });
  read.mockRejectedValueOnce(new NuniError(503, 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE'));
  const unavailable = await handle(request());
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE' });
});

it('rejects query-based account selection, unsupported methods and oversized writes', async () => {
  expect((await handle(request(undefined, { query: '?accountId=' + otherId }))).status).toBe(400);
  expect((await handle(request({}, { method: 'PUT' }))).status).toBe(405);
  expect(
    (await handle(request({ expectedRevision: 0, permissions, junk: 'x'.repeat(2048) }))).status,
  ).toBe(413);
  expect(save).not.toHaveBeenCalled();
});
