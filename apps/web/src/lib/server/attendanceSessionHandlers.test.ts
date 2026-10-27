// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createLiveSessionHandlers } from './attendanceSessionHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';
import { HttpsError } from './httpsError';

function seedStore() {
  return createMemoryGroupStore([
    ['groups/class-1', { name: '程式設計' }],
    ['groups/class-1/members/teacher', { role: 'instructor', status: 'active' }],
    [
      'groups/class-1/members/student',
      { role: 'student', status: 'active', displayName: '陳同學', studentId: 'S123' },
    ],
  ]);
}

it('requires authentication for every mutation', async () => {
  const store = seedStore();
  const handlers = createLiveSessionHandlers({ db: store.db as never });
  for (const handler of Object.values(handlers)) {
    await expect(handler({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
  }
});

it.each([
  { groupId: '../other' },
  { groupId: '' },
  { requestId: 'a/b' },
  { requestId: null },
  { qrExpiryMinutes: 0 },
  { qrExpiryMinutes: 31 },
  { qrExpiryMinutes: 1.5 },
  { qrExpiryMinutes: '5' },
  { qrExpiryMinutes: Infinity },
  { classroomLat: 0 },
  { classroomLat: 91, classroomLng: 0 },
  { classroomLat: 0, classroomLng: 181 },
])('rejects malformed start input %j', async (data) => {
  const store = seedStore();
  const handlers = createLiveSessionHandlers({ db: store.db as never });
  await expect(
    handlers.startLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', requestId: 'attempt-1', ...data },
    }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(store.docs.size).toBe(3);
});

it.each([
  { role: 'instructor', status: 'inactive' },
  { role: 'instructor' },
  { role: 'student', status: 'active' },
  { role: 'admin', status: 'active' },
])('rejects start without a current active instructor role: %j', async (member) => {
  const store = seedStore();
  store.docs.set('groups/class-1/members/teacher', member);
  const handlers = createLiveSessionHandlers({ db: store.db as never });
  await expect(
    handlers.startLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', requestId: 'attempt-1' },
    }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
});

describe('live attendance session handlers', () => {
  let store: ReturnType<typeof seedStore>;
  let handlers: ReturnType<typeof createLiveSessionHandlers>;
  let time: number;
  let notifyStarted: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn>;
  let logger: { warn: (...args: unknown[]) => void };

  function startRequest(data: Record<string, unknown> = {}, uid = 'teacher') {
    return {
      auth: { uid },
      data: { groupId: 'class-1', requestId: 'attempt-1', ...data },
    };
  }
  function sessionRequest(
    session: { sessionId: string; qrToken: string },
    data: Record<string, unknown> = {},
    uid = 'student',
  ) {
    return {
      auth: { uid },
      data: { groupId: 'class-1', sessionId: session.sessionId, qrToken: session.qrToken, ...data },
    };
  }
  function path(session: { sessionId: string }, collection: string) {
    return `groups/class-1/${collection}/${session.sessionId}`;
  }

  beforeEach(() => {
    store = seedStore();
    time = Date.parse('2026-10-07T03:00:00Z');
    notifyStarted = vi.fn();
    warn = vi.fn();
    logger = { warn: warn as (...args: unknown[]) => void };
    handlers = createLiveSessionHandlers({
      db: store.db as never,
      now: () => time,
      notifyStarted: notifyStarted as never,
      logger,
    });
  });

  it('creates synchronized public metadata and private token, preserving zero coordinates', async () => {
    const result = await handlers.startLiveSession(
      startRequest({ classroomLat: 0, classroomLng: 0 }),
    );
    const live = store.docs.get(path(result, 'liveSessions'));
    const attendance = store.docs.get(path(result, 'attendanceSessions'));
    const secret = store.docs.get(path(result, 'liveSessionSecrets'));
    expect(live).toMatchObject({
      schemaVersion: 2,
      sessionId: result.sessionId,
      groupId: 'class-1',
      teacherId: 'teacher',
      attendeeCount: 0,
      location: { lat: 0, lng: 0, radiusM: 100 },
    });
    expect((live?.startedAt as { toMillis: () => number }).toMillis()).toBe(
      (attendance?.startedAt as { toMillis: () => number }).toMillis(),
    );
    expect((live?.qrExpiresAt as { toMillis: () => number }).toMillis()).toBe(time + 300_000);
    expect(secret?.qrToken).toBe(result.qrToken);
    expect(live?.qrToken).toBeUndefined();
    expect(attendance?.qrToken).toBeUndefined();
    expect(live?.attendees).toBeUndefined();
    expect(attendance?.attendees).toBeUndefined();
  });

  it('a failed transaction leaves no partial session or notification', async () => {
    store.failNextCommit();
    await expect(handlers.startLiveSession(startRequest())).rejects.toThrow('commit unavailable');
    expect(store.docs.size).toBe(3);
    expect(notifyStarted).not.toHaveBeenCalled();
  });

  it('notification failure cannot mask committed success or duplicate a retry', async () => {
    notifyStarted.mockRejectedValue(
      Object.assign(new Error('delivery unavailable'), { code: 'unavailable' }),
    );
    const first = await handlers.startLiveSession(startRequest());
    time += 60_000;
    const second = await handlers.startLiveSession(startRequest());
    expect(second).toEqual({ ...first, reused: true });
    expect(store.docs.size).toBe(6);
    expect(notifyStarted).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('same request key cannot silently change the session settings', async () => {
    await handlers.startLiveSession(startRequest());
    await expect(
      handlers.startLiveSession(startRequest({ qrExpiryMinutes: 10 })),
    ).rejects.toMatchObject({
      code: 'already-exists',
    });
  });

  it('request keys are scoped to the instructor and optional for older callers', async () => {
    store.docs.set('groups/class-1/members/other-teacher', { status: 'active', role: 'owner' });
    const first = await handlers.startLiveSession(startRequest());
    const second = await handlers.startLiveSession(startRequest({}, 'other-teacher'));
    const oldClient = await handlers.startLiveSession(startRequest({ requestId: undefined }));
    expect(new Set([first.sessionId, second.sessionId, oldClient.sessionId]).size).toBe(3);
    expect(store.docs.get(path(first, 'liveSessions'))?.active).toBe(false);
    expect(store.docs.get(path(second, 'liveSessions'))?.active).toBe(false);
    expect(store.docs.get(path(oldClient, 'liveSessions'))?.active).toBe(true);
  });

  it('opening a new session for the same class ends the previous one and leaves other classes open', async () => {
    store.docs.set('groups/class-2', { name: '資料結構' });
    store.docs.set('groups/class-2/members/teacher', { role: 'instructor', status: 'active' });
    const classA = await handlers.startLiveSession(startRequest({ requestId: 'class-a' }));
    const classB = await handlers.startLiveSession(
      startRequest({ groupId: 'class-2', requestId: 'class-b' }),
    );
    const nextA = await handlers.startLiveSession(startRequest({ requestId: 'class-a-next' }));
    expect(store.docs.get(path(classA, 'liveSessions'))?.active).toBe(false);
    expect(store.docs.get(path(classA, 'attendanceSessions'))?.active).toBe(false);
    expect(
      (
        store.docs.get(path(classA, 'liveSessions'))?.endedAt as { toMillis: () => number }
      ).toMillis(),
    ).toBe(
      (
        store.docs.get(path(classA, 'attendanceSessions'))?.endedAt as { toMillis: () => number }
      ).toMillis(),
    );
    expect(store.docs.get(`groups/class-2/liveSessions/${classB.sessionId}`)?.active).toBe(true);
    expect(store.docs.get(`groups/class-2/attendanceSessions/${classB.sessionId}`)?.active).toBe(
      true,
    );
    expect(store.docs.get(path(nextA, 'liveSessions'))?.active).toBe(true);
    expect(store.docs.get(path(nextA, 'attendanceSessions'))?.active).toBe(true);
  });

  it('ending one session does not close another class or another leftover session', async () => {
    store.docs.set('groups/class-2', { name: '資料結構' });
    store.docs.set('groups/class-2/members/teacher', { role: 'instructor', status: 'active' });
    const classA = await handlers.startLiveSession(startRequest());
    const leftover = {
      schemaVersion: 2,
      sessionId: 'session_leftover',
      groupId: 'class-1',
      teacherId: 'teacher',
      startedAt: { toMillis: () => time - 1000 },
      endedAt: null,
      active: true,
      qrExpiresAt: { toMillis: () => time + 300_000 },
      attendeeCount: 0,
    };
    store.docs.set('groups/class-1/liveSessions/session_leftover', { ...leftover, reactions: {} });
    store.docs.set('groups/class-1/attendanceSessions/session_leftover', {
      ...leftover,
      liveSessionId: 'session_leftover',
      attendanceMode: 'qr',
      source: 'live_session',
      qrEnabled: true,
    });
    const classB = await handlers.startLiveSession(
      startRequest({ groupId: 'class-2', requestId: 'class-b' }),
    );
    await handlers.endLiveSession(sessionRequest(classA, {}, 'teacher'));
    expect(store.docs.get(path(classA, 'liveSessions'))?.active).toBe(false);
    expect(store.docs.get(path(classA, 'attendanceSessions'))?.active).toBe(false);
    expect(store.docs.get('groups/class-1/liveSessions/session_leftover')?.active).toBe(true);
    expect(store.docs.get('groups/class-1/attendanceSessions/session_leftover')?.active).toBe(true);
    expect(store.docs.get(`groups/class-2/liveSessions/${classB.sessionId}`)?.active).toBe(true);
    expect(store.docs.get(`groups/class-2/attendanceSessions/${classB.sessionId}`)?.active).toBe(
      true,
    );
  });

  it('end is atomic and repeated starts and ends never reopen or retime a completed session', async () => {
    const session = await handlers.startLiveSession(startRequest());
    time += 1000;
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    const endedAt = (
      store.docs.get(path(session, 'liveSessions'))?.endedAt as { toMillis: () => number }
    ).toMillis();
    time += 2000;
    expect(await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'))).toEqual({
      success: true,
      alreadyEnded: true,
    });
    expect(await handlers.startLiveSession(startRequest())).toMatchObject({
      active: false,
      reused: true,
      sessionId: session.sessionId,
    });
    expect(
      (
        store.docs.get(path(session, 'liveSessions'))?.endedAt as { toMillis: () => number }
      ).toMillis(),
    ).toBe(endedAt);
    expect(
      (
        store.docs.get(path(session, 'attendanceSessions'))?.endedAt as { toMillis: () => number }
      ).toMillis(),
    ).toBe(endedAt);
  });

  it('ending requires both current instructor membership and original ownership', async () => {
    const session = await handlers.startLiveSession(startRequest());
    store.docs.set('groups/class-1/members/other-teacher', {
      status: 'active',
      role: 'instructor',
    });
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'other-teacher')),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    store.docs.set('groups/class-1/members/teacher', { status: 'inactive', role: 'instructor' });
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'teacher')),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(store.docs.get(path(session, 'liveSessions'))?.active).toBe(true);
  });

  it('rejects a broken canonical pair rather than fabricating attendance metadata', async () => {
    const session = await handlers.startLiveSession(startRequest());
    store.docs.delete(path(session, 'attendanceSessions'));
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'teacher')),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    await expect(handlers.startLiveSession(startRequest())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.get(path(session, 'liveSessions'))?.active).toBe(true);
  });

  it.each([undefined, '', 'wrong-token-long-enough'])(
    'requires a correct QR token, received %s',
    async (qrToken) => {
      const session = await handlers.startLiveSession(startRequest());
      await expect(
        handlers.joinLiveSession(sessionRequest(session, { qrToken })),
      ).rejects.toMatchObject({
        code: qrToken ? 'permission-denied' : 'invalid-argument',
      });
      expect(store.docs.get(path(session, 'liveSessions'))?.attendeeCount).toBe(0);
    },
  );

  it('rejects tokens at their exact expiry boundary and legacy publicly exposed tokens', async () => {
    const session = await handlers.startLiveSession(startRequest());
    time += 300_000;
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
    time -= 1000;
    store.docs.delete(path(session, 'liveSessionSecrets'));
    const live = store.docs.get(path(session, 'liveSessions'));
    if (live) live.qrToken = session.qrToken;
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('students outside the group or with revoked membership cannot join with a valid token', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await expect(
      handlers.joinLiveSession(sessionRequest(session, {}, 'outsider')),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    store.docs.set('groups/class-1/members/student', { status: 'inactive', role: 'student' });
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('confirmed attendance keeps its original timestamp, identity and count on retries', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const first = await handlers.joinLiveSession(
      sessionRequest(session, { displayName: 'Forged', studentId: 'Forged' }),
    );
    time += 5000;
    const second = await handlers.joinLiveSession(sessionRequest(session));
    expect(second).toEqual({ ...first, alreadyJoined: true });
    expect(
      store.docs.get(`${path(session, 'attendanceSessions')}/attendanceRecords/student`),
    ).toMatchObject({
      uid: 'student',
      displayName: '陳同學',
      studentId: 'S123',
      status: 'present',
      source: 'qr',
    });
    expect(store.docs.get(path(session, 'liveSessions'))?.attendeeCount).toBe(1);
    expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(1);
    time += 300_000;
    await expect(handlers.joinLiveSession(sessionRequest(session))).resolves.toEqual({
      ...first,
      alreadyJoined: true,
    });
    expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(1);
  });

  it('a lost receipt is recoverable after closing, without changing the record or either counter', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const first = await handlers.joinLiveSession(sessionRequest(session));
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    time += 300_000;
    const before = new Map(store.docs);
    await expect(handlers.joinLiveSession(sessionRequest(session))).resolves.toEqual({
      ...first,
      alreadyJoined: true,
    });
    expect(store.docs).toEqual(before);
  });

  it.each(['inactive', 'deleted'])(
    'a confirmed receipt remains inaccessible after membership becomes %s',
    async (status) => {
      const session = await handlers.startLiveSession(startRequest());
      await handlers.joinLiveSession(sessionRequest(session));
      time += 300_000;
      store.docs.set('groups/class-1/members/student', { status, role: 'student' });
      await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
        code: 'permission-denied',
      });
      expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(1);
    },
  );

  it('recovering a receipt still requires the matching private token and current membership', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    time += 300_000;
    await expect(
      handlers.joinLiveSession(sessionRequest(session, { qrToken: 'wrong-token-long-enough' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    store.docs.delete('groups/class-1/members/student');
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('another active member cannot recover the first student receipt after expiry', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    store.docs.set('groups/class-1/members/other-student', { status: 'active', role: 'student' });
    time += 300_000;
    await expect(
      handlers.joinLiveSession(sessionRequest(session, { uid: 'student' }, 'other-student')),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
    expect(
      store.docs.has(`${path(session, 'attendanceSessions')}/attendanceRecords/other-student`),
    ).toBe(false);
    expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(1);
  });

  it.each([
    { uid: 'other-student' },
    { groupId: 'other-class' },
    { sessionId: 'other-session' },
    { status: 'absent', reviewedBy: 'teacher' },
    { checkedInAt: null },
  ])('does not return or overwrite a mismatched or teacher-adjusted receipt: %j', async (patch) => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    time += 300_000;
    const recordPath = `${path(session, 'attendanceSessions')}/attendanceRecords/student`;
    const adjusted = { ...store.docs.get(recordPath), ...patch };
    store.docs.set(recordPath, adjusted);
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.get(recordPath)).toEqual(adjusted);
    expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(1);
  });

  it('a receipt cannot bypass missing canonical documents or private secrets', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    time += 300_000;
    for (const collection of ['liveSessions', 'attendanceSessions', 'liveSessionSecrets']) {
      const documentPath = path(session, collection);
      const original = store.docs.get(documentPath);
      store.docs.delete(documentPath);
      await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      store.docs.set(documentPath, original!);
    }
  });

  it('joins after completion do not create records or change either counter', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.has(`${path(session, 'attendanceSessions')}/attendanceRecords/student`)).toBe(
      false,
    );
    expect(store.docs.get(path(session, 'liveSessions'))?.attendeeCount).toBe(0);
    expect(store.docs.get(path(session, 'attendanceSessions'))?.attendeeCount).toBe(0);
  });

  it('throws HttpsError for unauthenticated callers', async () => {
    await expect(handlers.joinLiveSession({ data: {} })).rejects.toBeInstanceOf(HttpsError);
  });
});

describe('audited instructor attendance correction', () => {
  function setup() {
    const store = seedStore();
    store.docs.set('groups/class-1', { name: '程式設計', type: 'course', schoolId: 'school-1' });
    store.docs.set('schools/school-1/members/teacher', { status: 'active' });
    store.docs.set('schools/school-1/members/student', { status: 'active' });
    const handlers = createLiveSessionHandlers({
      db: store.db as never,
      now: () => Date.parse('2026-10-27T03:00:00Z'),
    });
    const start = () =>
      handlers.startLiveSession({
        auth: { uid: 'teacher' },
        data: { groupId: 'class-1', requestId: 'start-correction-test' },
      });
    const correction = (sessionId: string, data: Record<string, unknown> = {}, uid = 'teacher') =>
      handlers.correctAttendanceRecord({
        auth: { uid },
        data: {
          groupId: 'class-1',
          sessionId,
          studentUid: 'student',
          status: 'absent',
          reason: '授課教師已查核課堂情況',
          requestId: 'adjustment-1',
          ...data,
        },
      });
    return { store, handlers, start, correction };
  }

  it('records an explicit absence and durable reason without changing present-counts', async () => {
    const { store, start, correction, handlers } = setup();
    const session = await start();
    await handlers.endLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', sessionId: session.sessionId },
    });
    const result = await correction(session.sessionId);
    expect(result).toMatchObject({ success: true, reused: false, status: 'absent' });
    expect(store.docs.get(`groups/class-1/attendanceSessions/${session.sessionId}`)?.attendeeCount).toBe(0);
    expect(store.docs.get(
      `groups/class-1/attendanceSessions/${session.sessionId}/attendanceRecords/student`,
    )).toMatchObject({ status: 'absent', source: 'manual', checkedInAt: null });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/')))
      .toHaveLength(1);
  });

  it('prevents students from correcting records and rejects reusing an operation with changes', async () => {
    const { store, start, correction } = setup();
    const session = await start();
    await expect(correction(session.sessionId, {}, 'student'))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await correction(session.sessionId, { status: 'present' });
    const again = await correction(session.sessionId, { status: 'present' });
    expect(again).toMatchObject({ success: true, reused: true });
    await expect(correction(session.sessionId, { status: 'late' }))
      .rejects.toMatchObject({ code: 'already-exists' });
    expect(store.docs.get(`groups/class-1/liveSessions/${session.sessionId}`)?.attendeeCount).toBe(1);
  });

  it('does not finalize an absence while QR sign-in remains active', async () => {
    const { store, start, correction } = setup();
    const session = await start();
    await expect(correction(session.sessionId))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/')))
      .toHaveLength(0);
  });

  it('does not persist audit or partial attendance on an aborted transaction', async () => {
    const { store, start, correction, handlers } = setup();
    const session = await start();
    await handlers.endLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', sessionId: session.sessionId },
    });
    store.failNextCommit();
    await expect(correction(session.sessionId)).rejects.toThrow('commit unavailable');
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/')))
      .toHaveLength(0);
  });

  it.each([
    ['schools/school-1/members/teacher', null],
    ['schools/school-1/members/student', null],
    ['schools/school-1/members/teacher', { status: 'inactive' }],
    ['schools/school-1/members/student', { status: 'inactive' }],
    ['users/teacher', { accountDeletionInProgress: true }],
    ['users/student', { accountDeletionInProgress: true }],
    ['users/teacher', { status: 'deleted' }],
    ['users/student', { status: 'deleted' }],
  ] as const)('refuses revoked school/account access at %s', async (documentPath, replacement) => {
    const { store, start, correction } = setup();
    const session = await start();
    if (replacement === null) store.docs.delete(documentPath);
    else store.docs.set(documentPath, replacement);
    const before = new Map(store.docs);
    await expect(correction(session.sessionId, { status: 'present' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs).toEqual(before);
  });

  it('rechecks school membership before recovering an already committed correction', async () => {
    const { store, start, correction } = setup();
    const session = await start();
    await correction(session.sessionId, { status: 'present' });
    store.docs.set('schools/school-1/members/teacher', { status: 'inactive' });
    const before = new Map(store.docs);
    await expect(correction(session.sessionId, { status: 'present' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs).toEqual(before);
  });

  it.each([
    null,
    { type: 'course' },
    { type: 'club', schoolId: 'school-1' },
    { type: 'course', schoolId: '../school-1' },
  ])('rejects a missing or malformed course scope: %j', async (course) => {
    const { store, start, correction } = setup();
    const session = await start();
    if (course === null) store.docs.delete('groups/class-1');
    else store.docs.set('groups/class-1', course);
    const before = new Map(store.docs);
    await expect(correction(session.sessionId, { status: 'present' }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs).toEqual(before);
  });

  it.each([null, '0', false])('does not coerce invalid counters %j', async (count) => {
    const { store, start, correction } = setup();
    const session = await start();
    store.docs.get(`groups/class-1/liveSessions/${session.sessionId}`)!.attendeeCount = count;
    store.docs.get(`groups/class-1/attendanceSessions/${session.sessionId}`)!.attendeeCount = count;
    const before = new Map(store.docs);
    await expect(correction(session.sessionId, { status: 'present' }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs).toEqual(before);
  });
});
