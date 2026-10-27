// @vitest-environment node
import { expect, it } from 'vitest';
import { createLiveSessionHandlers } from './attendanceSessionHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';

const base = 'groups/class-1';
const sessionId = 'session-review';
const livePath = `${base}/liveSessions/${sessionId}`;
const attendancePath = `${base}/attendanceSessions/${sessionId}`;

function storeWithCounts(liveCount: unknown, attendanceCount: unknown) {
  const metadata = { schemaVersion: 2, groupId: 'class-1', sessionId, active: false };
  return createMemoryGroupStore([
    [base, { name: '程式設計', type: 'course', schoolId: 'school-1' }],
    ['schools/school-1/members/teacher', { status: 'active' }],
    ['schools/school-1/members/student', { status: 'active' }],
    [`${base}/members/teacher`, { role: 'instructor', status: 'active' }],
    [`${base}/members/student`, { role: 'student', status: 'active' }],
    [livePath, { ...metadata, attendeeCount: liveCount }],
    [attendancePath, { ...metadata, attendeeCount: attendanceCount }],
  ]);
}

const correctionRequest = {
  auth: { uid: 'teacher' },
  data: {
    groupId: 'class-1', sessionId, studentUid: 'student',
    requestId: 'verified-correction', status: 'present', reason: '已核對課堂簽到紀錄',
  },
};

it.each([
  { label: 'numeric strings', live: '0', attendance: '0' },
  { label: 'empty strings', live: '', attendance: '' },
  { label: 'nulls', live: null, attendance: null },
  { label: 'false booleans', live: false, attendance: false },
  { label: 'true booleans', live: true, attendance: true },
  { label: 'arrays', live: [], attendance: [] },
  { label: 'missing counters', live: undefined, attendance: undefined },
  { label: 'string in live only', live: '0', attendance: 0 },
  { label: 'string in attendance only', live: 0, attendance: '0' },
  { label: 'null in live only', live: null, attendance: 0 },
  { label: 'null in attendance only', live: 0, attendance: null },
  { label: 'fractions', live: 1.5, attendance: 1.5 },
  { label: 'negative counters', live: -1, attendance: -1 },
  { label: 'non-finite counters', live: Infinity, attendance: Infinity },
  { label: 'NaN counters', live: NaN, attendance: NaN },
  { label: 'mismatched valid counters', live: 1, attendance: 0 },
])('rejects $label before updating receipts, counts or audit records', async ({ live, attendance }) => {
  const store = storeWithCounts(live, attendance);
  const beforeKeys = [...store.docs.keys()];
  const handlers = createLiveSessionHandlers({ db: store.db as never });
  await expect(handlers.correctAttendanceRecord(correctionRequest)).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  expect([...store.docs.keys()]).toEqual(beforeKeys);
  expect(store.docs.get(livePath)?.attendeeCount).toEqual(live);
  expect(store.docs.get(attendancePath)?.attendeeCount).toEqual(attendance);
  expect(store.docs.has(`${attendancePath}/attendanceRecords/student`)).toBe(false);
});

it('still accepts actual zero-valued numeric counters and commits one receipt and audit', async () => {
  const store = storeWithCounts(0, 0);
  const handlers = createLiveSessionHandlers({ db: store.db as never });
  await expect(handlers.correctAttendanceRecord(correctionRequest)).resolves.toMatchObject({
    success: true, reused: false, status: 'present',
  });
  expect(store.docs.get(livePath)?.attendeeCount).toBe(1);
  expect(store.docs.get(attendancePath)?.attendeeCount).toBe(1);
  expect(store.docs.get(`${attendancePath}/attendanceRecords/student`)).toMatchObject({
    uid: 'student', status: 'present', source: 'manual',
  });
  expect([...store.docs.keys()].filter((key) => key.startsWith(`${attendancePath}/attendanceCorrections/`))).toHaveLength(1);
});
