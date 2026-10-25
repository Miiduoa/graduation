// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  handlePlatformAdmin,
  handlePlatformSocial,
  resetSchoolDirectoryCache,
  schoolDirectory,
} from './platform-gateway';
import { SESSION_COOKIE, openCookie, sealCookie, sessionContext } from './nuni/server';
const account = 'pa_33333333-3333-4333-8333-333333333333';
const fetcher = vi.fn();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const active = () => ({ sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 });
function req(
  path: string,
  options: { body?: object; auth?: boolean; context?: string; origin?: string } = {},
) {
  const session = active();
  return new NextRequest(`https://nuni.tw/api/${path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: {
      ...(options.auth
        ? {
            Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
            'X-Campus-Session': options.context ?? sessionContext(session),
          }
        : {}),
      ...(options.body
        ? { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://nuni.tw' }
        : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}
beforeEach(() => {
  resetSchoolDirectoryCache();
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('BFF_SESSION_SECRET', 'unit-test-session-secret-longer-than-32-characters');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  resetSchoolDirectoryCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('rejects absent sessions and stale account context before API requests', async () => {
  expect((await handlePlatformAdmin(req('platform-admin/schools'), ['schools'])).status).toBe(401);
  expect(
    (
      await handlePlatformAdmin(
        req('platform-admin/schools', { auth: true, context: 'b'.repeat(43) }),
        ['schools'],
      )
    ).status,
  ).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
});
it('checks live operator authority and never fetches private operations for a normal account', async () => {
  fetcher.mockResolvedValue(
    json({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
  );
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools', { auth: true }), ['schools'])).status,
  ).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toMatch(/sessions\/current$/);
});
it('does not retain a prior operator grant across requests', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({ authenticated: true, platformAccountId: account, isPlatformOperator: true }),
    )
    .mockResolvedValueOnce(json({ schools: [] }));
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools?q=台灣&', { auth: true }), ['schools']))
      .status,
  ).toBe(200);
  expect(fetcher.mock.calls[1][0]).toBe(
    'https://api.nuni.tw/v1/auth/platform/ops/schools?q=%E5%8F%B0%E7%81%A3',
  );
  fetcher.mockResolvedValue(
    json({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
  );
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools', { auth: true }), ['schools'])).status,
  ).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects cross-origin writes before login or operator lookup', async () => {
  expect(
    (
      await handlePlatformAdmin(
        req('platform-admin/login', {
          body: { email: 'operator@example.test', password: 'local-test-password' },
          origin: 'https://evil.test',
        }),
        ['login'],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handlePlatformSocial(
        req('social/posts', { auth: true, body: {}, origin: 'https://evil.test' }),
        ['posts'],
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('never replaces an existing browser account during password login', async () => {
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      auth: true,
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'SIGN_OUT_REQUIRED' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('stores only an encrypted HttpOnly session and returns no password or bearer handle', async () => {
  fetcher.mockResolvedValue(
    json({
      sessionHandle: active().sessionHandle,
      expiresInSeconds: 3600,
      platformAccountId: account,
      isPlatformOperator: true,
    }),
  );
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(200);
  const output = await response.text();
  expect(output).not.toContain('local-test-password');
  expect(output).not.toContain('ps_');
  const cookie = response.cookies.get(SESSION_COOKIE);
  expect(cookie?.httpOnly).toBe(true);
  expect(openCookie(SESSION_COOKIE, cookie?.value)?.sessionHandle).toBe(active().sessionHandle);
});
it('revokes an invalid upstream login session instead of installing it', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({
        sessionHandle: active().sessionHandle,
        expiresInSeconds: 86400,
        platformAccountId: account,
        isPlatformOperator: true,
      }),
    )
    .mockResolvedValueOnce(json({ signedOut: true }));
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(502);
  expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  expect(fetcher.mock.calls[1][0]).toMatch(/logout$/);
});
it('constrains social routes and query scope before forwarding', async () => {
  expect(
    (await handlePlatformSocial(req('social/ops/reports', { auth: true }), ['ops', 'reports']))
      .status,
  ).toBe(404);
  expect(
    (
      await handlePlatformSocial(req('social/feed?tenantId=pu&tenantId=other', { auth: true }), [
        'feed',
      ])
    ).status,
  ).toBe(400);
  expect(
    (
      await handlePlatformSocial(
        req('social/posts', { auth: true, body: { text: 'hello', authorId: account } }),
        ['posts'],
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it('forwards a scoped social request using only the sealed current session', async () => {
  fetcher.mockResolvedValue(json({ items: [], nextCursor: null }));
  const response = await handlePlatformSocial(req('social/feed?tenantId=pu', { auth: true }), [
    'feed',
  ]);
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toMatch(/social\/feed\?tenantId=pu$/);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Platform ${active().sessionHandle}`);
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
});
const directory = {
  schools: [{ tenantId: 'pu', displayName: '靜宜大學', status: 'open', internal: 'private' }],
};

it('projects only actual public school metadata', async () => {
  fetcher.mockResolvedValue(json(directory));
  const response = await schoolDirectory(req('schools'));
  expect(await response.json()).toEqual({
    schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
  });
});

it('reuses a successful school directory within 60 seconds', async () => {
  const now = vi.spyOn(Date, 'now');
  let current = 1_700_000_000_000;
  now.mockImplementation(() => current);
  fetcher.mockResolvedValue(json(directory));
  expect((await schoolDirectory(req('schools'))).status).toBe(200);
  current += 59_000;
  expect(await (await schoolDirectory(req('schools'))).json()).toEqual({
    schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  now.mockRestore();
});

it('returns cached schools when the upstream directory is rate limited', async () => {
  const now = vi.spyOn(Date, 'now');
  let current = 1_700_000_000_000;
  now.mockImplementation(() => current);
  fetcher.mockResolvedValueOnce(json(directory)).mockResolvedValueOnce(json({}, 429));
  expect((await schoolDirectory(req('schools'))).status).toBe(200);
  current += 61_000;
  const response = await schoolDirectory(req('schools'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it('returns the upstream error when a rate-limited directory has no cache', async () => {
  fetcher.mockResolvedValue(json({}, 429));
  const response = await schoolDirectory(req('schools'));
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' });
});

it('shares one upstream school directory request across concurrent callers', async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = Promise.all([schoolDirectory(req('schools')), schoolDirectory(req('schools'))]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(json(directory));
  const responses = await pending;
  expect(responses.map((item) => item.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual({
    schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

function operatorThen(value: unknown) {
  fetcher
    .mockResolvedValueOnce(
      json({ authenticated: true, platformAccountId: account, isPlatformOperator: true }),
    )
    .mockResolvedValueOnce(json(value));
}

it('forwards pending school applications without the ops prefix', async () => {
  operatorThen({ applications: [] });
  const response = await handlePlatformAdmin(
    req('platform-admin/school-applications?scope=pending', { auth: true }),
    ['school-applications'],
  );
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[1][0]).toBe(
    'https://api.nuni.tw/v1/auth/platform/school-applications?scope=pending',
  );
  expect(fetcher.mock.calls[1][1].method).toBe('GET');
});

it('forwards school, people, merchant and affiliation writes to the matching nuni-api paths', async () => {
  const writes: Array<[string[], string, Record<string, unknown>]> = [
    [
      ['school-applications', 'app-1', 'decision'],
      'https://api.nuni.tw/v1/auth/platform/school-applications/app-1/decision',
      {
        decision: 'approve',
        reason: '資料齊全，先建檔未開放註冊。',
        idempotencyKey: 'school-decide-1',
      },
    ],
    [
      ['people', 'bind'],
      'https://api.nuni.tw/v1/auth/platform/ops/people/bind',
      {
        tenantId: 'school-one',
        role: 'school_admin',
        email: 'teacher@one.edu.tw',
        idempotencyKey: 'people-add-123',
      },
    ],
    [
      ['merchants', 'interest', 'interest-1', 'decision'],
      'https://api.nuni.tw/v1/auth/platform/ops/merchants/interest/interest-1/decision',
      { decision: 'approve', reason: '資料齊全，准予往下。', idempotencyKey: 'merchant-dec-1' },
    ],
    [
      [
        'merchants',
        'applications',
        'school-one',
        'fma_22222222-2222-4222-8222-222222222222',
        'decision',
      ],
      'https://api.nuni.tw/v1/auth/platform/ops/merchants/applications/school-one/fma_22222222-2222-4222-8222-222222222222/decision',
      { decision: 'approve', reason: '資料齊全，准予往下。', expectedVersion: 7 },
    ],
    [
      ['class-workspace-affiliation-applications', 'aff-1', 'decision'],
      'https://api.nuni.tw/v1/auth/platform/class-workspace-affiliation-applications/aff-1/decision',
      { decision: 'approve', reason: '合成掛靠測試，非正式認證', idempotencyKey: 'aff-decide-123' },
    ],
  ];
  for (const [segments, url, body] of writes) {
    operatorThen({});
    const response = await handlePlatformAdmin(
      req(`platform-admin/${segments.join('/')}`, { auth: true, body }),
      segments,
    );
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(url);
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(body),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    });
  }
});

const guardedOperationPaths = [
  'people/bind',
  'merchants/interest/mpi_11111111-1111-4111-8111-111111111111/decision',
  'merchants/applications/school-one/fma_22222222-2222-4222-8222-222222222222/decision',
  'school-applications/soa_33333333-3333-4333-8333-333333333333/decision',
  'class-workspace-affiliation-applications/cwa_44444444-4444-4444-8444-444444444444/decision',
];

it.each(guardedOperationPaths)(
  'retains session, context, origin and live operator checks for %s',
  async (path) => {
    const segments = path.split('/');
    for (const [options, status] of [
      [{ body: {} }, 401],
      [{ auth: true, body: {}, context: 'b'.repeat(43) }, 409],
      [{ auth: true, body: {}, origin: 'https://evil.test' }, 403],
    ] as const) {
      const response = await handlePlatformAdmin(req(`platform-admin/${path}`, options), segments);
      expect(response.status).toBe(status);
      expect(fetcher).not.toHaveBeenCalled();
    }
    fetcher.mockResolvedValue(
      json({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
    );
    const denied = await handlePlatformAdmin(
      req(`platform-admin/${path}`, { auth: true, body: {} }),
      segments,
    );
    expect(denied.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatch(/sessions\/current$/);
  },
);

it.each([
  'schools/school-one/people',
  'merchant-interest/interest-1/decision',
  'merchant-applications/application-1/decision',
  'merchants/applications/application-1/decision',
  'people/delete',
])('rejects unsupported or incomplete admin aliases: %s', async (path) => {
  operatorThen({});
  const response = await handlePlatformAdmin(
    req(`platform-admin/${path}`, { auth: true, body: {} }),
    path.split('/'),
  );
  expect(response.status).toBe(404);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([undefined, null, 0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])(
  'requires a reviewed merchant application version before forwarding (%s)',
  async (expectedVersion) => {
    operatorThen({});
    const path =
      'merchants/applications/school-one/fma_22222222-2222-4222-8222-222222222222/decision';
    const response = await handlePlatformAdmin(
      req(`platform-admin/${path}`, {
        auth: true,
        body: { decision: 'approve', reason: '人工確認', expectedVersion },
      }),
      path.split('/'),
    );
    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  {
    tenantId: '../other',
    role: 'school_admin',
    email: 'teacher@example.test',
    idempotencyKey: 'valid-key-123',
  },
  {
    tenantId: 'school-one',
    role: 'platform_operator',
    email: 'teacher@example.test',
    idempotencyKey: 'valid-key-123',
  },
  { tenantId: 'school-one', role: 'school_admin', idempotencyKey: 'valid-key-123' },
  {
    tenantId: 'school-one',
    role: 'school_admin',
    email: 'teacher@example.test',
    idempotencyKey: 'short',
  },
  {
    tenantId: 'school-one',
    role: 'school_admin',
    email: 'teacher@example.test',
    idempotencyKey: 'valid-key-123',
    actorId: account,
  },
])('rejects an invalid or caller-forged people binding before upstream writes', async (input) => {
  operatorThen({});
  const response = await handlePlatformAdmin(
    req('platform-admin/people/bind', { auth: true, body: input }),
    ['people', 'bind'],
  );
  expect(response.status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not accept a body tenant override or idempotency key for a versioned merchant application decision', async () => {
  operatorThen({});
  const path =
    'merchants/applications/school-one/fma_22222222-2222-4222-8222-222222222222/decision';
  const response = await handlePlatformAdmin(
    req(`platform-admin/${path}`, {
      auth: true,
      body: {
        decision: 'approve',
        reason: '人工確認',
        expectedVersion: 7,
        tenantId: 'school-two',
        idempotencyKey: 'wrong-contract-123',
      },
    }),
    path.split('/'),
  );
  expect(response.status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not forward operator writes when the Campus One session is missing', async () => {
  expect(
    (
      await handlePlatformAdmin(
        req('platform-admin/school-applications/app-1/decision', {
          body: { decision: 'approve', reason: 'x', idempotencyKey: 'missing-session' },
        }),
        ['school-applications', 'app-1', 'decision'],
      )
    ).status,
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
