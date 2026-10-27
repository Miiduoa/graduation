import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, getDocsFromServer, limit } from 'firebase/firestore';
import { loadCourseAttendanceRoster } from './courseAttendance';
import { loadAttendanceRegister } from './loadAttendanceRegister';

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (...parts: unknown[]) => parts,
  limit: vi.fn((count: number) => count),
  getDocFromServer: vi.fn(), getDocsFromServer: vi.fn(),
}));
vi.mock('./firebase', () => ({ getDb: () => ({}) }));
vi.mock('./courseAttendance', () => ({ loadCourseAttendanceRoster: vi.fn() }));
const session = (patch: Record<string, unknown> = {}) => ({
  exists: () => true,
  data: () => ({ schemaVersion: 2, groupId: 'course', sessionId: 'session', active: false, ...patch }),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValue([{ uid: 'a', displayName: '學生甲', studentId: 'S001' }]);
  vi.mocked(getDocFromServer).mockResolvedValue(session() as never);
  vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
});
it('checks instructor membership before reading server-owned records', async () => {
  vi.mocked(loadCourseAttendanceRoster).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadAttendanceRegister('course', 'session')).rejects.toThrow('permission-denied');
  expect(getDocFromServer).not.toHaveBeenCalled();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
it('rejects a session from a different course before reading a roster', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(session({ groupId: 'other' }) as never);
  await expect(loadAttendanceRegister('course', 'session')).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
it('retains absence with a null timestamp and uses a bounded collection read', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs: [{ id: 'a', data: () => ({
    uid: 'a', groupId: 'course', sessionId: 'session', status: 'absent', source: 'manual',
    checkedInAt: null, correctedAt: '2026-10-27T01:00:00Z',
  }) }] } as never);
  const result = await loadAttendanceRegister('course', 'session');
  expect(result.rows[0].status).toBe('absent');
  expect(result.complete).toBe(true);
  expect(limit).toHaveBeenCalledWith(501);
  expect(getDocsFromServer).toHaveBeenCalledWith(['groups/course/attendanceSessions/session/attendanceRecords', 501]);
});
it('marks unread members unavailable when the query exceeds the receipt cap', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs: Array.from({ length: 501 }, (_, index) => ({ id: `old-${index}`, data: () => ({}) })) } as never);
  const result = await loadAttendanceRegister('course', 'session');
  expect(result.complete).toBe(false);
  expect(result.rows[0].status).toBe('unavailable');
});
it('propagates offline failures instead of claiming a class has no records', async () => {
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadAttendanceRegister('course', 'session')).rejects.toThrow('offline');
});
