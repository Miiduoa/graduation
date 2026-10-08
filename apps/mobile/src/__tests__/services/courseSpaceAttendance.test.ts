import { getFunctions, httpsCallable } from 'firebase/functions';
import { checkInAttendance } from '../../data/courseSpaceSource';
import { onAttendanceCheckin } from '../../services/companionHooks';

jest.mock('firebase/firestore', () => ({}));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(() => 'functions'), httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({ getFirebaseApp: () => 'app', getCloudFunctionRegion: () => 'asia-east1' }));
jest.mock('../../services/courseWorkspace', () => ({}));
jest.mock('../../services/companionHooks', () => ({ onAttendanceCheckin: jest.fn() }));

const input = { courseSpaceId: 'course-1', sessionId: 'session-1', qrToken: 'full-server-token', uid: 'student-1' };
const receipt = { valid: true, attendanceRecorded: true, status: 'present', uid: input.uid,
  courseId: input.courseSpaceId, sessionId: input.sessionId, checkedInAt: '2026-10-08T06:30:00.000Z', alreadyRecorded: false };

beforeEach(() => jest.clearAllMocks());

test('the actual data adapter calls the verified endpoint in the configured region', async () => {
  const invoke = jest.fn().mockResolvedValue({ data: receipt });
  (httpsCallable as jest.Mock).mockReturnValue(invoke);
  await expect(checkInAttendance(input)).resolves.toMatchObject({ success: true, attendanceRecorded: true });
  expect(getFunctions).toHaveBeenCalledWith('app', 'asia-east1');
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'verifyAttendanceClaim');
  expect(invoke).toHaveBeenCalledWith({ courseId: input.courseSpaceId, sessionId: input.sessionId,
    claim: { token: input.qrToken, uid: input.uid } });
  expect(onAttendanceCheckin).toHaveBeenCalledTimes(1);
});

test('room-entry success alone does not mark attendance or emit companion hints', async () => {
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue({ data: { success: true, attendanceRecorded: false } }));
  await expect(checkInAttendance(input)).rejects.toThrow();
  expect(onAttendanceCheckin).not.toHaveBeenCalled();
});

test('an unavailable backend does not become a local success', async () => {
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn().mockRejectedValue(new Error('unavailable')));
  await expect(checkInAttendance(input)).rejects.toThrow('unavailable');
  expect(onAttendanceCheckin).not.toHaveBeenCalled();
});
