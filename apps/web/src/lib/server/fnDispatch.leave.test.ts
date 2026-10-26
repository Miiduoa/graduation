// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import { resetUidRateLimitForTests } from './uidRateLimit';

const REQUEST_ID = 'leave-2026-good-id';

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

function seedStore() {
  return createMemoryGroupStore([
    ['schools/pu/members/s1', { status: 'active', role: 'student' }],
    ['schools/pu/members/t1', { status: 'active', role: 'instructor' }],
    ['schools/pu/members/other', { status: 'active', role: 'student' }],
    ['schools/pu/courseTeachers/資料庫｜王老師', { teacherUids: ['t1'] }],
    ['users/s1', { displayName: '陳同學' }],
    [
      'users/s1/schools/pu/personalTimetable/current',
      { schoolId: 'pu', courses: [{ id: 'c1', name: '資料庫', teacher: '王老師' }] },
    ],
  ]);
}

function runtime(options?: {
  uid?: string;
  token?: string;
  store?: ReturnType<typeof seedStore>;
  revoked?: boolean;
  disabled?: boolean;
  verifyCalls?: Array<{ token: string; checkRevoked?: boolean }>;
}): { runtime: FnRuntime; store: ReturnType<typeof seedStore> } {
  const store = options?.store ?? seedStore();
  return {
    store,
    runtime: {
      db: store.db as FnRuntime['db'],
      verifyIdToken: async (token: string, checkRevoked?: boolean) => {
        options?.verifyCalls?.push({ token, checkRevoked });
        if (checkRevoked && options?.revoked) {
          throw Object.assign(new Error('auth/id-token-revoked'), { code: 'auth/id-token-revoked' });
        }
        if (checkRevoked && options?.disabled) {
          throw Object.assign(new Error('auth/user-disabled'), { code: 'auth/user-disabled' });
        }
        if (token !== (options?.token ?? 'valid-token')) throw new Error('bad token');
        return { uid: options?.uid ?? 's1' };
      },
    },
  };
}

const submitBody = {
  schoolId: 'pu',
  requestId: REQUEST_ID,
  startDate: '2026-10-26',
  endDate: '2026-10-26',
  kind: 'sick',
  period: 'all',
  detail: '需要請假',
  courseIds: ['c1'],
};

beforeEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  vi.stubEnv('LEAVE_WEB_API_ENABLED', 'true');
});

afterEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  vi.unstubAllEnvs();
});

it('returns 503 尚未啟用 for leave routes when the server write flag is off', async () => {
  vi.stubEnv('LEAVE_WEB_API_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'true');
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
  expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(false);
});

it('does not use NEXT_PUBLIC_LEAVE_WEB_API to gate leave writes', async () => {
  vi.stubEnv('LEAVE_WEB_API_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'false');
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(200);
  expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(true);
});

it('blocks unauthenticated leave submit before writing', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', { body: { data: submitBody } }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(false);
});

it('blocks a caller with no school membership', async () => {
  const { runtime: deps, store } = runtime({ uid: 'outsider' });
  const res = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(403);
  expect((await res.json()).error.status).toBe('PERMISSION_DENIED');
  expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(false);
});

it('blocks a cross-campus leave submit', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: { ...submitBody, schoolId: 'ntpu' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(403);
  expect((await res.json()).error.status).toBe('PERMISSION_DENIED');
  expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(false);
});

it('blocks a reused request id when the payload changed', async () => {
  const student = runtime({ uid: 's1' });
  const first = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  expect(first.status).toBe(200);
  const duplicate = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: { ...submitBody, detail: '改變原因' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.status).toBe('ALREADY_EXISTS');
  expect(student.store.docs.get('leaveRequests/' + REQUEST_ID)?.detail).toBe('需要請假');
});

it('does not let another student withdraw someone else\'s leave request', async () => {
  const owner = runtime({ uid: 's1' });
  const created = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    owner.runtime,
  );
  expect(created.status).toBe(200);
  const other = runtime({ uid: 'other', store: owner.store });
  const withdrawn = await dispatchFnRequest(
    'withdrawLeaveRequest',
    request('withdrawLeaveRequest', {
      body: { data: { requestId: REQUEST_ID } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    other.runtime,
  );
  expect(withdrawn.status).toBe(404);
  expect((await withdrawn.json()).error.status).toBe('NOT_FOUND');
  expect(owner.store.docs.get('leaveRequests/' + REQUEST_ID)?.status).toBe('pending');
});

it('checks revoked tokens only for the four leave routes', async () => {
  const leaveCalls: Array<{ token: string; checkRevoked?: boolean }> = [];
  const otherCalls: Array<{ token: string; checkRevoked?: boolean }> = [];
  const leave = runtime({ verifyCalls: leaveCalls });
  const leaveRes = await dispatchFnRequest(
    'submitLeaveRequest',
    request('submitLeaveRequest', {
      body: { data: submitBody },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    leave.runtime,
  );
  expect(leaveRes.status).toBe(200);
  expect(leaveCalls[0]?.checkRevoked).toBe(true);

  const other = runtime({ uid: 'alice', verifyCalls: otherCalls });
  await dispatchFnRequest(
    'leaveGroup',
    request('leaveGroup', {
      body: { data: { groupId: 'class-1' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    other.runtime,
  );
  expect(otherCalls[0]?.checkRevoked).not.toBe(true);
});

it('blocks revoked or disabled accounts on leave routes before writing', async () => {
  const leaveNames = [
    ['submitLeaveRequest', submitBody],
    ['withdrawLeaveRequest', { requestId: REQUEST_ID }],
    ['reviewLeaveRequest', { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' }],
    ['listLeaveReviewQueue', { schoolId: 'pu' }],
  ] as const;
  for (const kind of ['revoked', 'disabled'] as const) {
    for (const [name, data] of leaveNames) {
      const { runtime: deps, store } = runtime({ [kind]: true });
      const res = await dispatchFnRequest(
        name,
        request(name, {
          body: { data },
          headers: { Authorization: 'Bearer valid-token' },
        }),
        deps,
      );
      expect(res.status).toBe(401);
      expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
      expect(store.docs.has('leaveRequests/' + REQUEST_ID)).toBe(false);
    }
  }
});
