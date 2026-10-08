import { getFunctions, httpsCallable } from 'firebase/functions';

import { getCloudFunctionRegion, getFirebaseApp } from '../../firebase';
import { checkInAttendance } from '../../data/courseAttendanceSource';
import { recordCompanionEvent } from '../../services/companionSignalRecorder';

jest.mock('firebase/firestore', () => ({ collection: jest.fn(), getDocs: jest.fn() }));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getCloudFunctionRegion: jest.fn(),
  getDb: jest.fn(),
  getFirebaseApp: jest.fn(),
}));
jest.mock('../../services/courseWorkspace', () => ({
  startAttendanceSession: jest.fn(),
  toDate: jest.fn(),
}));
jest.mock('../../services/companionSignalRecorder', () => ({ recordCompanionEvent: jest.fn() }));

const callable = jest.fn();
const input = {
  courseSpaceId: 'course-1',
  sessionId: 'session-1',
  qrToken: 'server-issued-token',
  uid: 'student-1',
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getFirebaseApp).mockReturnValue({ name: 'campus' } as ReturnType<typeof getFirebaseApp>);
  jest.mocked(getCloudFunctionRegion).mockReturnValue('asia-east1');
  jest.mocked(getFunctions).mockReturnValue({} as ReturnType<typeof getFunctions>);
  jest.mocked(httpsCallable).mockReturnValue(callable);
  jest.mocked(recordCompanionEvent).mockResolvedValue(undefined);
});

describe('course attendance feedback integration', () => {
  it('records the authenticated student and session through the real companion hook', async () => {
    callable.mockResolvedValue({ data: { success: true, attendanceRecorded: true } });

    await checkInAttendance(input);

    expect(recordCompanionEvent).toHaveBeenCalledTimes(1);
    expect(recordCompanionEvent).toHaveBeenCalledWith('attendance_checkin', {
      uid: 'student-1',
      payload: { sessionId: 'session-1', courseSpaceId: 'course-1' },
    });
  });

  it('does not record a room join as an attendance event', async () => {
    callable.mockResolvedValue({ data: { success: true, attendanceRecorded: false } });

    await expect(checkInAttendance(input)).rejects.toThrow('尚未確認出席紀錄');
    expect(recordCompanionEvent).not.toHaveBeenCalled();
  });

  it('does not record an event when the server rejects the QR token', async () => {
    const error = Object.assign(new Error('QR code has expired'), { code: 'functions/deadline-exceeded' });
    callable.mockRejectedValue(error);

    await expect(checkInAttendance(input)).rejects.toBe(error);
    expect(recordCompanionEvent).not.toHaveBeenCalled();
  });
});
