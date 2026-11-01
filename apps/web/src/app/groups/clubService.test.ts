import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { callClub, loadClubView } from './clubService';
const { user, auth } = vi.hoisted(() => {
  const user = { uid: 'one', getIdToken: vi.fn() };
  return { user, auth: { currentUser: user as typeof user | null } };
});
vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  getAuth: () => auth,
  getCloudFunctionUrl: () => 'https://example.invalid/clubAdmin',
}));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_CLUB_ADMIN_ENABLED = 'true';
  auth.currentUser = user;
  user.getIdToken.mockResolvedValue('synthetic-token');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_CLUB_ADMIN_ENABLED;
  vi.unstubAllGlobals();
});
test('預設關閉時不送出請求', async () => {
  delete process.env.NEXT_PUBLIC_CLUB_ADMIN_ENABLED;
  await expect(callClub('one', 'school', 'club')).rejects.toThrow('尚未啟用');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('以發起帳號的憑證送出目前學校與社團', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { success: true } }) });
  await callClub('one', 'school', 'club', { action: 'register', eventId: 'event' });
  const options = fetchMock.mock.calls[0][1];
  expect(JSON.parse(options.body)).toEqual({
    data: { action: 'register', eventId: 'event', schoolId: 'school', groupId: 'club' },
  });
  expect(options.headers.Authorization).toBe('Bearer synthetic-token');
});
test('取得憑證期間切換帳號不送出請求', async () => {
  user.getIdToken.mockImplementation(async () => {
    auth.currentUser = null;
    return 'synthetic-token';
  });
  await expect(callClub('one', 'school', 'club')).rejects.toThrow('帳號已變更');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('請求期間登出不回傳上一帳號資料', async () => {
  fetchMock.mockImplementation(async () => {
    auth.currentUser = null;
    return { ok: true, json: async () => ({ result: { success: true } }) };
  });
  await expect(callClub('one', 'school', 'club')).rejects.toThrow('帳號已變更');
});
test('沒有成功收據不宣稱操作完成', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { success: false } }) });
  await expect(callClub('one', 'school', 'club')).rejects.toThrow('尚未確認');
});

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
test.each(['missing callable', 'network failure'])('%s 時直接查詢仍提供名單', async (reason) => {
  fetchMock.mockRejectedValue(new Error(reason));
  vi.mocked(getDocFromServer).mockImplementation(
    async (ref) =>
      ({
        data: () =>
          String(ref).endsWith('/club')
            ? { type: 'club', schoolId: 'school' }
            : String(ref).includes('/directory/')
              ? { displayName: '原有社員' }
              : { status: 'active' },
      }) as never,
  );
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [{ id: 'two', data: () => ({ role: 'member', phone: 'private' }) }],
  } as never);
  expect(await loadClubView('one', 'school', 'club')).toEqual({
    success: true,
    rosterOnly: true,
    role: 'member',
    members: [{ id: 'public-0', name: '原有社員', role: 'member' }],
    events: [],
  });
});

test('callable 失敗期間切換帳號，不進行直接查詢', async () => {
  fetchMock.mockImplementation(async () => {
    auth.currentUser = null;
    throw new Error('network');
  });
  await expect(loadClubView('one', 'school', 'club')).rejects.toThrow('帳號已變更');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
test('後備直接查詢失去讀權時仍拒絕，不回傳舊名單', async () => {
  fetchMock.mockRejectedValue(new Error('missing callable'));
  vi.mocked(getDocFromServer).mockRejectedValue(new Error('permission-denied'));
  await expect(loadClubView('one', 'school', 'club')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
