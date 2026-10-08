import { beforeEach, expect, it, vi } from 'vitest';
import { getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  attendanceCsv,
  joinCourseAttendance,
  loadCourseAttendance,
  startCourseAttendance,
} from './courseAttendance';
vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => true,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (...parts: unknown[]) => parts,
  limit: (value: number) => value,
  orderBy: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
const document = (data: Record<string, unknown> | null) => ({
  exists: () => !!data,
  data: () => data,
});
beforeEach(() => vi.clearAllMocks());
it('does not read session or class data for a revoked member', async () => {
  vi.mocked(getDoc).mockResolvedValue(document({ status: 'removed', role: 'instructor' }) as never);
  await expect(loadCourseAttendance('class', 'alice')).rejects.toThrow();
  expect(getDocs).not.toHaveBeenCalled();
});
it('uses private per-user receipts and excludes old public session documents', async () => {
  vi.mocked(getDoc)
    .mockResolvedValueOnce(document({ status: 'active', role: 'member' }) as never)
    .mockResolvedValueOnce(document({ name: 'Class' }) as never)
    .mockResolvedValueOnce(document({ checkedInAt: '2026-10-07T01:00:00Z' }) as never);
  vi.mocked(getDocs).mockResolvedValue({
    docs: [{ id: 's1', data: () => ({ active: true, schemaVersion: 2 }) }],
  } as never);
  const result = await loadCourseAttendance('class', 'alice');
  expect(getDocs).toHaveBeenCalledWith([
    'groups/class/attendanceSessions',
    ['schemaVersion', '==', 2],
    ['startedAt', 'desc'],
    50,
  ]);
  expect(getDoc).toHaveBeenLastCalledWith(
    'groups/class/attendanceSessions/s1/attendanceRecords/alice',
  );
  expect(result.canStart).toBe(false);
  expect(result.sessions[0].ownRecord?.checkedInAt).toBe('2026-10-07T01:00:00.000Z');
});
it('sends caller identity for start retries and does not accept false success', async () => {
  const call = vi.fn().mockResolvedValue({ data: { success: false } });
  vi.mocked(httpsCallable).mockReturnValue(call as unknown as ReturnType<typeof httpsCallable>);
  await expect(startCourseAttendance('class', 'same-attempt')).rejects.toThrow();
  expect(call).toHaveBeenCalledWith({
    groupId: 'class',
    requestId: 'same-attempt',
    qrExpiryMinutes: 10,
  });
});
it('rejects blank tokens without calling the backend', async () => {
  await expect(joinCourseAttendance('class', 'session', '  ')).rejects.toThrow();
  expect(httpsCallable).not.toHaveBeenCalled();
});
it('escapes commas, quotes and spreadsheet formula prefixes in exports', () => {
  const csv = attendanceCsv([
    { uid: 'u1', studentId: '=1+1', displayName: '陳,"同學"', checkedInAt: null },
  ]);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"陳,""同學"""');
});
