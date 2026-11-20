import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadAcademicRecords } from './academicClient';

const { fetchMock, getIdToken, auth } = vi.hoisted(() => {
  const getIdToken = vi.fn(async () => 'account-id-token');
  return {
    fetchMock: vi.fn(), getIdToken,
    auth: { currentUser: { uid: 'student-a', getIdToken } as { uid: string; getIdToken: () => Promise<string> } | null },
  };
});
vi.mock('./firebase', () => ({
  getAuth: () => auth,
  isFirebaseConfigured: () => true,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
}));
const response = () => ({
  success: true,
  ownerUid: 'student-a',
  schoolId: 'pu',
  source: 'pu-campus',
  dataType: 'grades',
  fetchedAt: '2026-10-08T00:00:00.000Z',
  result: {
    success: true,
    grades: [{ semester: '1151', courseName: '數學', credits: 3, courseType: '必修', score: 'Pass' }],
    allSemesters: ['1151'],
    summary: {},
  },
});
const reply = (result: unknown = response()) => new Response(JSON.stringify({ result }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const failure = (status: number, code: string, message = '讀取未完成') => new Response(JSON.stringify({
  error: { status: code, message },
}), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  auth.currentUser = { uid: 'student-a', getIdToken };
  getIdToken.mockResolvedValue('account-id-token');
  fetchMock.mockImplementation(async () => reply());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it('reads the hosted endpoint with the current Firebase token and only the record kind', async () => {
  const result = await loadAcademicRecords('grades', 'student-a');
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyAcademicRecords', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer account-id-token' },
    body: JSON.stringify({ data: { dataType: 'grades' } }),
    cache: 'no-store',
    signal: expect.any(AbortSignal),
  }));
  expect(result.records.grades[0].score).toBe('Pass');
  expect(result.ownerUid).toBe('student-a');
  expect(result.schoolId).toBe('pu');
});

it('uses the same-origin school reader when no paid Cloud Functions base URL is set', async () => {
  vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_BASE_URL', '');
  const result = await loadAcademicRecords('grades', 'student-a', 'pu');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.records.grades).toHaveLength(1);
});

it('rejects an unsupported expected school before calling the network', async () => {
  for (const schoolId of ['nthu', 'all', 'tw-pu']) {
    await expect(loadAcademicRecords('grades', 'student-a', schoolId)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  }
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getIdToken).not.toHaveBeenCalled();
});

it.each([
  { ownerUid: 'student-b' }, { schoolId: 'other' }, { source: 'cache' },
  { dataType: 'courses' }, { success: false }, { fetchedAt: 'not-a-date' },
])('rejects mismatched provenance %j', async (change) => {
  fetchMock.mockImplementation(async () => reply({ ...response(), ...change }));
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'unavailable' });
});

it('does not query while the captured account no longer matches Firebase', async () => {
  auth.currentUser = null;
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not send a token obtained for a login that has ended', async () => {
  getIdToken.mockImplementationOnce(async () => {
    auth.currentUser = { uid: 'student-b', getIdToken };
    return 'old-token';
  });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'reconnect' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['student-b', 'student-a'])('rejects a late reply after a new login for %s', async (uid) => {
  fetchMock.mockImplementationOnce(async () => {
    auth.currentUser = { uid, getIdToken };
    return reply();
  });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'reconnect' });
});

it.each([
  [401, 'UNAUTHENTICATED', 'reconnect'],
  [400, 'FAILED_PRECONDITION', 'reconnect'],
  [403, 'PERMISSION_DENIED', 'permission'],
  [429, 'RESOURCE_EXHAUSTED', 'unavailable'],
  [503, 'UNAVAILABLE', 'unavailable'],
] as const)('maps HTTP %s / %s to %s', async (httpStatus, code, reason) => {
  fetchMock.mockImplementationOnce(async () => failure(httpStatus, code));
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason });
});

it('maps an in-progress WOW Class sidecar to connecting', async () => {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
    error: { status: 'UNAVAILABLE', message: '正在連線 WOW Class，請稍候再讀取課程。', details: { code: 'lms-connecting' } },
  }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'connecting' });
});

it('only identifies a disabled service from an explicit server response', async () => {
  fetchMock.mockImplementationOnce(async () => failure(503, 'UNAVAILABLE', '尚未啟用'));
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'unconfigured' });
});

it('keeps the original network cause for actionable error copy', async () => {
  const cause = new TypeError('Failed to fetch');
  fetchMock.mockRejectedValueOnce(cause);
  const error = await loadAcademicRecords('grades', 'student-a').catch((item) => item);
  expect(error).toMatchObject({ reason: 'unavailable' });
  expect(error.cause).toBe(cause);
});

it('rejects an invalid envelope or school result instead of inventing an empty transcript', async () => {
  for (const payload of [
    [], null, {}, { result: { ...response(), result: { success: false, grades: [] } } },
  ]) {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(payload), { status: 200 }));
    await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  }
});

it('accepts the callable data envelope and preserves partial source metadata', async () => {
  const data = response();
  const result = { ...data.result, coverage: { status: 'partial', skippedRows: 2 } };
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ data: { ...data, result } }), { status: 200 }));
  const snapshot = await loadAcademicRecords('grades', 'student-a');
  expect(snapshot.records.coverage).toEqual({ status: 'partial', skippedRows: 2 });
});

it('aborts an unresponsive request and releases the timer after completion', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }));
  const request = loadAcademicRecords('grades', 'student-a');
  const outcome = expect(request).rejects.toMatchObject({ reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(45_000);
  await outcome;
  expect(vi.getTimerCount()).toBe(0);
});

it('expires a stalled token request without sending it after the deadline', async () => {
  vi.useFakeTimers();
  let resolveToken!: (token: string) => void;
  getIdToken.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
  const pending = expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(45_000);
  await pending;
  resolveToken('late-token');
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
