// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import {
  createUidRateLimiter,
  resetUidRateLimitForTests,
  setUidRateLimiterForTests,
} from './uidRateLimit';

function request(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request(`https://nuni.tw/api/fn/${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function runtime(options?: {
  uid?: string;
  token?: string;
  store?: ReturnType<typeof createMemoryGroupStore>;
}): { runtime: FnRuntime; store: ReturnType<typeof createMemoryGroupStore> } {
  const store = options?.store ?? createMemoryGroupStore();
  return {
    store,
    runtime: {
      db: store.db as FnRuntime['db'],
      verifyIdToken: async (token: string) => {
        if (token !== (options?.token ?? 'valid-token')) throw new Error('bad token');
        return { uid: options?.uid ?? 'alice' };
      },
    },
  };
}

beforeEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

afterEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

it('returns 404 callable error for names outside the allowlist', async () => {
  const res = await dispatchFnRequest(
    'askCampusAssistant',
    request('askCampusAssistant', { body: { data: {} } }),
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { status: 'NOT_FOUND', message: 'Unknown function: askCampusAssistant' },
  });
});

it('returns 404 for Firestore trigger names and never treats them as hosted', async () => {
  for (const name of ['onUserProfileChanged', 'onInspectionWritten', 'transferGroupOwnership']) {
    const res = await dispatchFnRequest(name, request(name, { body: { data: {} } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.status).toBe('NOT_FOUND');
  }
});

it('returns 503 尚未啟用 when the service account is not configured', async () => {
  const res = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', { body: { data: {} }, headers: { Authorization: 'Bearer nope' } }),
    null,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
});

it('returns 404 for createGroup even when a runtime is provided', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'createGroup',
    request('createGroup', {
      body: { data: { name: '讀書會', type: 'study', schoolId: 'pu' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { status: 'NOT_FOUND', message: 'Unknown function: createGroup' },
  });
  expect(store.docs.size).toBe(0);
});

it('returns 401 when a configured handler is called without a bearer token', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'leaveGroup',
    request('leaveGroup', { body: { data: { groupId: 'one' } } }),
    deps,
  );
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { status: 'UNAUTHENTICATED', message: 'Must be logged in' },
  });
  expect(store.docs.size).toBe(0);
});

it('returns 401 for an invalid bearer token before running a handler', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'ABCD1234' } },
      headers: { Authorization: 'Bearer nope' },
    }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect(store.docs.size).toBe(0);
});

it('joins by code, then treats a second join as idempotent', async () => {
  const store = createMemoryGroupStore([
    ['schools/pu/members/alice', { status: 'active' }],
    [
      'groups/one',
      { schoolId: 'pu', name: '讀書會', type: 'study', joinCode: 'JOINCODE', memberCount: 1 },
    ],
  ]);
  const { runtime: deps } = runtime({ store });
  const first = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'joincode' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    result: { success: true, groupId: 'one', reused: false },
  });
  const second = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'JOINCODE' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(await second.json()).toMatchObject({
    result: { success: true, groupId: 'one', reused: true },
  });
  expect(store.docs.get('groups/one')?.memberCount).toBe(2);
});

it('rejects an unknown invitation code', async () => {
  const { runtime: deps } = runtime({
    store: createMemoryGroupStore([['schools/pu/members/alice', { status: 'active' }]]),
  });
  const res = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'NOPE0000' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(404);
  expect((await res.json()).error.message).toBe('Invalid join code');
});

it('does not let the last remaining owner leave', async () => {
  const store = createMemoryGroupStore([
    [
      'groups/one',
      { schoolId: 'pu', name: '讀書會', type: 'study', joinCode: 'JOINCODE', memberCount: 1 },
    ],
    ['groups/one/members/alice', { uid: 'alice', role: 'owner', status: 'active' }],
    ['users/alice/groups/one', { groupId: 'one', schoolId: 'pu', role: 'owner', status: 'active' }],
  ]);
  const { runtime: deps } = runtime({ store });
  const res = await dispatchFnRequest(
    'leaveGroup',
    request('leaveGroup', {
      body: { data: { groupId: 'one' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(store.docs.get('groups/one/members/alice')?.status).toBe('active');
  expect(store.docs.get('groups/one')?.memberCount).toBe(1);
});

it('lets a non-owner last member leave and never decrements below zero', async () => {
  const store = createMemoryGroupStore([
    [
      'groups/one',
      { schoolId: 'pu', name: '讀書會', type: 'study', joinCode: 'JOINCODE', memberCount: 1 },
    ],
    ['groups/one/members/alice', { uid: 'alice', role: 'member', status: 'active' }],
    [
      'users/alice/groups/one',
      { groupId: 'one', schoolId: 'pu', role: 'member', status: 'active' },
    ],
  ]);
  const { runtime: deps } = runtime({ store });
  const res = await dispatchFnRequest(
    'leaveGroup',
    request('leaveGroup', {
      body: { data: { groupId: 'one' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    result: { success: true, status: 'left', reused: false },
  });
  expect(store.docs.get('groups/one')?.memberCount).toBe(0);
  expect(store.docs.get('groups/one/members/alice')?.status).toBe('left');
  expect(store.docs.get('users/alice/groups/one')?.status).toBe('left');
});

it('does not reflect a disallowed Origin', async () => {
  const res = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: {} },
      headers: { Origin: 'https://evil.example' },
    }),
    null,
  );
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
});

it('returns 429 after more than 10 authenticated requests per uid per minute', async () => {
  const { runtime: deps } = runtime({
    store: createMemoryGroupStore([['schools/pu/members/alice', { status: 'active' }]]),
  });
  for (let i = 0; i < 10; i += 1) {
    const res = await dispatchFnRequest(
      'joinGroupByCode',
      request('joinGroupByCode', {
        body: { data: { schoolId: 'pu', joinCode: 'NOPE0000' } },
        headers: { Authorization: 'Bearer valid-token' },
      }),
      deps,
    );
    expect(res.status).toBe(404);
  }
  const limited = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'NOPE0000' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({
    error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' },
  });
});

it('returns 429 after 20 invalid join codes from the same uid', async () => {
  setUidRateLimiterForTests(
    createUidRateLimiter({ requestsPerMinute: 1000, invalidJoinCodesPerHour: 20 }),
  );
  const { runtime: deps } = runtime({
    store: createMemoryGroupStore([['schools/pu/members/alice', { status: 'active' }]]),
  });
  for (let i = 0; i < 20; i += 1) {
    const res = await dispatchFnRequest(
      'joinGroupByCode',
      request('joinGroupByCode', {
        body: { data: { schoolId: 'pu', joinCode: 'NOPE0000' } },
        headers: { Authorization: 'Bearer valid-token' },
      }),
      deps,
    );
    expect(res.status).toBe(404);
  }
  const limited = await dispatchFnRequest(
    'joinGroupByCode',
    request('joinGroupByCode', {
      body: { data: { schoolId: 'pu', joinCode: 'NOPE0000' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(limited.status).toBe(429);
  expect((await limited.json()).error.status).toBe('RESOURCE_EXHAUSTED');
});

