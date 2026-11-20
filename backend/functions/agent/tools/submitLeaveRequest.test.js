'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockStore.db,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));
const submitLeaveRequest = require('./submitLeaveRequest');
const ctx = { uid: 'alice', schoolId: 'pu', agentActionKey: 'server-run:0' };
const input = { courseId: 'c1', date: '2026-10-28', type: '病假' };

beforeEach(() => {
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['users/alice/schools/pu/personalTimetable/current', {
      schoolId: 'pu', courses: [{ id: 'c1', name: '資料庫', teacher: '王老師' }],
    }],
  ]);
  mockStore.db.doc = (path) => path.split('/').reduce((ref, key, index) =>
    index % 2 === 0 ? ref.collection(key) : ref.doc(key), mockStore.db);
});

test('creates the normal reviewable leave format with server course evidence', async () => {
  const result = await submitLeaveRequest.execute(ctx, input);
  expect(result).toMatchObject({ status: 'pending', alreadySubmitted: false });
  expect(mockStore.docs.get('leaveRequests/' + result.requestId)).toMatchObject({
    uid: 'alice', schoolId: 'pu', kind: 'sick', source: 'campus-one', officialSubmitted: false,
    courses: [{ courseId: 'c1', courseName: '資料庫', offeringId: '資料庫｜王老師', reviewStatus: 'pending' }],
  });
});

test('caller groupId and fabricated source fields cannot change the approved course', async () => {
  const result = await submitLeaveRequest.execute({ ...ctx, groupId: 'other-school-group' }, {
    ...input, groupId: 'foreign', teacherUid: 'attacker', schoolId: 'other',
  });
  const saved = mockStore.docs.get('leaveRequests/' + result.requestId);
  expect(saved).not.toHaveProperty('groupId');
  expect(saved.schoolId).toBe('pu');
  expect(saved.courses[0].offeringId).toBe('資料庫｜王老師');
});

test('one server action key creates one request and a replay reuses it', async () => {
  const first = await submitLeaveRequest.execute(ctx, input);
  const second = await submitLeaveRequest.execute(ctx, input);
  expect(second).toMatchObject({ requestId: first.requestId, alreadySubmitted: true });
  expect([...mockStore.docs.keys()].filter((key) => key.startsWith('leaveRequests/'))).toHaveLength(1);
  await expect(submitLeaveRequest.execute(ctx, { ...input, date: '2026-10-29' }))
    .rejects.toMatchObject({ code: 'already-exists' });
});

test('rejects courses outside the current personal timetable without writing', async () => {
  await expect(submitLeaveRequest.execute(ctx, { ...input, courseId: 'foreign' }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...mockStore.docs.keys()].some((key) => key.startsWith('leaveRequests/'))).toBe(false);
});

test.each([
  ['schools/pu/members/alice', { status: 'inactive' }, 'permission-denied'],
  ['users/alice', { accountDeletionInProgress: true }, 'failed-precondition'],
  ['users/alice/schools/pu/personalTimetable/current', { schoolId: 'ntu', courses: [{ id: 'c1', name: '其他學校課程' }] }, 'failed-precondition'],
])('rejects revoked or mismatched source %s', async (path, data, code) => {
  mockStore.docs.set(path, data);
  await expect(submitLeaveRequest.execute(ctx, input)).rejects.toMatchObject({ code });
  expect([...mockStore.docs.keys()].some((key) => key.startsWith('leaveRequests/'))).toBe(false);
});

test('rejects invalid dates, unsupported leave types and missing identity', async () => {
  await expect(submitLeaveRequest.execute(ctx, { ...input, date: '2026-02-30' })).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(submitLeaveRequest.execute(ctx, { ...input, type: '任意假別' })).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(submitLeaveRequest.execute({ schoolId: 'pu' }, input)).rejects.toMatchObject({ code: 'unauthenticated' });
});
