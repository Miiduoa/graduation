// @vitest-environment node
import { expect, it } from 'vitest';
import {
  createLeaveRequestHandlers,
  matchingCourses,
  normalizeDates,
  summarize,
} from './leaveRequestHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';

const REQUEST_ID = 'leave-2026-good-id';
const school = 'pu';
const student = 's1';
const teacher = 't1';
const courseA = { id: 'c1', name: '資料庫', teacher: '王老師' };
const courseB = { id: 'c2', name: '英文', teacher: '林老師' };
const courseC = { id: 'c3', name: '資料庫', teacher: '李老師' };

function seed(extra: Array<[string, Record<string, unknown>]> = []) {
  return createMemoryGroupStore([
    ['schools/pu/members/s1', { status: 'active', role: 'student' }],
    ['schools/pu/members/t1', { status: 'active', role: 'instructor' }],
    ['schools/pu/members/other', { status: 'active', role: 'student' }],
    ['schools/pu/members/admin', { status: 'active', role: 'admin' }],
    ['schools/ntpu/members/admin', { status: 'active', role: 'admin' }],
    ['schools/pu/courseTeachers/資料庫｜王老師', { teacherUids: ['t1'] }],
    ['schools/pu/courseTeachers/英文｜林老師', { teacherUids: ['t2'] }],
    ['schools/pu/courseTeachers/資料庫｜李老師', { teacherUids: ['t3'] }],
    ['users/s1', { displayName: '陳同學' }],
    [
      'users/s1/schools/pu/personalTimetable/current',
      { schoolId: 'pu', courses: [courseA, courseB, courseC] },
    ],
    ...extra,
  ]);
}

function handlers(store: ReturnType<typeof seed>) {
  return createLeaveRequestHandlers({
    db: store.db as never,
    clock: () => new Date('2026-10-25T14:30:00.000Z'),
  });
}

function request(uid = student, extra: Record<string, unknown> = {}) {
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

it('validates real dates, not just date-shaped strings', () => {
  expect(normalizeDates('2026-02-28', '2026-03-01')).toEqual({
    startDate: '2026-02-28', endDate: '2026-03-01',
  });
  expect(() => normalizeDates('2026-02-30', '2026-03-01')).toThrow();
  expect(() => normalizeDates('2026-10-27', '2026-10-26')).toThrow();
  expect(() => normalizeDates('2026-10-26', '2026-12-01')).toThrow();
});

it('chooses only the signed-in school timetable, not a mismatched legacy copy', () => {
  expect(() => matchingCourses({
    exists: true,
    data: () => ({ schoolId: 'ntu', courses: [courseA] }),
  }, 'pu', ['c1'])).toThrow();
  expect(matchingCourses({
    exists: true,
    data: () => ({ schoolId: 'pu', courses: [courseA] }),
  }, 'pu', ['c1'])[0]).toMatchObject({ courseId: 'c1', offeringId: '資料庫｜王老師' });
});

it('a school member creates one private request with independent pending courses', async () => {
  const store = seed();
  const api = handlers(store);
  const result = await api.submitLeaveRequest(request());
  expect(result).toEqual({ id: REQUEST_ID, alreadySubmitted: false });
  expect(store.docs.get('leaveRequests/' + REQUEST_ID)).toMatchObject({
    uid: student, schoolId: school, status: 'pending',
    officialSubmitted: false, source: 'campus-one',
  });
  expect(store.docs.get('leaveRequests/' + REQUEST_ID)?.courses).toEqual([
    expect.objectContaining({ courseId: 'c1', reviewStatus: 'pending' }),
    expect.objectContaining({ courseId: 'c2', reviewStatus: 'pending' }),
  ]);
  expect(await api.submitLeaveRequest(request())).toEqual({ id: REQUEST_ID, alreadySubmitted: true });
  await expect(api.submitLeaveRequest(request(student, { detail: '改變原因' }))).rejects.toMatchObject({
    code: 'already-exists',
  });
});

it('blocks unauthenticated, non-member and cross-campus courses', async () => {
  const store = seed();
  const api = handlers(store);
  await expect(api.submitLeaveRequest({ data: request().data })).rejects.toMatchObject({
    code: 'unauthenticated',
  });
  await expect(api.submitLeaveRequest(request('outsider'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(api.submitLeaveRequest(request(student, { schoolId: 'ntpu' }))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  store.docs.set('users/s1/schools/pu/personalTimetable/current', {
    schoolId: 'ntpu',
    courses: [courseA],
  });
  await expect(api.submitLeaveRequest(request())).rejects.toMatchObject({
    code: 'failed-precondition',
  });
});

it('blocks altered, excessive or invalid course and period input', async () => {
  const api = handlers(seed());
  await expect(api.submitLeaveRequest(request(student, { courseIds: ['none'] }))).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  await expect(api.submitLeaveRequest(request(student, { courseIds: ['c1', 'c1'] }))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(
    api.submitLeaveRequest(request(student, { courseIds: Array(21).fill('c1') })),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(api.submitLeaveRequest(request(student, { period: 'invalid' }))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
});

it('teacher can only decide their own offering; course outcomes remain independent', async () => {
  const store = seed();
  const api = handlers(store);
  await api.submitLeaveRequest(request());
  await expect(api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c2', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'permission-denied' });
  await api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved', note: '同意' },
  });
  expect(store.docs.get('leaveRequests/' + REQUEST_ID)?.status).toBe('partial');
  expect((store.docs.get('leaveRequests/' + REQUEST_ID)?.courses as Array<Record<string, unknown>>)[0])
    .toMatchObject({ reviewStatus: 'approved', reviewedBy: 't1' });
  expect((store.docs.get('leaveRequests/' + REQUEST_ID)?.courses as Array<Record<string, unknown>>)[1]
    .reviewStatus).toBe('pending');
  await expect(api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'rejected', note: '不同意原因' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
  await api.reviewLeaveRequest({
    auth: { uid: 'admin' },
    data: { requestId: REQUEST_ID, courseId: 'c2', decision: 'rejected', note: '請補說明' },
  });
  expect(store.docs.get('leaveRequests/' + REQUEST_ID)?.status).toBe('completed');
  expect(summarize(store.docs.get('leaveRequests/' + REQUEST_ID)?.courses as Array<{ reviewStatus: string }>))
    .toBe('completed');
});

it('keeps extra course fields when writing a review', async () => {
  const store = seed();
  const api = handlers(store);
  await api.submitLeaveRequest(request());
  const saved = store.docs.get('leaveRequests/' + REQUEST_ID)!;
  const courses = saved.courses as Array<Record<string, unknown>>;
  store.docs.set('leaveRequests/' + REQUEST_ID, {
    ...saved,
    courses: [
      { ...courses[0], extraFlag: 'keep-me', section: 'A' },
      { ...courses[1], extraFlag: 'other' },
    ],
  });
  await api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved', note: '同意' },
  });
  const next = store.docs.get('leaveRequests/' + REQUEST_ID)?.courses as Array<Record<string, unknown>>;
  expect(next[0]).toMatchObject({
    courseId: 'c1',
    extraFlag: 'keep-me',
    section: 'A',
    reviewStatus: 'approved',
    reviewedBy: 't1',
  });
  expect(next[1]).toMatchObject({
    courseId: 'c2',
    extraFlag: 'other',
    reviewStatus: 'pending',
  });
});

it('only request owner can withdraw and only while no course was reviewed', async () => {
  const store = seed();
  const api = handlers(store);
  await api.submitLeaveRequest(request());
  await expect(api.withdrawLeaveRequest({
    auth: { uid: 'other' },
    data: { requestId: REQUEST_ID },
  })).rejects.toMatchObject({ code: 'not-found' });
  const result = await api.withdrawLeaveRequest({
    auth: { uid: student },
    data: { requestId: REQUEST_ID },
  });
  expect(result.status).toBe('withdrawn');
  expect(store.docs.get('leaveRequests/' + REQUEST_ID)?.status).toBe('withdrawn');
  expect((await api.withdrawLeaveRequest({
    auth: { uid: student },
    data: { requestId: REQUEST_ID },
  })).status).toBe('withdrawn');
  await expect(api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
});

it('reviewer list hides other teachers courses and blocks unassigned users', async () => {
  const store = seed();
  const api = handlers(store);
  await api.submitLeaveRequest(request());
  const response = await api.listLeaveReviewQueue({
    auth: { uid: teacher },
    data: { schoolId: school },
  });
  expect(response.rows).toHaveLength(1);
  expect(response.rows[0].studentName).toBe('陳同學');
  expect(response.rows[0].courses.map((course) => course.courseId)).toEqual(['c1']);
  await expect(api.listLeaveReviewQueue({
    auth: { uid: 'other' },
    data: { schoolId: school },
  })).rejects.toMatchObject({ code: 'permission-denied' });
  const admin = await api.listLeaveReviewQueue({
    auth: { uid: 'admin' },
    data: { schoolId: school },
  });
  expect(admin.rows[0].courses).toHaveLength(2);
});

it('account deletion blocks submission and teacher review', async () => {
  const store = seed();
  store.docs.set('users/s1', { accountDeletionInProgress: true });
  const api = handlers(store);
  await expect(api.submitLeaveRequest(request())).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  store.docs.set('users/s1', { displayName: '陳同學' });
  await api.submitLeaveRequest(request());
  store.docs.set('users/t1', { status: 'deleted' });
  await expect(api.reviewLeaveRequest({
    auth: { uid: 't1' },
    data: { requestId: REQUEST_ID, courseId: 'c1', decision: 'approved' },
  })).rejects.toMatchObject({ code: 'failed-precondition' });
});
