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
  const store =
    options?.store ??
    createMemoryGroupStore([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [
            {
              id: 'db',
              name: '資料庫',
              day: 1,
              start: 3,
              end: 4,
              teacher: '王',
              room: 'PH303',
              color: 'blue',
            },
          ],
          meta: { title: '114-1' },
        },
      ],
    ]);
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

it('returns 404 for timetable HTTP getters that stay off the allowlist', async () => {
  const res = await dispatchFnRequest(
    'getTimetableShare',
    request('getTimetableShare', { body: { data: { token: 'abc' } } }),
  );
  expect(res.status).toBe(404);
  expect((await res.json()).error.status).toBe('NOT_FOUND');
});

it('returns 503 尚未啟用 for createTimetableShare when Admin is not configured', async () => {
  const res = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu' } },
      headers: { Authorization: 'Bearer nope' },
    }),
    null,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
});

it('returns 401 when creating a share without a bearer token', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', { body: { data: { schoolId: 'pu' } } }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect([...store.docs.keys()].some((key) => key.startsWith('timetableShares/'))).toBe(false);
});

it('returns 401 for an invalid bearer token before writing a share', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu' } },
      headers: { Authorization: 'Bearer nope' },
    }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect([...store.docs.keys()].some((key) => key.startsWith('timetableShares/'))).toBe(false);
});

it('creates a share then rejects another user revoking it', async () => {
  const { runtime: deps, store } = runtime();
  const created = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(created.status).toBe(200);
  const body = (await created.json()) as { result: { token: string; path: string } };
  expect(body.result.path).toBe(`/timetable/s/${body.result.token}`);
  expect(store.docs.get(`timetableShares/${body.result.token}`)?.ownerUid).toBeUndefined();

  const mallory = runtime({ uid: 'mallory', store });
  const denied = await dispatchFnRequest(
    'revokeTimetableShare',
    request('revokeTimetableShare', {
      body: { data: { token: body.result.token } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    mallory.runtime,
  );
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual({
    error: { status: 'NOT_FOUND', message: '找不到這份分享連結。' },
  });
  expect(store.docs.get(`timetableShares/${body.result.token}`)?.revoked).toBe(false);
});

it('treats a second revoke by the owner as idempotent', async () => {
  const { runtime: deps } = runtime();
  const created = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  const token = ((await created.json()) as { result: { token: string } }).result.token;
  const first = await dispatchFnRequest(
    'revokeTimetableShare',
    request('revokeTimetableShare', {
      body: { data: { token } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  const second = await dispatchFnRequest(
    'revokeTimetableShare',
    request('revokeTimetableShare', {
      body: { data: { token } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ result: { ok: true } });
});

it('rejects invalid create and revoke payloads', async () => {
  const { runtime: deps } = runtime();
  const badSchool = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'PU' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(badSchool.status).toBe(400);
  const badToken = await dispatchFnRequest(
    'revokeTimetableShare',
    request('revokeTimetableShare', {
      body: { data: { token: 'a/b' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(badToken.status).toBe(400);
});

it('returns 429 after 20 createTimetableShare attempts from the same uid in an hour', async () => {
  setUidRateLimiterForTests(
    createUidRateLimiter({ requestsPerMinute: 1000, timetableSharesPerHour: 20 }),
  );
  const { runtime: deps } = runtime();
  for (let i = 0; i < 20; i += 1) {
    const res = await dispatchFnRequest(
      'createTimetableShare',
      request('createTimetableShare', {
        body: { data: { schoolId: 'pu' } },
        headers: { Authorization: 'Bearer valid-token' },
      }),
      deps,
    );
    expect(res.status).toBe(200);
  }
  const limited = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({
    error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' },
  });
});

it('creates a share from submitted courses when the cloud timetable is missing', async () => {
  const { runtime: deps, store } = runtime({ store: createMemoryGroupStore() });
  const res = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: {
        data: {
          schoolId: 'pu',
          name: '我的課表',
          ownerUid: 'mallory',
          courses: [
            {
              id: 'db',
              name: '資料庫',
              day: 1,
              start: 3,
              end: 4,
              teacher: '王',
              room: 'PH303',
              color: 'blue',
            },
          ],
          meta: { title: '本機', email: 'alice@example.com' },
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { result: { token: string } }).result.token;
  const share = store.docs.get(`timetableShares/${token}`);
  expect(share).toMatchObject({ schoolId: 'pu', name: '本機' });
  expect(share?.ownerUid).toBeUndefined();
  expect(JSON.stringify(share)).not.toContain('alice@example.com');
  expect(JSON.stringify(share)).not.toContain('王');
  expect(store.docs.get(`timetableShareOwners/${token}`)).toMatchObject({ ownerUid: 'alice' });
  expect([...store.docs.keys()].some((key) => key.startsWith('users/'))).toBe(false);
});

it('returns 400 for an oversized createTimetableShare body', async () => {
  const { runtime: deps } = runtime({ store: createMemoryGroupStore() });
  const res = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: { data: { schoolId: 'pu', courses: [{ name: 'x'.repeat(70_000) }] } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error.status).toBe('INVALID_ARGUMENT');
});

it('returns 400 for illegal submitted day or period and 404 for createGroup', async () => {
  const { runtime: deps } = runtime({ store: createMemoryGroupStore() });
  const badDay = await dispatchFnRequest(
    'createTimetableShare',
    request('createTimetableShare', {
      body: {
        data: {
          schoolId: 'pu',
          courses: [
            { id: 'x', name: '課', day: 6, start: 1, end: 1, teacher: '', room: '', color: 'gray' },
          ],
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(badDay.status).toBe(400);
  expect((await badDay.json()).error.message).toBe('課程星期或節次不正確，無法分享。');
  const createGroup = await dispatchFnRequest(
    'createGroup',
    request('createGroup', { body: { data: { name: 'x' } } }),
    deps,
  );
  expect(createGroup.status).toBe(404);
});
