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
  const collectionRef = (colPath) => ({
    doc: (id) => ref(`${colPath}/${id}`),
    where: (field, op, value) => ({
      __query: true,
      colPath,
      field,
      op,
      value,
    }),
  });
  const ref = (path) => ({
    path,
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  function snapshot(reference) {
    const value = docs.get(reference.path);
    return {
      id: reference.path.split('/').pop(),
      exists: value !== undefined,
      data: () => value,
      ref: reference,
    };
  }
  function querySnapshot(query) {
    const prefix = `${query.colPath}/`;
    const matches = [];
    for (const [path, value] of docs) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      if (query.op === '==' && value?.[query.field] === query.value) {
        matches.push(snapshot(ref(path)));
      }
    }
    return { docs: matches, empty: matches.length === 0, size: matches.length };
  }
  let failCommit = false;
  const db = {
    collection: (name) => collectionRef(name),
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        get: async (reference) => (reference.__query ? querySnapshot(reference) : snapshot(reference)),
        getAll: async (...refs) => refs.map((reference) => snapshot(reference)),
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
    expect(store.docs.get(path(first, 'liveSessions')).active).toBe(false);
    expect(store.docs.get(path(second, 'liveSessions')).active).toBe(false);
    expect(store.docs.get(path(oldClient, 'liveSessions')).active).toBe(true);
  });

  test('opening a new session for the same class ends the previous one and leaves other classes open', async () => {
    store.docs.set('groups/class-2', { name: '資料結構' });
    store.docs.set('groups/class-2/members/teacher', { role: 'instructor', status: 'active' });
    const classA = await handlers.startLiveSession(startRequest({ requestId: 'class-a' }));
    const classB = await handlers.startLiveSession(
      startRequest({ groupId: 'class-2', requestId: 'class-b' }),
    );
    const nextA = await handlers.startLiveSession(startRequest({ requestId: 'class-a-next' }));
    expect(store.docs.get(path(classA, 'liveSessions')).active).toBe(false);
    expect(store.docs.get(path(classA, 'attendanceSessions')).active).toBe(false);
    expect(store.docs.get(path(classA, 'liveSessions')).endedAt.toMillis()).toBe(
      store.docs.get(path(classA, 'attendanceSessions')).endedAt.toMillis(),
    );
    expect(store.docs.get(`groups/class-2/liveSessions/${classB.sessionId}`).active).toBe(true);
    expect(store.docs.get(`groups/class-2/attendanceSessions/${classB.sessionId}`).active).toBe(
      true,
    );
    expect(store.docs.get(path(nextA, 'liveSessions')).active).toBe(true);
    expect(store.docs.get(path(nextA, 'attendanceSessions')).active).toBe(true);
  });

  test('ending one session does not close another class or another leftover session', async () => {
    store.docs.set('groups/class-2', { name: '資料結構' });
    store.docs.set('groups/class-2/members/teacher', { role: 'instructor', status: 'active' });
    const classA = await handlers.startLiveSession(startRequest({ requestId: 'class-a' }));
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
    expect(store.docs.get(path(classA, 'liveSessions')).active).toBe(false);
    expect(store.docs.get(path(classA, 'attendanceSessions')).active).toBe(false);
    expect(store.docs.get('groups/class-1/liveSessions/session_leftover').active).toBe(true);
    expect(store.docs.get('groups/class-1/attendanceSessions/session_leftover').active).toBe(true);
    expect(store.docs.get(`groups/class-2/liveSessions/${classB.sessionId}`).active).toBe(true);
    expect(store.docs.get(`groups/class-2/attendanceSessions/${classB.sessionId}`).active).toBe(
      true,
    );
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
    await expect(handlers.joinLiveSession(sessionRequest(session))).resolves.toEqual({
      ...first,
      alreadyJoined: true,
    });
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
  });

  test('a lost receipt is recoverable after closing, without changing the record or either counter', async () => {
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

  test.each(['inactive', 'deleted'])(
    'a confirmed receipt remains inaccessible after membership becomes %s',
    async (status) => {
      const session = await handlers.startLiveSession(startRequest());
      await handlers.joinLiveSession(sessionRequest(session));
      time += 300_000;
      store.docs.set('groups/class-1/members/student', { status, role: 'student' });
      await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
        code: 'permission-denied',
      });
      expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
    },
  );

  test('recovering a receipt still requires the matching private token and current membership', async () => {
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

  test('another active member cannot recover the first student receipt after expiry', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    store.docs.set('groups/class-1/members/other-student', { status: 'active', role: 'student' });
    time += 300_000;
    await expect(
      handlers.joinLiveSession(sessionRequest(session, { uid: 'student' }, 'other-student')),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
    expect(store.docs.has(`${path(session, 'attendanceSessions')}/attendanceRecords/other-student`)).toBe(false);
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
  });

  test.each([
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
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
  });

  test('a receipt cannot bypass missing canonical documents or private secrets', async () => {
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
      store.docs.set(documentPath, original);
    }
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

  const correctionRequest = (session, patch = {}, uid = 'teacher') => ({
    auth: { uid },
    data: {
      groupId: 'class-1',
      sessionId: session.sessionId,
      studentUid: 'student',
      status: 'absent',
      reason: '老師已確認缺席紀錄',
      requestId: 'correction-attempt-1',
      ...patch,
    },
  });

  test('a verified instructor explicitly records absence with an immutable audit receipt', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    const result = await handlers.correctAttendanceRecord(correctionRequest(session));
    expect(result).toMatchObject({ success: true, reused: false, status: 'absent', checkedInAt: null });
    const recordPath = `${path(session, 'attendanceSessions')}/attendanceRecords/student`;
    expect(store.docs.get(recordPath)).toMatchObject({
      uid: 'student', groupId: 'class-1', status: 'absent',
      checkedInAt: null, correctedBy: 'teacher', source: 'manual',
    });
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(0);
    const auditPaths = [...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'));
    expect(auditPaths).toHaveLength(1);
    expect(store.docs.get(auditPaths[0])).toMatchObject({
      teacherUid: 'teacher', studentUid: 'student',
      previousStatus: null, nextStatus: 'absent',
      reason: '老師已確認缺席紀錄',
    });
  });

  test('a duplicate correction request is idempotent and mismatched retries are rejected', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const initial = await handlers.correctAttendanceRecord(correctionRequest(session, {
      status: 'present',
      reason: '課堂現場經教師核對身份',
    }));
    expect(initial).toMatchObject({ success: true, reused: false, status: 'present' });
    const retry = await handlers.correctAttendanceRecord(correctionRequest(session, {
      status: 'present',
      reason: '課堂現場經教師核對身份',
    }));
    expect(retry).toMatchObject({ success: true, reused: true, status: 'present' });
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(1);
    expect(store.docs.get(path(session, 'liveSessions')).attendeeCount).toBe(1);
    await expect(handlers.correctAttendanceRecord(correctionRequest(session, {
      status: 'late', reason: '課堂現場經教師核對身份',
    }))).rejects.toMatchObject({ code: 'already-exists' });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(1);
  });

  test('changing a confirmed QR receipt to excused reduces counters on both session documents', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(sessionRequest(session));
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    const result = await handlers.correctAttendanceRecord(correctionRequest(session, {
      status: 'excused', reason: '教務已核准課堂請假申請',
    }));
    expect(result.status).toBe('excused');
    const record = store.docs.get(`${path(session, 'attendanceSessions')}/attendanceRecords/student`);
    expect(record).toMatchObject({ status: 'excused', source: 'manual', checkedInAt: null });
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(0);
    expect(store.docs.get(path(session, 'liveSessions')).attendeeCount).toBe(0);
    await expect(handlers.joinLiveSession(sessionRequest(session))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  test('students, outsiders and inactive target students cannot correct attendance', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await expect(handlers.correctAttendanceRecord(correctionRequest(session, {}, 'student')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handlers.correctAttendanceRecord(correctionRequest(session, {}, 'outsider')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    store.docs.set('groups/class-1/members/student', { role: 'student', status: 'inactive' });
    await expect(handlers.correctAttendanceRecord(correctionRequest(session)))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(0);
  });

  test.each([
    { status: 'something' }, { reason: '' }, { reason: 'short' },
    { studentUid: '../someone' }, { requestId: 'bad/request' },
  ])('rejects malformed correction inputs: %j', async (patch) => {
    const session = await handlers.startLiveSession(startRequest());
    await expect(handlers.correctAttendanceRecord(correctionRequest(session, patch)))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('does not finalize absence or leave before the live QR check-in closes', async () => {
    const session = await handlers.startLiveSession(startRequest());
    for (const status of ['absent', 'excused']) {
      await expect(
        handlers.correctAttendanceRecord(correctionRequest(session, {
          status, requestId: 'closed-window-' + status,
        })),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    }
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(0);
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(0);
  });

  test('transaction storage failures do not leave a correction or a false attendance count', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.endLiveSession(sessionRequest(session, {}, 'teacher'));
    store.failNextCommit();
    await expect(handlers.correctAttendanceRecord(correctionRequest(session)))
      .rejects.toThrow('transaction unavailable');
    expect(store.docs.get(path(session, 'attendanceSessions')).attendeeCount).toBe(0);
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(0);
  });

});
