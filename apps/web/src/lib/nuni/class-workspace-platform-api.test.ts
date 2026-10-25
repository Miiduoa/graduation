// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const sessionId = 'cws_11111111-1111-4111-8111-111111111111';
const account = 'pa_33333333-3333-4333-8333-333333333333';
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const fetcher = vi.fn();

function call(path: string, method = 'GET', body?: unknown, cookie = true) {
  return handleNuni(
    new NextRequest(`https://nuni.tw/api/nuni/${path}`, {
      method,
      headers: {
        ...(cookie
          ? {
              Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
              'X-Campus-Session': sessionContext(session),
            }
          : {}),
        Origin: 'https://nuni.tw',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    path.split('/'),
  );
}

function respond(value: unknown, status = 200) {
  fetcher.mockResolvedValue(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'class-session-secret-longer-than-32-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('rejects classroom-session reads without the Campus One session', async () => {
  expect((await call(`class-workspaces/${workspaceId}/classroom-sessions`, 'GET', undefined, false)).status).toBe(
    401,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('forwards classroom-session list, roster and pending makeup reads to nuni-api', async () => {
  respond({ sessions: [{ id: sessionId, title: '本堂課', state: 'open' }] });
  expect((await call(`class-workspaces/${workspaceId}/classroom-sessions`)).status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.nuni.tw/v1/auth/platform/class-workspaces/${workspaceId}/classroom-sessions`,
  );
  expect(fetcher.mock.calls[0][1].method).toBe('GET');
  respond({ present: [], absent: [], late: [] });
  expect(
    (await call(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/roster`)).status,
  ).toBe(200);
  respond({ requests: [] });
  expect(
    (await call(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup-requests`))
      .status,
  ).toBe(200);
});

it('forwards empty JSON POSTs for check-in, makeup-requests and end', async () => {
  respond({});
  const checkIn = await call(
    `class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/check-in`,
    'POST',
    {},
  );
  expect(checkIn.status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.nuni.tw/v1/auth/platform/class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/check-in`,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    body: '{}',
    headers: expect.objectContaining({
      'Content-Type': 'application/json',
      Authorization: `Platform ${session.sessionHandle}`,
    }),
  });
  respond({});
  const makeup = await call(
    `class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup-requests`,
    'POST',
    {},
  );
  expect(makeup.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({});
  respond({});
  const ended = await call(
    `class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/end`,
    'POST',
    {},
  );
  expect(ended.status).toBe(200);
  expect(fetcher.mock.calls[2][1].method).toBe('POST');
  expect(fetcher.mock.calls[2][1].body).toBe('{}');
});

it('forwards affiliation applications to the nuni-api path used by course-access tests', async () => {
  respond({ id: 'aff-1' }, 201);
  const result = await call(`class-workspaces/${workspaceId}/affiliation-applications`, 'POST', {
    tenantId: 'campus-demo',
    sectionId: 'acceptance-section',
    justification: '獨立測試的正式班次掛靠流程',
    idempotencyKey: 'web-affiliate-abcdefgh',
  });
  expect(result.status).toBe(201);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.nuni.tw/v1/auth/platform/class-workspaces/${workspaceId}/affiliation-applications`,
  );
  expect(fetcher.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    tenantId: 'campus-demo',
    sectionId: 'acceptance-section',
    justification: '獨立測試的正式班次掛靠流程',
    idempotencyKey: 'web-affiliate-abcdefgh',
  });
});

it('passes invite maxUses through with a cap of 100', async () => {
  respond({ code: 'INVITE1' });
  expect(
    (
      await call(`class-workspaces/${workspaceId}/invites`, 'POST', {
        idempotencyKey: 'web-invite-abcdefgh',
        maxUses: 100,
      })
    ).status,
  ).toBe(201);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    idempotencyKey: 'web-invite-abcdefgh',
    maxUses: 100,
  });
  expect(
    (
      await call(`class-workspaces/${workspaceId}/invites`, 'POST', {
        idempotencyKey: 'web-invite-abcdefgh',
        maxUses: 101,
      })
    ).status,
  ).toBe(422);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('forwards a makeup decision with platformAccountId', async () => {
  respond({});
  const result = await call(
    `class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup`,
    'POST',
    { platformAccountId: account, decision: 'accept' },
  );
  expect(result.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    platformAccountId: account,
    decision: 'accept',
  });
});
