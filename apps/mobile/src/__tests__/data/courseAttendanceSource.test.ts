import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { getCloudFunctionRegion, getDb, getFirebaseApp } from '../../firebase';
import {
  checkInAttendance,
  getAttendanceSummary,
  startAttendanceSession,
} from '../../data/courseAttendanceSource';
import { parseLiveAttendanceConfirmation } from '../../services/attendanceConfirmation';
import { onAttendanceCheckin } from '../../services/companionHooks';
import { startAttendanceSession as startWorkspaceSession } from '../../services/courseWorkspace';

jest.mock('firebase/firestore', () => ({ collection: jest.fn(), getDocs: jest.fn() }));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getCloudFunctionRegion: jest.fn(),
  getDb: jest.fn(),
  getFirebaseApp: jest.fn(),
}));
jest.mock('../../services/companionHooks', () => ({ onAttendanceCheckin: jest.fn() }));
jest.mock('../../services/courseWorkspace', () => ({
  startAttendanceSession: jest.fn(),
  toDate: (value: unknown) => (value instanceof Date ? value : null),
}));

const callable = jest.fn();
const app = { name: 'campus' };
const functions = { region: 'asia-east1' };
const db = { name: 'campus-db' };
const collectionRef = { path: 'groups/course-1/attendanceSessions' };
const input = {
  courseSpaceId: 'course-1',
  sessionId: 'session-1',
  qrToken: 'server-issued-token',
  uid: 'student-1',
};
const confirmed = { success: true, attendanceRecorded: true };

function sessionDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getFirebaseApp).mockReturnValue(app as ReturnType<typeof getFirebaseApp>);
  jest.mocked(getCloudFunctionRegion).mockReturnValue('asia-east1');
  jest.mocked(getFunctions).mockReturnValue(functions as ReturnType<typeof getFunctions>);
  jest.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  jest.mocked(collection).mockReturnValue(collectionRef as ReturnType<typeof collection>);
  jest.mocked(httpsCallable).mockReturnValue(callable);
  callable.mockResolvedValue({ data: confirmed });
});

describe('live attendance acknowledgement', () => {
  it.each([
    null,
    undefined,
    [],
    'success',
    {},
    { success: true },
    { success: true, attendanceRecorded: false },
    { success: false, attendanceRecorded: true },
    { success: 'true', attendanceRecorded: true },
    { success: true, attendanceRecorded: 'true' },
  ])('does not accept an unconfirmed response: %p', (payload) => {
    expect(parseLiveAttendanceConfirmation(payload)).toBeNull();
  });

  it('accepts only an explicit attendance acknowledgement', () => {
    expect(parseLiveAttendanceConfirmation({ ...confirmed, extra: 'ignored' })).toEqual(confirmed);
  });
});

describe('checkInAttendance', () => {
  it.each([undefined, '', '   '])('rejects a missing QR token before calling the server: %p', async (qrToken) => {
    await expect(checkInAttendance({ ...input, qrToken })).rejects.toThrow('QR Code');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(onAttendanceCheckin).not.toHaveBeenCalled();
  });

  it.each([
    { courseSpaceId: '' },
    { courseSpaceId: 'groups/course-1' },
    { sessionId: ' ' },
    { sessionId: 'sessions/session-1' },
  ])('rejects an invalid document ID: %p', async (overrides) => {
    await expect(checkInAttendance({ ...input, ...overrides })).rejects.toThrow('課程或點名場次');
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it('uses the configured region and leaves identity to Firebase auth', async () => {
    await expect(checkInAttendance({ ...input, qrToken: ' server-issued-token ' })).resolves.toEqual(confirmed);
    expect(getFunctions).toHaveBeenCalledWith(app, 'asia-east1');
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'joinLiveSession');
    expect(callable).toHaveBeenCalledWith({
      groupId: 'course-1',
      sessionId: 'session-1',
      qrToken: 'server-issued-token',
    });
    expect(onAttendanceCheckin).toHaveBeenCalledWith({
      uid: 'student-1',
      sessionId: 'session-1',
      courseSpaceId: 'course-1',
    });
    expect(onAttendanceCheckin).toHaveBeenCalledTimes(1);
  });

  it.each([
    { success: true },
    { success: true, attendanceRecorded: false },
    { success: true, attendanceRecorded: 'true' },
    null,
  ])('does not announce attendance from room access alone: %p', async (data) => {
    callable.mockResolvedValue({ data });
    await expect(checkInAttendance(input)).rejects.toThrow('尚未確認出席紀錄');
    expect(onAttendanceCheckin).not.toHaveBeenCalled();
  });

  it('waits for acknowledgement before emitting companion feedback', async () => {
    let acknowledge!: (value: { data: typeof confirmed }) => void;
    callable.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const pending = checkInAttendance(input);
    expect(onAttendanceCheckin).not.toHaveBeenCalled();
    acknowledge({ data: confirmed });
    await expect(pending).resolves.toEqual(confirmed);
    expect(onAttendanceCheckin).toHaveBeenCalledTimes(1);
  });

  it.each(['permission-denied', 'deadline-exceeded', 'unavailable'])('preserves the server error %s', async (code) => {
    const error = Object.assign(new Error('Check-in rejected'), { code: `functions/${code}` });
    callable.mockRejectedValue(error);
    await expect(checkInAttendance(input)).rejects.toBe(error);
    expect(onAttendanceCheckin).not.toHaveBeenCalled();
  });

  it('does not undo attendance when optional feedback throws', async () => {
    jest.mocked(onAttendanceCheckin).mockImplementation(() => { throw new Error('Feedback unavailable'); });
    await expect(checkInAttendance(input)).resolves.toEqual(confirmed);
  });

  it('does not undo attendance when optional feedback rejects asynchronously', async () => {
    jest.mocked(onAttendanceCheckin).mockImplementation(() => Promise.reject(new Error('Feedback unavailable')));
    await expect(checkInAttendance(input)).resolves.toEqual(confirmed);
  });
});

describe('startAttendanceSession', () => {
  it('passes the configured app, region and session options', async () => {
    const session = { success: true, sessionId: 'session-1', qrToken: 'issued-token' };
    jest.mocked(startWorkspaceSession).mockResolvedValue(session);
    await expect(startAttendanceSession({
      courseSpaceId: 'course-1', classroomLat: 24, classroomLng: 120, qrExpiryMinutes: 5,
    })).resolves.toEqual(session);
    expect(getFunctions).toHaveBeenCalledWith(app, 'asia-east1');
    expect(startWorkspaceSession).toHaveBeenCalledWith(functions, {
      groupId: 'course-1', classroomLat: 24, classroomLng: 120, qrExpiryMinutes: 5,
    });
  });
});

describe('getAttendanceSummary', () => {
  it('does not substitute live-room participants when attendance is empty', async () => {
    jest.mocked(getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);
    await expect(getAttendanceSummary('course-1')).resolves.toEqual({
      groupId: 'course-1', totalSessions: 0, activeSessions: 0, totalAttendees: 0, latestSession: null,
    });
    expect(collection).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith(db, 'groups', 'course-1', 'attendanceSessions');
    expect(getDocs).toHaveBeenCalledTimes(1);
  });

  it('aggregates canonical records and selects the most recent session', async () => {
    const older = new Date('2026-10-01T01:00:00Z');
    const newer = new Date('2026-10-08T01:00:00Z');
    jest.mocked(getDocs).mockResolvedValue({ docs: [
      sessionDoc('older', { active: false, attendeeCount: 2, startedAt: older }),
      sessionDoc('newer', { active: true, attendeeCount: 3, startedAt: newer, attendanceMode: 'qr' }),
    ] } as unknown as Awaited<ReturnType<typeof getDocs>>);
    const summary = await getAttendanceSummary('course-1');
    expect(summary).toMatchObject({ totalSessions: 2, activeSessions: 1, totalAttendees: 5 });
    expect(summary.latestSession).toMatchObject({ id: 'newer', source: 'attendance', startedAt: newer });
  });

  it('does not turn malformed counts or truthy strings into attendance', async () => {
    jest.mocked(getDocs).mockResolvedValue({ docs: [-1, 1.5, NaN, Infinity, '4', null].map((count, index) =>
      sessionDoc(String(index), { attendeeCount: count, active: 'true' }),
    ) } as unknown as Awaited<ReturnType<typeof getDocs>>);
    const summary = await getAttendanceSummary('course-1');
    expect(summary.totalAttendees).toBe(0);
    expect(summary.activeSessions).toBe(0);
  });

  it('reports a failed read instead of returning an empty successful summary', async () => {
    const error = new Error('permission-denied');
    jest.mocked(getDocs).mockRejectedValue(error);
    await expect(getAttendanceSummary('course-1')).rejects.toBe(error);
    expect(getDocs).toHaveBeenCalledTimes(1);
  });
});
