import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadTronClassLms } from './tronClassLms';

const { fetchMock, token, auth } = vi.hoisted(() => {
  const token = vi.fn(async () => 'id-token');
  return { fetchMock: vi.fn(), token,
    auth: { currentUser: { uid: 'student-a', getIdToken: token } as { uid: string; getIdToken: () => Promise<string> } | null } };
});
vi.mock('./firebase', () => ({ getAuth: () => auth, isFirebaseConfigured: () => true,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}` }));

function snapshot(change: Record<string, unknown> = {}) {
  return {
    success: true, ownerUid: 'student-a', schoolId: 'pu', source: 'pu-tronclass',
    fetchedAt: '2026-05-29T04:00:00.000Z', cache: { hit: false, expiresAt: '2026-05-29T04:10:00.000Z' },
    courses: [{ id: 10001, name: '資料庫系統' }], contentsLoadedFor: [],
    homework: [{
      id: 20001, courseId: 10001, courseName: '資料庫系統', title: '期末專題提案',
      deadline: '2026-05-29T15:59:00Z', deadlineLabel: '2026/5/29 下午11:59', submitted: false,
      description: '請上傳提案 PDF', href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
    }],
    announcements: [], materials: [], courseErrors: [],
    siteAnnouncementError: null, upcomingCoursesError: null, ...change,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  auth.currentUser = { uid: 'student-a', getIdToken: token };
  token.mockResolvedValue('id-token');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ result: snapshot() }), { status: 200 }));
});
afterEach(() => { vi.unstubAllGlobals(); });

it('reads the hosted LMS snapshot and keeps official homework links', async () => {
  const result = await loadTronClassLms('student-a');
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyTronClassLms', expect.objectContaining({
    body: JSON.stringify({ data: {} }), cache: 'no-store',
  }));
  expect(result.homework[0].href).toBe('https://tronclass.pu.edu.tw/course/10001/content#/activity/20001');
});

it('sends refresh when the user asks to bypass cache', async () => {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ result: snapshot({ cache: { hit: false, expiresAt: '2026-05-29T04:10:00.000Z' } }) }), { status: 200 }));
  await loadTronClassLms('student-a', { refresh: true });
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyTronClassLms', expect.objectContaining({
    body: JSON.stringify({ data: { refresh: true } }),
  }));
});

it('asks for one course contents only when opening that course', async () => {
  await loadTronClassLms('student-a', { courseId: 10001 });
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/getMyTronClassLms', expect.objectContaining({
    body: JSON.stringify({ data: { courseId: 10001 } }),
  }));
});

it('maps reconnect failures without showing another account snapshot', async () => {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
    error: { status: 'FAILED_PRECONDITION', message: 'WOW Class 尚未連線或登入已到期，請重新連線學校帳號。' },
  }), { status: 400 }));
  await expect(loadTronClassLms('student-a')).rejects.toMatchObject({ reason: 'reconnect' });
});

it('rejects a download link on a file the school marked as not downloadable', async () => {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
    result: snapshot({
      materials: [{
        id: 1, courseId: 10001, courseName: '資料庫系統', title: '講義', type: 'material',
        href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/1',
        files: [{ name: 'secret.pdf', allowDownload: false, downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/x/blob' }],
      }],
    }),
  }), { status: 200 }));
  await expect(loadTronClassLms('student-a')).rejects.toMatchObject({ reason: 'unavailable' });
});
