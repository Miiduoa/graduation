/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  checkIn,
  generateRotatingQR,
  getSessionById,
  subscribeToSession,
  type AttendanceSession,
} from '../services/smartAttendanceEngine';
import { loadRoleEventInbox } from '../services/roleEventBus';
import { isFirebaseMockMode } from '../firebase';
import { getReleaseConfig } from '../services/release';
import { onSnapshot } from 'firebase/firestore';

jest.mock('../services/release', () => ({
  getReleaseConfig: jest.fn(() => ({ appEnv: 'development' })),
}));
jest.mock('../firebase', () => ({ isFirebaseMockMode: jest.fn(() => true), getDb: jest.fn() }));
jest.mock('../services/tronClassClient', () => ({}));
jest.mock('../services/puDataCache', () => ({}));
jest.mock('../services/mockAuth', () => ({}));
jest.mock('../services/testSeedData', () => ({}));

const now = Date.parse('2026-10-07T10:00:00Z');
function session(overrides: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: 'session-1',
    courseId: 'tc:71378',
    courseName: '機器學習',
    courseCode: 'ML',
    teacherId: 'teacher-other',
    teacherName: '授課老師',
    sessionDate: '2026-10-07',
    startTime: now,
    endTime: null,
    location: '',
    mode: 'number_code',
    status: 'active',
    qrSecret: 'session-secret',
    numberCode: '123456',
    lateThresholdMinutes: 10,
    totalStudents: 1,
    presentCount: 0,
    lateCount: 0,
    absentCount: 1,
    excusedCount: 0,
    records: [
      {
        id: 'r1',
        sessionId: 'session-1',
        studentId: 'student-1',
        studentName: '學生',
        avatarUrl: null,
        status: 'absent',
        checkInTime: null,
        note: '',
      },
    ],
    createdAt: now,
    ...overrides,
  };
}
async function seed(overrides: Partial<AttendanceSession> = {}) {
  await AsyncStorage.setItem('@attend:sessions', JSON.stringify([session(overrides)]));
}
const numberProof = { method: 'number_code' as const, code: '123456' };

beforeEach(async () => {
  jest.mocked(getReleaseConfig).mockReturnValue({ appEnv: 'development' } as never);
  jest.useFakeTimers().setSystemTime(now);
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await AsyncStorage.clear();
  await seed();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('valid check-in persists once and notifies the session teacher with the original course ID', async () => {
  expect(await checkIn('session-1', 'student-1', '學生', numberProof)).toMatchObject({
    success: true,
    status: 'present',
  });
  const saved = await getSessionById('session-1');
  expect(saved).toMatchObject({ presentCount: 1, absentCount: 0 });
  expect(saved?.records[0]).toMatchObject({ status: 'present', checkInTime: now });
  const inbox = await loadRoleEventInbox('teacher-other');
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    courseId: 'tc:71378',
    targetUids: ['teacher-other'],
    payload: { method: 'number_code', status: 'present' },
  });
  expect(await loadRoleEventInbox('demo_teacher_chang')).toHaveLength(0);
  expect(await checkIn('session-1', 'student-1', '學生', numberProof)).toMatchObject({
    success: false,
  });
  expect(await loadRoleEventInbox('teacher-other')).toHaveLength(1);
});

test.each([
  ['wrong number', {}, { ...numberProof, code: '000000' }],
  ['missing proof', {}, undefined],
  ['manual session', { mode: 'manual' }, numberProof],
  ['ended session', { status: 'completed' }, numberProof],
  [
    'QR used for number-only session',
    {},
    { method: 'rotating_qr', code: generateRotatingQR('session-1', 'session-secret', now) },
  ],
  [
    'expired QR',
    { mode: 'rotating_qr' },
    {
      method: 'rotating_qr',
      code: generateRotatingQR('session-1', 'session-secret', now - 60_000),
    },
  ],
])('%s cannot mutate attendance or notify the teacher', async (_, overrides, proof) => {
  await seed(overrides as Partial<AttendanceSession>);
  const before = await AsyncStorage.getItem('@attend:sessions');
  expect(
    await checkIn('session-1', 'student-1', '學生', proof as typeof numberProof),
  ).toMatchObject({ success: false });
  expect(await AsyncStorage.getItem('@attend:sessions')).toBe(before);
  expect(await loadRoleEventInbox('teacher-other')).toHaveLength(0);
});

test.each(['', 'teacher-other'])('identity %s cannot check in', async (uid) => {
  expect(await checkIn('session-1', uid, '學生', numberProof)).toMatchObject({ success: false });
});

test('fresh QR is validated and late status reaches the teacher', async () => {
  await seed({ mode: 'rotating_qr', startTime: now - 11 * 60_000 });
  expect(
    await checkIn('session-1', 'student-1', '學生', {
      method: 'rotating_qr',
      code: generateRotatingQR('session-1', 'session-secret', now),
    }),
  ).toMatchObject({ success: true, status: 'late' });
  expect((await loadRoleEventInbox('teacher-other'))[0].payload).toMatchObject({
    status: 'late',
    method: 'rotating_qr',
  });
});

test('QR sessions accept the displayed six-digit fallback', async () => {
  await seed({ mode: 'rotating_qr' });
  expect(await checkIn('session-1', 'student-1', '學生', numberProof)).toMatchObject({
    success: true,
  });
});

test('failed attendance persistence does not report success or notify', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(checkIn('session-1', 'student-1', '學生', numberProof)).rejects.toThrow('disk full');
  expect(await loadRoleEventInbox('teacher-other')).toHaveLength(0);
});

test('subscription sees saved check-ins and stops on unsubscribe', async () => {
  const callback = jest.fn();
  const unsubscribe = subscribeToSession('session-1', callback);
  await checkIn('session-1', 'student-1', '學生', numberProof);
  await jest.advanceTimersByTimeAsync(3000);
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ presentCount: 1 }));
  unsubscribe();
  callback.mockClear();
  await jest.advanceTimersByTimeAsync(6000);
  expect(callback).not.toHaveBeenCalled();
});

test('cloud subscription failure preserves local demo updates', async () => {
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  const stop = jest.fn();
  jest.mocked(onSnapshot).mockImplementationOnce((...args: any[]) => {
    args[2](new Error('permission-denied'));
    return stop;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const callback = jest.fn();
  const unsubscribe = subscribeToSession('session-1', callback);
  await jest.advanceTimersByTimeAsync(3000);
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
  unsubscribe();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('production never reports a local-only check-in as confirmed', async () => {
  jest.mocked(getReleaseConfig).mockReturnValue({ appEnv: 'production' } as never);
  const before = await AsyncStorage.getItem('@attend:sessions');
  await expect(checkIn('session-1', 'student-1', 'Student', numberProof)).rejects.toThrow(
    '尚未開放',
  );
  expect(await AsyncStorage.getItem('@attend:sessions')).toBe(before);
  expect(await loadRoleEventInbox('teacher-other')).toEqual([]);
});
