// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import { resetUidRateLimitForTests } from './uidRateLimit';

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
      ['groups/class-1', { name: '程式設計' }],
      ['groups/class-1/members/teacher', { role: 'instructor', status: 'active' }],
      [
        'groups/class-1/members/student',
        { role: 'student', status: 'active', displayName: '陳同學', studentId: 'S123' },
      ],
    ]);
  return {
    store,
    runtime: {
      db: store.db as FnRuntime['db'],
      verifyIdToken: async (token: string) => {
        if (token !== (options?.token ?? 'valid-token')) throw new Error('bad token');
        return { uid: options?.uid ?? 'teacher' };
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

it('returns 404 for attendance HTTP names that stay off the allowlist', async () => {
  for (const name of ['submitReaction', 'submitPollResponse', 'verifyAttendanceClaim']) {
    const res = await dispatchFnRequest(name, request(name, { body: { data: {} } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.status).toBe('NOT_FOUND');
  }
});

it('returns 503 尚未啟用 for startLiveSession when Admin is not configured', async () => {
  const res = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1' } },
      headers: { Authorization: 'Bearer nope' },
    }),
    null,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: { status: 'UNAVAILABLE', message: '尚未啟用' },
  });
});

it('returns 401 when starting attendance without a bearer token', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', { body: { data: { groupId: 'class-1', requestId: 'attempt-1' } } }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect([...store.docs.keys()].some((key) => key.includes('liveSessions'))).toBe(false);
});

it('returns 401 for an invalid bearer token before opening a session', async () => {
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1', requestId: 'attempt-1' } },
      headers: { Authorization: 'Bearer nope' },
    }),
    deps,
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error.status).toBe('UNAUTHENTICATED');
  expect([...store.docs.keys()].some((key) => key.includes('attendanceSessions'))).toBe(false);
});

it('returns 403 when a student tries to start or end a session', async () => {
  const { runtime: deps, store } = runtime({ uid: 'student' });
  const start = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1', requestId: 'attempt-1' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(start.status).toBe(403);
  expect((await start.json()).error.status).toBe('PERMISSION_DENIED');
  expect([...store.docs.keys()].some((key) => key.includes('liveSessions'))).toBe(false);
});

it('lets an instructor start, then rejects a non-member join and an expired token', async () => {
  const teacher = runtime({ uid: 'teacher' });
  const started = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1', requestId: 'attempt-1', qrExpiryMinutes: 10 } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    teacher.runtime,
  );
  expect(started.status).toBe(200);
  const session = (await started.json()) as {
    result: { sessionId: string; qrToken: string; success: boolean };
  };
  expect(session.result.success).toBe(true);

  const outsider = runtime({ uid: 'outsider', store: teacher.store });
  const denied = await dispatchFnRequest(
    'joinLiveSession',
    request('joinLiveSession', {
      body: {
        data: {
          groupId: 'class-1',
          sessionId: session.result.sessionId,
          qrToken: session.result.qrToken,
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    outsider.runtime,
  );
  expect(denied.status).toBe(403);
  expect((await denied.json()).error.status).toBe('PERMISSION_DENIED');

  const student = runtime({ uid: 'student', store: teacher.store });
  teacher.store.docs.get(
    `groups/class-1/liveSessionSecrets/${session.result.sessionId}`,
  )!.qrExpiresAt = { toMillis: () => Date.now() - 1 };
  const expired = await dispatchFnRequest(
    'joinLiveSession',
    request('joinLiveSession', {
      body: {
        data: {
          groupId: 'class-1',
          sessionId: session.result.sessionId,
          qrToken: session.result.qrToken,
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  expect(expired.status).toBe(504);
  expect((await expired.json()).error.status).toBe('DEADLINE_EXCEEDED');
});

it('treats a second join by the same student as idempotent and does not double-count', async () => {
  const teacher = runtime({ uid: 'teacher' });
  const started = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1', requestId: 'attempt-1' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    teacher.runtime,
  );
  const session = (await started.json()) as { result: { sessionId: string; qrToken: string } };
  const student = runtime({ uid: 'student', store: teacher.store });
  const first = await dispatchFnRequest(
    'joinLiveSession',
    request('joinLiveSession', {
      body: {
        data: {
          groupId: 'class-1',
          sessionId: session.result.sessionId,
          qrToken: session.result.qrToken,
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  const second = await dispatchFnRequest(
    'joinLiveSession',
    request('joinLiveSession', {
      body: {
        data: {
          groupId: 'class-1',
          sessionId: session.result.sessionId,
          qrToken: session.result.qrToken,
        },
      },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ result: { success: true, alreadyJoined: true } });
  expect(
    teacher.store.docs.get(`groups/class-1/attendanceSessions/${session.result.sessionId}`)
      ?.attendeeCount,
  ).toBe(1);
});

it('returns 404 for createGroup even when attendance handlers are loaded', async () => {
  const { runtime: deps } = runtime();
  const res = await dispatchFnRequest(
    'createGroup',
    request('createGroup', {
      body: { data: { name: 'x' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(404);
});

it('returns 400 for an oversized joinLiveSession body', async () => {
  const { runtime: deps } = runtime({ uid: 'student' });
  const res = await dispatchFnRequest(
    'joinLiveSession',
    request('joinLiveSession', {
      body: { data: { groupId: 'class-1', sessionId: 'session_x', qrToken: 'x'.repeat(70_000) } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error.status).toBe('INVALID_ARGUMENT');
});

it('HTTP correction requires a real teacher identity and writes a counted, audited receipt', async () => {
  const teacher = runtime({ uid: 'teacher' });
  const started = await dispatchFnRequest(
    'startLiveSession',
    request('startLiveSession', {
      body: { data: { groupId: 'class-1', requestId: 'manual-session' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    teacher.runtime,
  );
  expect(started.status).toBe(200);
  const session = (await started.json()) as { result: { sessionId: string } };
  const data = {
    groupId: 'class-1',
    sessionId: session.result.sessionId,
    studentUid: 'student',
    status: 'late',
    reason: '授課教師依現場紀錄確認遲到',
    requestId: 'teacher-confirm-1',
  };
  const student = runtime({ uid: 'student', store: teacher.store });
  const denied = await dispatchFnRequest(
    'correctAttendanceRecord',
    request('correctAttendanceRecord', {
      body: { data },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    student.runtime,
  );
  expect(denied.status).toBe(403);
  expect((await denied.json()).error.status).toBe('PERMISSION_DENIED');
  const approved = await dispatchFnRequest(
    'correctAttendanceRecord',
    request('correctAttendanceRecord', {
      body: { data },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    teacher.runtime,
  );
  expect(approved.status).toBe(200);
  expect((await approved.json()).result).toMatchObject({ success: true, status: 'late' });
  const attendance = teacher.store.docs.get(
    `groups/class-1/attendanceSessions/${session.result.sessionId}`,
  );
  expect(attendance?.attendeeCount).toBe(1);
  expect([...teacher.store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/')))
    .toHaveLength(1);
});

it('exposes manual corrections on the explicit hosted allowlist but requires a bearer token', async () => {
  const { runtime: deps, store } = runtime({ uid: 'teacher' });
  const denied = await dispatchFnRequest(
    'correctAttendanceRecord',
    request('correctAttendanceRecord', {
      body: { data: {
        groupId: 'class-1',
        sessionId: 'session-existing',
        studentUid: 'student',
        status: 'present',
        reason: '授課教師現場確認學生出席',
        requestId: 'manual-correction-id',
      } },
    }),
    deps,
  );
  expect(denied.status).toBe(401);
  expect((await denied.json()).error.status).toBe('UNAUTHENTICATED');
  expect([...store.docs.keys()].some((key) => key.includes('attendanceCorrections'))).toBe(false);
});
it('does not accidentally expose unrelated privileged functions when corrections are enabled', async () => {
  const { runtime: deps } = runtime({ uid: 'teacher' });
  const blocked = await dispatchFnRequest(
    'verifyAttendanceClaim',
    request('verifyAttendanceClaim', {
      body: { data: { groupId: 'class-1' } },
      headers: { Authorization: 'Bearer valid-token' },
    }),
    deps,
  );
  expect(blocked.status).toBe(404);
  expect((await blocked.json()).error.status).toBe('NOT_FOUND');
});
