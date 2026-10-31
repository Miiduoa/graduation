import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicConnectionError, loadAcademicRecords } from './academicClient';

const auth = vi.hoisted(() => ({ currentUser: { uid: 'one', getIdToken: vi.fn(async () => 'token') } }));
vi.mock('./firebase', () => ({ getAuth: () => auth, isFirebaseConfigured: () => true, getCloudFunctionUrl: () => '/api/fn/getMyAcademicRecords' }));
vi.mock('./academicRecords', () => ({ normalizeCourseRecords: (value: unknown) => {
  if (!value || typeof value !== 'object') throw new Error('invalid records');
  return value;
}, normalizeGradeRecords: (value: unknown) => value }));
const fetcher = vi.fn();
const envelope = () => ({ result: { success: true, ownerUid: 'one', schoolId: 'pu', source: 'pu-campus', dataType: 'courses', fetchedAt: '2026-10-28T00:00:00Z', result: { courses: [] } } });
beforeEach(() => {
  fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  auth.currentUser = { uid: 'one', getIdToken: vi.fn(async () => 'token') };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([[401, 'reconnect'], [403, 'permission']] as const)('HTTP %s 的 HTML 拒絕不得變成可沿用舊資料', async (status, reason) => {
  fetcher.mockResolvedValue(new Response('<html>denied</html>', { status }));
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ reason, canRetainSnapshot: false });
});
it('暫時 503 HTML 故障允許標記前次資料，但不產生新快照', async () => {
  fetcher.mockResolvedValue(new Response('temporarily unavailable', { status: 503 }));
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ reason: 'unavailable', canRetainSnapshot: true });
});
it('成功 HTTP 的損壞 JSON 不沿用舊資料', async () => {
  fetcher.mockResolvedValue(new Response('<html>not records</html>'));
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ reason: 'unavailable', canRetainSnapshot: false });
});
it.each(['ownerUid', 'schoolId', 'source'] as const)('不符的 %s 不能授權沿用舊資料', async (field) => {
  const value = envelope(); value.result[field] = 'other';
  fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ canRetainSnapshot: false });
});
it('正規化失敗不能保留舊資料冒充最新結果', async () => {
  const value = { ...envelope(), result: { ...envelope().result, result: null } };
  fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ canRetainSnapshot: false });
});
it('取消會傳到實際 fetch，且晚到內容不能回傳快照', async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = loadAcademicRecords('courses', 'one', 'pu', { signal: controller.signal });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  controller.abort(); await expect(pending).rejects.toBeInstanceOf(AcademicConnectionError);
  expect(signal.aborted).toBe(true);
  finish(new Response(JSON.stringify(envelope()))); await Promise.resolve();
});
it('取得 token 期間取消不再發出 fetch', async () => {
  let finish!: (token: string) => void;
  auth.currentUser.getIdToken.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = loadAcademicRecords('courses', 'one', 'pu', { signal: controller.signal });
  await vi.waitFor(() => expect(auth.currentUser.getIdToken).toHaveBeenCalledTimes(1));
  controller.abort(); await expect(pending).rejects.toBeInstanceOf(AcademicConnectionError);
  finish('old-token'); await Promise.resolve(); await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
});
it('原本的三參數呼叫保留資料契約，不送出 signal 到伺服器', async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify(envelope())));
  await expect(loadAcademicRecords('courses', 'one', 'pu')).resolves.toMatchObject({ ownerUid: 'one' });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ data: { dataType: 'courses' } });
});
it('相同 uid 的登入實體更換仍拒絕先前讀取', async () => {
  fetcher.mockImplementation(async () => {
    auth.currentUser = { uid: 'one', getIdToken: vi.fn(async () => 'new-token') };
    return new Response(JSON.stringify(envelope()));
  });
  await expect(loadAcademicRecords('courses', 'one')).rejects.toMatchObject({ reason: 'reconnect', canRetainSnapshot: false });
});
