import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import {
  attendanceCsv,
  attendanceError,
  hasOwnActiveAttendance,
  joinCourseAttendance,
  loadCourseAttendance,
  loadAttendanceCode,
  loadAttendanceRecords,
  startCourseAttendance,
  studentAttendanceHeading,
  studentCheckInSession,
  type AttendanceSession,
} from './courseAttendance';
import { FunctionsUnconfiguredError } from './functionsUrl';

const auth = vi.hoisted(() => ({
  currentUser: { uid: 'alice', getIdToken: async () => 'id-token' } as {
    uid: string;
    getIdToken: () => Promise<string>;
  } | null,
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => auth,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
  isFirebaseConfigured: () => true,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (...parts: unknown[]) => parts,
  limit: (value: number) => value,
  orderBy: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
const document = (data: Record<string, unknown> | null) => ({
  exists: () => !!data,
  data: () => data,
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'alice', getIdToken: async () => 'id-token' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('does not read session or class data for a revoked member', async () => {
  vi.mocked(getDocFromServer).mockResolvedValue(document({ status: 'removed', role: 'instructor' }) as never);
  await expect(loadCourseAttendance('class', 'alice')).rejects.toThrow();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
it('uses private per-user receipts and excludes old public session documents', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ status: 'active', role: 'member' }) as never)
    .mockResolvedValueOnce(document({ name: 'Class' }) as never)
    .mockResolvedValueOnce(
      document({
        uid: 'alice',
        groupId: 'class',
        sessionId: 's1',
        status: 'present',
        checkedInAt: '2026-10-07T01:00:00Z',
      }) as never,
    );
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [{ id: 's1', data: () => ({ active: true, schemaVersion: 2 }) }],
  } as never);
  const result = await loadCourseAttendance('class', 'alice');
  expect(getDocsFromServer).toHaveBeenCalledWith([
    'groups/class/attendanceSessions',
    ['schemaVersion', '==', 2],
    ['startedAt', 'desc'],
    50,
  ]);
  expect(getDocFromServer).toHaveBeenLastCalledWith(
    'groups/class/attendanceSessions/s1/attendanceRecords/alice',
  );
  expect(result.canStart).toBe(false);
  expect(result.sessions[0].ownRecord?.checkedInAt).toBe('2026-10-07T01:00:00.000Z');
});
it('sends caller identity for start retries and does not accept false success', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ result: { success: false } }),
  });
  await expect(startCourseAttendance('class', 'same-attempt')).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/startLiveSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
    body: JSON.stringify({
      data: { groupId: 'class', requestId: 'same-attempt', qrExpiryMinutes: 10 },
    }),
    cache: 'no-store',
  });
});
it('rejects blank tokens without calling the backend', async () => {
  await expect(joinCourseAttendance('class', 'session', '  ')).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('joins through the same-origin /api/fn route and maps expired tokens', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 504,
    json: async () => ({ error: { status: 'DEADLINE_EXCEEDED', message: 'QR code has expired' } }),
  });
  await expect(joinCourseAttendance('class', 'session', 'teacher-code-long')).rejects.toMatchObject(
    {
      code: 'functions/deadline-exceeded',
    },
  );
  expect(fetchMock.mock.calls[0][0]).toBe('/api/fn/joinLiveSession');
  expect(attendanceError({ code: 'functions/deadline-exceeded' })).toBe(
    '簽到碼已過期，請聯絡授課教師。',
  );
});
it('surfaces 尚未啟用 when the same-origin attendance route is not configured', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ error: { status: 'UNAVAILABLE', message: '尚未啟用' } }),
  });
  await expect(startCourseAttendance('class', 'attempt')).rejects.toBeInstanceOf(
    FunctionsUnconfiguredError,
  );
  expect(attendanceError(new FunctionsUnconfiguredError('點名尚未啟用'))).toBe('點名尚未啟用');
});
it('does not send a mutation without a Firebase session', async () => {
  auth.currentUser = null;
  await expect(startCourseAttendance('class', 'attempt')).rejects.toMatchObject({
    code: 'functions/unauthenticated',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('lets a student check into only the latest open session of this course', () => {
  const session = (id: string, active: boolean, startedAt: string | null): AttendanceSession => ({
    id,
    teacherId: 'teacher',
    active,
    startedAt,
    endedAt: active ? null : startedAt,
    qrExpiresAt: startedAt,
    attendeeCount: 0,
    ownRecord: null,
  });
  const sessions = [
    session('older-open', true, '2026-10-16T01:00:00Z'),
    session('ended', false, '2026-10-16T00:00:00Z'),
    session('latest-open', true, '2026-10-16T02:00:00Z'),
  ];
  expect(studentCheckInSession(sessions)?.id).toBe('latest-open');
  expect(studentCheckInSession(sessions.filter((row) => !row.active))).toBeNull();
  expect(hasOwnActiveAttendance(sessions, 'teacher')).toBe(true);
  expect(hasOwnActiveAttendance(sessions, 'other-teacher')).toBe(false);
  expect(studentAttendanceHeading('微積分', true)).toBe('微積分 · 點名進行中');
  expect(studentAttendanceHeading('程式設計', true)).toBe('程式設計 · 點名進行中');
  expect(studentAttendanceHeading('微積分', true)).not.toBe(
    studentAttendanceHeading('程式設計', true),
  );
});

it('escapes commas, quotes and spreadsheet formula prefixes in exports', () => {
  const csv = attendanceCsv([
    { uid: 'u1', studentId: '=1+1', displayName: '陳,"同學"', checkedInAt: null },
  ]);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"陳,""同學"""');
});

it('fetches the teacher QR token from the server rather than offline cache', async () => {
  vi.mocked(getDocFromServer).mockResolvedValue(document({ qrToken: 'server-issued-token' }) as never);
  await expect(loadAttendanceCode('class', 's1')).resolves.toBe('server-issued-token');
  expect(getDocFromServer).toHaveBeenCalledWith('groups/class/liveSessionSecrets/s1');
  vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadAttendanceCode('class', 's1')).rejects.toThrow('offline');
});

it('does not report a confirmed check-in from an absent or mismatched receipt', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ status: 'active', role: 'member' }) as never)
    .mockResolvedValueOnce(document({ name: 'Class' }) as never)
    .mockResolvedValueOnce(
      document({
        uid: 'alice',
        groupId: 'another-class',
        sessionId: 's1',
        status: 'present',
        checkedInAt: '2026-10-07T01:00:00Z',
      }) as never,
    );
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [{ id: 's1', data: () => ({ active: true, schemaVersion: 2 }) }],
  } as never);
  const response = await loadCourseAttendance('class', 'alice');
  expect(response.sessions[0].ownRecord).toBeNull();
});
it('teacher roster includes only server-confirmed present or late records', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [
      { id: 'alice', data: () => ({
        uid: 'alice', groupId: 'class', sessionId: 's1',
        status: 'present', checkedInAt: '2026-10-07T01:00:00Z',
      }) },
      { id: 'bob', data: () => ({
        uid: 'bob', groupId: 'class', sessionId: 's1',
        status: 'absent', checkedInAt: null,
      }) },
      { id: 'mallory', data: () => ({
        uid: 'mallory', groupId: 'other-class', sessionId: 's1',
        status: 'present', checkedInAt: '2026-10-07T01:00:00Z',
      }) },
    ],
  } as never);
  expect(await loadAttendanceRecords('class', 's1')).toMatchObject([
    { uid: 'alice', checkedInAt: '2026-10-07T01:00:00.000Z' },
  ]);
});
it('rejects reading stale cached permission and never treats offline cache as authority', async () => {
  vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadCourseAttendance('class', 'alice')).rejects.toThrow('offline');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
