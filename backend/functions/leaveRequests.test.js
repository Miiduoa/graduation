jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ kind: 'serverTimestamp' }) },
}));

const {
  createSubmitLeaveHandler, createWithdrawLeaveHandler,
  createReviewLeaveHandler, createListReviewLeavesHandler,
  normalizeDates, matchingCourses, summarize,
} = require('./leaveRequests');

const REQUEST_ID = 'leave-2026-good-id';
const school = 'pu';
const student = 's1';
const teacher = 't1';
const courseA = { id: 'c1', name: '資料庫', teacher: '王老師' };
const courseB = { id: 'c2', name: '英文', teacher: '林老師' };
const courseC = { id: 'c3', name: '資料庫', teacher: '李老師' };
const baseData = () => ({
  'schools/pu/members/s1': { status: 'active', role: 'student' },
  'schools/pu/members/t1': { status: 'active', role: 'instructor' },
  'schools/pu/members/other': { status: 'active', role: 'student' },
  'schools/pu/members/admin': { status: 'active', role: 'admin' },
  'schools/ntpu/members/admin': { status: 'active', role: 'admin' },
  'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
  'schools/pu/courseTeachers/英文｜林老師': { teacherUids: ['t2'] },
  'schools/pu/courseTeachers/資料庫｜李老師': { teacherUids: ['t3'] },
  'users/s1': { displayName: '陳同學' },
  'users/s1/schools/pu/personalTimetable/current': {
    schoolId: 'pu', courses: [courseA, courseB, courseC],
  },
});

function memoryDb(data = baseData()) {
  const records = { ...data };
  const transactionReads = [];
  const writes = [];
  const document = (path) => ({ path, id: path.split('/').pop(), get: async () => snap(document(path)) });
  const snap = (reference) => {
    if (records[reference.path] instanceof Error) throw records[reference.path];
    return {
      id: reference.id,
      exists: Object.prototype.hasOwnProperty.call(records, reference.path),
      data: () => records[reference.path],
    };
  };
  const makeQuery = (path, predicates = []) => ({
    where(field, op, value) { return makeQuery(path, [...predicates, [field, op, value]]); },
    orderBy() { return this; },
    limit() { return this; },
    async get() {
      const prefix = path + '/';
      return {
        docs: Object.keys(records)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .filter((key) => predicates.every(([field, op, value]) => op === 'array-contains'
            ? (records[key][field] || []).includes(value)
            : records[key][field] === value))
          .map((key) => ({ id: key.split('/').pop(), data: () => records[key] })),
      };
    },
  });
  return {
    records,
    transactionReads,
    writes,
    db: {
      doc: document,
      collection: (path) => makeQuery(path),
      async runTransaction(callback) {
        const changes = [];
        const tx = {
          get: async (reference) => {
            transactionReads.push(reference.path);
            return snap(reference);
          },
          create: (reference, value) => changes.push({ reference, value, type: 'create' }),
          update: (reference, value) => changes.push({ reference, value, type: 'update' }),
        };
        const output = await callback(tx);
        changes.forEach(({ reference, value, type }) => {
          if (type === 'create' && records[reference.path]) throw new Error('exists');
          writes.push(reference.path);
          records[reference.path] = type === 'update'
            ? { ...records[reference.path], ...value }
            : value;
        });
        return output;
      },
    },
  };
}

function request(uid = student, extra = {}) {
  return {
    auth: { uid },
    data: {
      schoolId: school,
      requestId: REQUEST_ID,
      startDate: '2026-10-26',
      endDate: '2026-10-26',
      kind: 'sick',
      period: 'all',
      detail: '需要請假',
      courseIds: ['c1', 'c2'],
      ...extra,
    },
  };
}
const time = () => new Date('2026-10-25T14:30:00.000Z');

test('validates real dates, not just date-shaped strings', () => {
  expect(normalizeDates('2026-02-28', '2026-03-01')).toEqual({
    startDate: '2026-02-28', endDate: '2026-03-01',
  });
  expect(() => normalizeDates('2026-02-30', '2026-03-01')).toThrow();
  expect(() => normalizeDates('2026-10-27', '2026-10-26')).toThrow();
  expect(() => normalizeDates('2026-10-26', '2026-12-01')).toThrow();
});

test('chooses only the signed-in school timetable, not a mismatched legacy copy', () => {
  expect(() => matchingCourses({
    exists: true,
    data: () => ({ schoolId: 'ntu', courses: [courseA] }),
  }, 'pu', ['c1'])).toThrow();
  expect(matchingCourses({
    exists: true,
    data: () => ({ schoolId: 'pu', courses: [courseA] }),
  }, 'pu', ['c1'])[0]).toMatchObject({ courseId: 'c1', offeringId: '資料庫｜王老師' });
});

test('a school member creates one private request with independent pending courses', async () => {
  const { db, records } = memoryDb();
  const handler = createSubmitLeaveHandler({ db, clock: time });
  const result = await handler(request());
  expect(result).toEqual({ id: REQUEST_ID, alreadySubmitted: false });
  expect(records['leaveRequests/' + REQUEST_ID]).toMatchObject({
    uid: student, schoolId: school, status: 'pending',
    officialSubmitted: false, source: 'campus-one',
  });
  expect(records['leaveRequests/' + REQUEST_ID].courses).toEqual([
    expect.objectContaining({ courseId: 'c1', reviewStatus: 'pending' }),
    expect.objectContaining({ courseId: 'c2', reviewStatus: 'pending' }),
  ]);
  expect(await handler(request())).toEqual({ id: REQUEST_ID, alreadySubmitted: true });
  await expect(handler(request(student, { detail: '改變原因' }))).rejects.toMatchObject({ code: 'already-exists' });
});

test('blocks unauthenticated, non-member and cross-campus courses', async () => {
  const { db, records } = memoryDb();
  const handler = createSubmitLeaveHandler({ db, clock: time });
  await expect(handler({ data: request().data })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(handler(request('outsider'))).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(handler(request(student, { schoolId: 'ntpu' }))).rejects.toMatchObject({ code: 'permission-denied' });
  records['users/s1/schools/pu/personalTimetable/current'] = { schoolId: 'ntpu', courses: [courseA] };
  await expect(handler(request())).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('blocks altered, excessive or invalid course and period input', async () => {
  const { db } = memoryDb();
  const handler = createSubmitLeaveHandler({ db, clock: time });
  await expect(handler(request(student, { courseIds: ['none'] }))).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(handler(request(student, { courseIds: ['c1', 'c1'] }))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(handler(request(student, { courseIds: Array(21).fill('c1') }))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(handler(request(student, { period: 'invalid' }))).rejects.toMatchObject({ code: 'invalid-argument' });
});

test('teacher can only decide their own offering; course outcomes remain independent', async () => {
  const { db, records } = memoryDb();
  await createSubmitLeaveHandler({ db, clock: time })(request());
  const review = createReviewLeaveHandler({ db, clock: time });
  await expect(review({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c2', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'permission-denied' });
  await review({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved', note: '同意' },
  });
  expect(records['leaveRequests/' + REQUEST_ID].status).toBe('partial');
  expect(records['leaveRequests/' + REQUEST_ID].courses[0]).toMatchObject({ reviewStatus: 'approved', reviewedBy: 't1' });
  expect(records['leaveRequests/' + REQUEST_ID].courses[1].reviewStatus).toBe('pending');
  await expect(review({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'rejected', note: '不同意原因' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
  await review({
    auth: { uid: 'admin' },
    data: { requestId: REQUEST_ID, courseId: 'c2', decision: 'rejected', note: '請補說明' },
  });
  expect(records['leaveRequests/' + REQUEST_ID].status).toBe('completed');
  expect(summarize(records['leaveRequests/' + REQUEST_ID].courses)).toBe('completed');
});

test('only request owner can withdraw and only while no course was reviewed', async () => {
  const { db, records } = memoryDb();
  await createSubmitLeaveHandler({ db, clock: time })(request());
  const withdraw = createWithdrawLeaveHandler({ db, clock: time });
  await expect(withdraw({ auth: { uid: 'other' }, data: { requestId: REQUEST_ID } })).rejects.toMatchObject({ code: 'not-found' });
  const result = await withdraw({ auth: { uid: student }, data: { requestId: REQUEST_ID } });
  expect(result.status).toBe('withdrawn');
  expect(records['leaveRequests/' + REQUEST_ID].status).toBe('withdrawn');
  expect((await withdraw({ auth: { uid: student }, data: { requestId: REQUEST_ID } })).status).toBe('withdrawn');
  await expect(createReviewLeaveHandler({ db, clock: time })({
    auth: { uid: 't1' }, data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('reviewer list hides other teachers courses and blocks unassigned users', async () => {
  const { db } = memoryDb();
  await createSubmitLeaveHandler({ db, clock: time })(request());
  const list = createListReviewLeavesHandler({ db });
  const response = await list({ auth: { uid: teacher }, data: { schoolId: school } });
  expect(response.rows).toHaveLength(1);
  expect(response.rows[0].studentName).toBe('陳同學');
  expect(response.rows[0].courses.map((course) => course.courseId)).toEqual(['c1']);
  await expect(list({ auth: { uid: 'other' }, data: { schoolId: school } })).rejects.toMatchObject({ code: 'permission-denied' });
  const admin = await list({ auth: { uid: 'admin' }, data: { schoolId: school } });
  expect(admin.rows[0].courses).toHaveLength(2);
});

test('account deletion blocks submission and teacher review', async () => {
  const { db, records } = memoryDb();
  records['users/s1'] = { accountDeletionInProgress: true };
  await expect(createSubmitLeaveHandler({ db, clock: time })(request())).rejects.toMatchObject({ code: 'failed-precondition' });
  records['users/s1'] = { displayName: '陳同學' };
  await createSubmitLeaveHandler({ db, clock: time })(request());
  records['users/t1'] = { status: 'deleted' };
  await expect(createReviewLeaveHandler({ db, clock: time })({
    auth: { uid: 't1' }, data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
});

async function accountStateWrite(operation) {
  const memory = memoryDb();
  const { db } = memory;
  if (operation !== 'submit') await createSubmitLeaveHandler({ db, clock: time })(request());
  const uid = operation === 'review' ? teacher : student;
  memory.records[`users/${uid}`] = { displayName: uid, status: 'active' };
  const execute = operation === 'submit'
    ? () => createSubmitLeaveHandler({ db, clock: time })(request())
    : operation === 'withdraw'
      ? () => createWithdrawLeaveHandler({ db, clock: time })({ auth: { uid }, data: { requestId: REQUEST_ID } })
      : () => createReviewLeaveHandler({ db, clock: time })({
        auth: { uid }, data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' },
      });
  memory.writes.length = 0;
  memory.transactionReads.length = 0;
  return { ...memory, execute, uid };
}

describe.each(['submit', 'withdraw', 'review'])('%s account state at transaction time', (operation) => {
  test.each(['disabled', 'suspended', 'inactive'])('rejects %s that appears after the operation was prepared', async (status) => {
    const { db, records, writes, transactionReads, execute, uid } = await accountStateWrite(operation);
    const path = `users/${uid}`;
    const before = structuredClone(records);
    const closedProfile = { ...records[path], status };
    const transact = db.runTransaction.bind(db);
    db.runTransaction = (callback) => {
      records[path] = closedProfile;
      return transact(callback);
    };

    await expect(execute()).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(transactionReads).toContain(path);
    expect(writes).toEqual([]);
    expect(records).toEqual({ ...before, [path]: closedProfile });
  });

  test.each(['active', 'legacy', 'missing'])('preserves the existing %s profile behavior', async (state) => {
    const { records, writes, transactionReads, execute, uid } = await accountStateWrite(operation);
    const path = `users/${uid}`;
    if (state === 'legacy') records[path] = { displayName: uid };
    if (state === 'missing') delete records[path];

    await expect(execute()).resolves.toMatchObject({ id: REQUEST_ID });

    expect(transactionReads).toContain(path);
    expect(writes).toEqual([`leaveRequests/${REQUEST_ID}`]);
  });

  test('an unavailable account read fails without partially changing the request', async () => {
    const { records, writes, transactionReads, execute, uid } = await accountStateWrite(operation);
    const path = `users/${uid}`;
    const error = new Error('account-source-unavailable');
    records[path] = error;
    const before = structuredClone(records);

    await expect(execute()).rejects.toBe(error);

    expect(transactionReads).toContain(path);
    expect(writes).toEqual([]);
    expect(records).toEqual(before);
  });
});

test.each(['disabled', 'suspended', 'inactive'])('a %s reviewer cannot read the review list', async (status) => {
  const { db, records, writes } = memoryDb();
  await createSubmitLeaveHandler({ db, clock: time })(request());
  records[`users/${teacher}`] = { status };
  writes.length = 0;
  const before = structuredClone(records);

  await expect(createListReviewLeavesHandler({ db })({ auth: { uid: teacher }, data: { schoolId: school } }))
    .rejects.toMatchObject({ code: 'failed-precondition' });

  expect(writes).toEqual([]);
  expect(records).toEqual(before);
});
