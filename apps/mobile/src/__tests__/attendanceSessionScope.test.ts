/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createSession,
  endSession,
  filterActiveSessionsForStudent,
  getActiveSessionsForStudent,
  getSessionById,
  type AttendanceSession,
} from '../services/smartAttendanceEngine';
import { isFirebaseMockMode } from '../firebase';
import { getReleaseConfig } from '../services/release';

jest.mock('../services/release', () => ({
  getReleaseConfig: jest.fn(() => ({ appEnv: 'development' })),
}));
jest.mock('../firebase', () => ({ isFirebaseMockMode: jest.fn(() => true), getDb: jest.fn() }));
jest.mock('../services/tronClassClient', () => ({
  hasTCSession: jest.fn(async () => false),
}));
jest.mock('../services/puDataCache', () => ({}));
jest.mock('../services/mockAuth', () => ({
  loadMockAuthSession: jest.fn(async () => null),
}));
jest.mock('../services/testSeedData', () => ({
  isTestAccount: jest.fn(() => false),
  getTestClassRoster: jest.fn(() => []),
}));

const now = Date.parse('2026-10-16T10:00:00Z');

function session(overrides: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: 'session-a',
    courseId: 'course-a',
    courseName: '微積分',
    courseCode: 'CALC',
    teacherId: 'teacher-1',
    teacherName: '教師',
    sessionDate: '2026-10-16',
    startTime: now,
    endTime: null,
    location: '',
    mode: 'number_code',
    status: 'active',
    qrSecret: 'secret-a',
    numberCode: '111111',
    lateThresholdMinutes: 10,
    totalStudents: 1,
    presentCount: 0,
    lateCount: 0,
    absentCount: 1,
    excusedCount: 0,
    records: [],
    createdAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  jest.mocked(getReleaseConfig).mockReturnValue({ appEnv: 'development' } as never);
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  jest.useFakeTimers().setSystemTime(now);
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('students only see open sessions for their own courses, and only the latest one per course', () => {
  const ownOld = session({ id: 'own-old', courseId: 'course-a', startTime: now - 1000 });
  const ownNew = session({ id: 'own-new', courseId: 'course-a', startTime: now });
  const otherClass = session({ id: 'other', courseId: 'course-b', courseName: '程式設計' });
  const ended = session({ id: 'ended', courseId: 'course-a', status: 'completed', endTime: now });
  expect(filterActiveSessionsForStudent([ownOld, ownNew, otherClass, ended], ['course-a'])).toEqual([
    ownNew,
  ]);
  expect(filterActiveSessionsForStudent([ownNew, otherClass], [])).toEqual([]);
  expect(filterActiveSessionsForStudent([otherClass], ['course-a'])).toEqual([]);
});

test('two enrolled courses keep separate labeled sessions when both are live', () => {
  const calculus = session({ id: 'calc-open', courseId: 'course-a', courseName: '微積分' });
  const programming = session({
    id: 'prog-open',
    courseId: 'course-b',
    courseName: '程式設計',
  });
  const visible = filterActiveSessionsForStudent([calculus, programming], [
    'course-a',
    'course-b',
  ]);
  expect(visible.map((row) => row.id).sort()).toEqual(['calc-open', 'prog-open']);
  expect(visible.map((row) => row.courseName).sort()).toEqual(['微積分', '程式設計']);
  expect(new Set(visible.map((row) => row.id)).size).toBe(2);
});

test('student lookup ignores another class even when that session is still open', async () => {
  await AsyncStorage.setItem(
    '@attend:sessions',
    JSON.stringify([
      session({ id: 'mine', courseId: 'course-a' }),
      session({ id: 'theirs', courseId: 'course-b', courseName: '程式設計' }),
    ]),
  );
  const visible = await getActiveSessionsForStudent(['course-a']);
  expect(visible.map((row) => row.id)).toEqual(['mine']);
});

test('opening a new session for the same class ends the old one and leaves another class open', async () => {
  await AsyncStorage.setItem(
    '@attend:sessions',
    JSON.stringify([
      session({ id: 'old-a', courseId: 'course-a' }),
      session({ id: 'open-b', courseId: 'course-b', courseName: '程式設計' }),
    ]),
  );
  const created = await createSession({
    courseId: 'course-a',
    tcCourseId: 1,
    courseName: '微積分',
    courseCode: 'CALC',
    teacherId: 'teacher-1',
    teacherName: '教師',
    mode: 'number_code',
  });
  expect((await getSessionById('old-a'))?.status).toBe('completed');
  expect((await getSessionById('open-b'))?.status).toBe('active');
  expect(created.status).toBe('active');
  expect(created.courseId).toBe('course-a');
});

test('ending a session only closes that session', async () => {
  await AsyncStorage.setItem(
    '@attend:sessions',
    JSON.stringify([
      session({ id: 'session-a', courseId: 'course-a' }),
      session({ id: 'session-b', courseId: 'course-b', courseName: '程式設計' }),
    ]),
  );
  await endSession('session-a');
  expect((await getSessionById('session-a'))?.status).toBe('completed');
  expect((await getSessionById('session-b'))?.status).toBe('active');
});
