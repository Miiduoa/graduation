import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadTronClassCourses } from './tronClassCourses';

const { fetchMock, token, auth } = vi.hoisted(() => {
  const token = vi.fn(async () => 'id-token');
  return { fetchMock: vi.fn(), token,
    auth: { currentUser: { uid: 'student-a', getIdToken: token } as { uid: string; getIdToken: () => Promise<string> } | null } };
});
vi.mock('./firebase', () => ({ getAuth: () => auth, isFirebaseConfigured: () => true,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}` }));

function result(change: Record<string, unknown> = {}) {
  return { success: true, ownerUid: 'student-a', schoolId: 'pu', source: 'pu-tronclass',
    fetchedAt: '2026-10-27T10:00:00Z', status: 'ongoing', courses: [{
      id: 42, name: '資料庫', code: 'IM101', teachers: ['王老師'], semester: '1151', status: 'ongoing',
      href: 'https://untrusted.example/course',
    }], ...change };
}
function response(change: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ result: result(change) }), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  auth.currentUser = { uid: 'student-a', getIdToken: token };
  token.mockResolvedValue('id-token');
  fetchMock.mockImplementation(async () => response());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reads the current account courses with the hosted endpoint and fixed official links', async () => {
  const snapshot = await loadTronClassCourses('student-a');
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyTronClassCourses', expect.objectContaining({
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
    body: JSON.stringify({ data: { status: 'ongoing' } }), cache: 'no-store',
  }));
  expect(snapshot.courses[0].href).toBe('https://tronclass.pu.edu.tw/course/42/content');
});

it.each([{ ownerUid: 'student-b' }, { schoolId: 'other' }, { source: 'cache' },
  { status: 'completed' }, { fetchedAt: 'invalid' }, { success: false }])('rejects wrong provenance: %j', async (change) => {
  fetchMock.mockImplementationOnce(async () => response(change));
  await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
});

it('does not query when the selected school or account does not match', async () => {
  await expect(loadTronClassCourses('student-a', 'ongoing', 'other')).rejects.toMatchObject({ reason: 'unavailable' });
  auth.currentUser = null;
  await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['student-a', 'student-b'])('discards a response after a new login for %s', async (uid) => {
  fetchMock.mockImplementationOnce(async () => {
    auth.currentUser = { uid, getIdToken: token };
    return response();
  });
  await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'reconnect' });
});

it('does not send an old token after an account change', async () => {
  token.mockImplementationOnce(async () => {
    auth.currentUser = null;
    return 'old-token';
  });
  await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'reconnect' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([[400, 'FAILED_PRECONDITION', 'reconnect'], [401, 'UNAUTHENTICATED', 'reconnect'],
  [403, 'PERMISSION_DENIED', 'permission'], [503, 'UNAVAILABLE', 'unavailable']] as const)(
  'maps %s %s to a useful connection state', async (httpStatus, status, reason) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status } }), { status: httpStatus }));
    await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason });
  },
);

it('maps an in-progress WOW Class sidecar instead of a reconnect failure', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    error: { status: 'UNAVAILABLE', details: { code: 'lms-connecting' } },
  }), { status: 503 }));
  await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'connecting' });
});

it('keeps a real empty course list while rejecting malformed courses', async () => {
  fetchMock.mockImplementationOnce(async () => response({ courses: [] }));
  expect((await loadTronClassCourses('student-a')).courses).toEqual([]);
  for (const courses of [null, [{ id: '../account' }], [{ ...result().courses[0], name: '' }],
    [result().courses[0], result().courses[0]]]) {
    fetchMock.mockImplementationOnce(async () => response({ courses }));
    await expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  }
});

it('cancels a stalled request instead of leaving a permanent loading state', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(45_000);
  await pending;
});

it('expires a stalled token request without sending it after the deadline', async () => {
  vi.useFakeTimers();
  let resolveToken!: (value: string) => void;
  token.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
  const pending = expect(loadTronClassCourses('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(45_000);
  await pending;
  resolveToken('late-token');
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
