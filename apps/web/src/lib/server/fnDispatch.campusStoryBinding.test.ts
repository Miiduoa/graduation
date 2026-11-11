// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { getCloudFunctionUrl } from '../cloudFunctions';
import { HOSTED_WEB_CALLABLES } from '../hostedCallables';

const fly = 'https://nuni-functions.fly.dev';

function request(
  init: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Request {
  return new Request('https://nuni.tw/api/fn/ensureCampusStoryBinding', {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function runtime(uid = 'alice'): FnRuntime {
  const store = createMemoryGroupStore([
    [`users/${uid}`, { status: 'active' }],
    [`schools/pu/members/${uid}`, { status: 'active', role: 'member' }],
  ]);
  return {
    db: store.db as FnRuntime['db'],
    verifyIdToken: async (token: string) => {
      if (token !== 'valid-token') throw new Error('bad token');
      return { uid };
    },
  };
}

beforeEach(() => resetUidRateLimitForTests());

it('hosts ensureCampusStoryBinding on this Next.js app without a Functions URL', () => {
  expect(HOSTED_WEB_CALLABLES).toContain('ensureCampusStoryBinding');
  expect(HOSTED_WEB_CALLABLES).not.toContain('privateGroupFile');
  expect(getCloudFunctionUrl('ensureCampusStoryBinding', { env: {} })).toBe(
    '/api/fn/ensureCampusStoryBinding',
  );
  expect(
    getCloudFunctionUrl('ensureCampusStoryBinding', {
      env: { NEXT_PUBLIC_FUNCTIONS_BASE_URL: fly },
    }),
  ).toBe('/api/fn/ensureCampusStoryBinding');
});

it('rejects ensureCampusStoryBinding without a bearer token', async () => {
  const res = await dispatchFnRequest(
    'ensureCampusStoryBinding',
    request({ body: { data: {} } }),
    runtime(),
  );
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { status: 'UNAUTHENTICATED', message: 'Must be logged in' },
  });
});

it('rejects ensureCampusStoryBinding with an invalid Firebase ID token', async () => {
  const res = await dispatchFnRequest(
    'ensureCampusStoryBinding',
    request({
      body: { data: {} },
      headers: { Authorization: 'Bearer nope' },
    }),
    runtime(),
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
});

it('runs the shared binding handler after verifying the Firebase ID token', async () => {
  const res = await dispatchFnRequest(
    'ensureCampusStoryBinding',
    request({
      body: { data: {} },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    runtime(),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    result: { success: true, stamped: expect.any(Array) },
  });
});
