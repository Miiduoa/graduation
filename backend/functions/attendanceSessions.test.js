jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    fromMillis: (millis) => ({ toMillis: () => millis, toDate: () => new Date(millis) }),
  },
  FieldValue: { increment: (amount) => ({ incrementBy: amount }) },
}));

const { createLiveSessionHandlers } = require('./attendanceSessions');

function memoryStore() {
  const docs = new Map([
    ['groups/class-1', { name: '程式設計' }],
    ['groups/class-1/members/teacher', { role: 'instructor', status: 'active' }],
    [
      'groups/class-1/members/student',
      { role: 'student', status: 'active', displayName: '陳同學', studentId: 'S123' },
    ],
  ]);
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
  });
  let failCommit = false;
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        getAll: async (...refs) =>
          refs.map((reference) => {
            const value = docs.get(reference.path);
            return { exists: value !== undefined, data: () => value };
          }),
        create: (reference, value) => writes.push({ type: 'create', reference, value }),
        update: (reference, value) => writes.push({ type: 'update', reference, value }),
      };
      const result = await callback(transaction);
      if (failCommit) throw new Error('transaction unavailable');
      const committed = new Map(docs);
      for (const { type, reference, value } of writes) {
        if (type === 'create' && committed.has(reference.path)) throw new Error('already exists');
        if (type === 'update' && !committed.has(reference.path))
          throw new Error('missing document');
        const next = type === 'create' ? {} : { ...committed.get(reference.path) };
        for (const [key, field] of Object.entries(value)) {
          next[key] = field?.incrementBy ? (next[key] || 0) + field.incrementBy : field;
        }
        committed.set(reference.path, next);
      }
      docs.clear();
      for (const [path, value] of committed) docs.set(path, value);
      return result;
    },
  };
  return {
    db,
    docs,
    failNextCommit: () => {
      failCommit = true;
    },
  };
}

describe('live attendance session handlers', () => {
  let store;
  let handlers;
  let time;
  let notifyStarted;
  let logger;
  const startRequest = (data = {}, uid = 'teacher') => ({
    auth: { uid },
    data: { groupId: 'class-1', requestId: 'attempt-1', ...data },
  });
  const sessionRequest = (session, data = {}, uid = 'student') => ({
    auth: { uid },
    data: { groupId: 'class-1', sessionId: session.sessionId, qrToken: session.qrToken, ...data },
  });
  const path = (session, collection) => `groups/class-1/${collection}/${session.sessionId}`;

  beforeEach(() => {
    store = memoryStore();
    time = Date.parse('2026-10-07T03:00:00Z');
    notifyStarted = jest.fn();
    logger = { warn: jest.fn() };
    handlers = createLiveSessionHandlers({ db: store.db, now: () => time, notifyStarted, logger });
  });

  test('requires authentication for every mutation', async () => {
    for (const handler of Object.values(handlers)) {
      await expect(handler({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    }
  });

  test.each([
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
    await expect(handlers.startLiveSession(startRequest(data))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(store.docs.size).toBe(3);
  });

  test.each([
    { role: 'instructor', status: 'inactive' },
    { role: 'instructor' },
    { role: 'student', status: 'active' },
    { role: 'admin', status: 'active' },
  ])('rejects start without a current active instructor role: %j', async (member) => {
    store.docs.set('groups/class-1/members/teacher', member);
    await expect(handlers.startLiveSession(startRequest())).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  test('creates synchronized public metadata and private token, preserving zero coordinates', async () => {
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
    expect(live.startedAt.toMillis()).toBe(attendance.startedAt.toMillis());
    expect(live.qrExpiresAt.toMillis()).toBe(time + 300_000);
    expect(secret.qrToken).toBe(result.qrToken);
    expect(live.qrToken).toBeUndefined();
    expect(attendance.qrToken).toBeUndefined();
    expect(live.attendees).toBeUndefined();
    expect(attendance.attendees).toBeUndefined();
  });

  test('a failed transaction leaves no partial session or notification', async () => {
    store.failNextCommit();
    await expect(handlers.startLiveSession(startRequest())).rejects.toThrow(
      'transaction unavailable',
    );
    expect(store.docs.size).toBe(3);
    expect(notifyStarted).not.toHaveBeenCalled();
  });

  test('notification failure cannot mask committed success or duplicate a retry', async () => {
    notifyStarted.mockRejectedValue(
      Object.assign(new Error('delivery unavailable'), { code: 'unavailable' }),
    );
    const first = await handlers.startLiveSession(startRequest());
    time += 60_000;
    const second = await handlers.startLiveSession(startRequest());
    expect(second).toEqual({ ...first, reused: true });
    expect(store.docs.size).toBe(6);
    expect(notifyStarted).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('same request key cannot silently change the session settings', async () => {
    await handlers.startLiveSession(startRequest());
    await expect(
      handlers.startLiveSession(startRequest({ qrExpiryMinutes: 10 })),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  test('request keys are scoped to the instructor and optional for older callers', async () => {
    store.docs.set('groups/class-1/members/other-teacher', { status: 'active', role: 'owner' });
    const first = await handlers.startLiveSession(startRequest());
    const second = await handlers.startLiveSession(startRequest({}, 'other-teacher'));
    const oldClient = await handlers.startLiveSession(startRequest({ requestId: undefined }));
    expect(new Set([first.sessionId, second.sessionId, oldClient.sessionId]).size).toBe(3);
  });

  test('end is atomic and repeated starts and ends never reopen or retime a completed session', async () => {
    const session = await handlers.startLiveSession(startRequest());
    time += 1000;
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    const endedAt = store.docs.get(path(session, 'liveSessions')).endedAt.toMillis();
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
    expect(store.docs.get(path(session, 'liveSessions')).endedAt.toMillis()).toBe(endedAt);
    expect(store.docs.get(path(session, 'attendanceSessions')).endedAt.toMillis()).toBe(endedAt);
  });

  test('ending requires both current instructor membership and original ownership', async () => {
    const session = await handlers.startLiveSession(startRequest());
    store.docs.set('groups/class-1/members/other-teacher', {
      status: 'active',
      role: 'instructor',
    });
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'other-teacher')),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    store.docs.set('groups/class-1/members/teacher', { status: 'inactive', role: 'instructor' });
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'teacher')),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.get(path(session, 'liveSessions')).active).toBe(true);
  });

  test('rejects a broken canonical pair rather than fabricating attendance metadata', async () => {
    const session = await handlers.startLiveSession(startRequest());
    store.docs.delete(path(session, 'attendanceSessions'));
    await expect(
      handlers.endLiveSession(sessionRequest(session, {}, 'teacher')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(handlers.startLiveSession(startRequest())).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.get(path(session, 'liveSessions')).active).toBe(true);
  });

  test.each([undefined, '', 'wrong-token-long-enough'])(
    'requires a correct QR token, received %s',
    async (qrToken) => {
      const session = await handlers.startLiveSession(startRequest());
      await expect(
        handlers.joinLiveSession(sessionRequest(session, { qrToken })),
      ).rejects.toMatchObject({ code: qrToken ? 'permission-denied' : 'invalid-argument' });
      expect(store.docs.get(path(session, 'liveSessions')).attendeeCount).toBe(0);
    },
  );

  test('rejects tokens at their exact expiry boundary and legacy publicly exposed tokens', async () => {
    const session = await handlers.startLiveSession(startRequest());
    time += 300_000;
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
    time -= 1000;
    store.docs.delete(path(session, 'liveSessionSecrets'));
    store.docs.get(path(session, 'liveSessions')).qrToken = session.qrToken;
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  test('students outside the group or with revoked membership cannot join with a valid token', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await expect(
      handlers.joinLiveSession(sessionRequest(session, {}, 'outsider')),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    store.docs.set('groups/class-1/members/student', { status: 'inactive', role: 'student' });
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  test('confirmed attendance keeps its original timestamp, identity and count on retries', async () => {
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
    expect(store.docs.get(path(session, 'liveSessions')).attendeeCount).toBe(1);
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
    time += 300_000;
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
  });

  test('joins after completion do not create records or change either counter', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.has(`${path(session, 'attendanceSessions')}/attendanceRecords/student`)).toBe(
      false,
    );
    expect(store.docs.get(path(session, 'liveSessions')).attendeeCount).toBe(0);
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(0);
  });
});
