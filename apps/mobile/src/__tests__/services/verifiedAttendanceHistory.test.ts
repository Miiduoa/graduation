import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { listCourseMemberships } from '../../services/courseWorkspace';
import {
  loadVerifiedAttendanceHistory,
  summarizeVerifiedAttendance,
  verifiedReceiptStatus,
} from '../../services/verifiedAttendanceHistory';

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  query: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  orderBy: (...parts: unknown[]) => parts,
  limit: (count: number) => count,
}));
jest.mock('../../services/courseWorkspace', () => ({
  listCourseMemberships: jest.fn(),
}));

const db = {} as never;
const membership = { groupId: 'course-1', name: '資料結構', type: 'course', status: 'active', role: 'member' };
const session = {
  id: 'session-1',
  data: () => ({ active: false, startedAt: new Date('2026-10-27T01:00:00Z') }),
};
const receipt = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listCourseMemberships).mockResolvedValue([membership]);
  jest.mocked(getDocsFromServer).mockResolvedValue({ docs: [session] } as never);
  jest.mocked(getDocFromServer).mockResolvedValue(
    receipt({
      uid: 'student',
      groupId: 'course-1',
      sessionId: 'session-1',
      status: 'present',
      checkedInAt: new Date('2026-10-27T01:03:00Z'),
    }) as never,
  );
});

test('reads only signed-in member receipts and counts verified check-ins', async () => {
  const courses = await loadVerifiedAttendanceHistory(db, 'student', 'school-a');
  expect(listCourseMemberships).toHaveBeenCalledWith(db, 'student', 'school-a');
  expect(getDocFromServer).toHaveBeenCalledWith(
    'groups/course-1/attendanceSessions/session-1/attendanceRecords/student',
  );
  expect(courses[0].sessions[0].status).toBe('present');
  expect(summarizeVerifiedAttendance(courses)).toMatchObject({
    sessions: 1,
    confirmed: 1,
    absent: 0,
    unconfirmed: 0,
  });
});

test('a missing receipt stays unconfirmed instead of being classified as absent', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(receipt(null) as never);
  const courses = await loadVerifiedAttendanceHistory(db, 'student');
  expect(courses[0].sessions[0].status).toBe('unconfirmed');
  expect(summarizeVerifiedAttendance(courses)).toMatchObject({
    confirmed: 0,
    absent: 0,
    unconfirmed: 1,
  });
});

test('a server read failure stays unavailable instead of being classified as absent', async () => {
  jest.mocked(getDocFromServer).mockRejectedValue(new Error('offline'));
  const courses = await loadVerifiedAttendanceHistory(db, 'student');
  expect(courses[0].sessions[0].status).toBe('unavailable');
  expect(summarizeVerifiedAttendance(courses)).toMatchObject({
    absent: 0,
    unavailable: 1,
  });
});

test('rejects a mismatched receipt identity and only accepts explicit absence records', () => {
  expect(
    verifiedReceiptStatus({ uid: 'other', groupId: 'course-1', sessionId: 'session-1', status: 'present' }, {
      uid: 'student', groupId: 'course-1', sessionId: 'session-1',
    }),
  ).toBe('unavailable');
  expect(
    verifiedReceiptStatus({ uid: 'student', groupId: 'course-1', sessionId: 'session-1', status: 'absent' }, {
      uid: 'student', groupId: 'course-1', sessionId: 'session-1',
    }),
  ).toBe('absent');
});

test('does not replace a failed course lookup with fabricated demo sessions', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValue(new Error('network'));
  const courses = await loadVerifiedAttendanceHistory(db, 'student');
  expect(courses).toEqual([{ courseId: 'course-1', courseName: '資料結構', sessions: [], error: true }]);
});

test('does not read any course without a user', async () => {
  expect(await loadVerifiedAttendanceHistory(db, '')).toEqual([]);
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
