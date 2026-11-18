import { callClubPortal } from '../../services/clubPortal';
jest.mock('../../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
import { loadClubProfile } from '../../services/clubProfile';
const mockUser = { uid: 'one' };
let mockCurrentUser: typeof mockUser | null = mockUser;
const mockDoc = jest.fn();
const mockDocs = jest.fn();
jest.mock('../../firebase', () => ({
  getDb: () => ({}),
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
}));
jest.mock('firebase/firestore', () => ({
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (path: string) => path,
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocFromServer: (...args: unknown[]) => mockDoc(...args),
  getDocsFromServer: (...args: unknown[]) => mockDocs(...args),
}));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(callClubPortal).mockResolvedValue({
    success: true,
    office: false,
    club: { instagram: '', line: '' },
    events: [],
  } as never);
  mockCurrentUser = mockUser;
  mockDoc.mockImplementation(async (path: string) => ({
    data: () =>
      path.endsWith('/members/one')
        ? { status: 'active', role: 'member' }
        : { type: 'club', schoolId: 'pu', name: '攝影社' },
  }));
  mockDocs.mockResolvedValue({
    docs: [
      { id: 'post', data: () => ({ kind: 'post', title: '一般討論' }) },
      { id: 'news', data: () => ({ kind: 'announcement', title: '社課通知', body: '帶相機' }) },
    ],
  });
});
test('沿用既有群組與公告，活動僅透過社團入口讀取', async () => {
  const result = await loadClubProfile('one', 'pu', 'club');
  expect(result.announcements).toEqual([{ id: 'news', title: '社課通知', body: '帶相機' }]);
  expect(result.memberCount).toBeNull();
  expect(mockDocs).toHaveBeenCalledWith('groups/club/posts');
  expect(mockDoc.mock.calls.map((call) => call[0])).toEqual([
    'groups/club',
    'groups/club/members/one',
  ]);
});
test('會籍失效不讀取公告', async () => {
  mockDoc.mockResolvedValue({ data: () => ({ status: 'left' }) });
  await expect(loadClubProfile('one', 'pu', 'club')).rejects.toThrow('無法確認社團資格');
  expect(mockDocs).not.toHaveBeenCalled();
  expect(callClubPortal).not.toHaveBeenCalled();
});
test('查詢途中切換帳號，不回傳舊社團內容', async () => {
  mockDocs.mockImplementation(async () => {
    mockCurrentUser = null;
    return { docs: [] };
  });
  await expect(loadClubProfile('one', 'pu', 'club')).rejects.toThrow('帳號已變更');
});

test.each([
  ['其他學校的社團', { type: 'club', schoolId: 'other' }],
  ['課程群組', { type: 'course', schoolId: 'pu' }],
  ['不存在的社團', undefined],
])('%s 不讀取公告，即使會籍仍有效', async (_label, group) => {
  mockDoc.mockImplementation(async (path: string) => ({
    data: () => (path.endsWith('/members/one') ? { status: 'active', role: 'member' } : group),
  }));
  await expect(loadClubProfile('one', 'pu', 'club')).rejects.toThrow('無法確認社團資格');
  expect(mockDocs).not.toHaveBeenCalled();
  expect(callClubPortal).not.toHaveBeenCalled();
});

test.each([
  [{ meetingTime: ' 週三 18:00 ' }, '週三 18:00'],
  [{ meetingTime: '  ' }, ''],
  [{ meetingTime: {} }, ''],
  [undefined, ''],
])('沿用群組讀取取得管理頁儲存的介紹與社課時間：%j', async (clubProfile, meetingTime) => {
  mockDoc.mockImplementation(async (path: string) => ({
    data: () =>
      path.endsWith('/members/one')
        ? { status: 'active', role: 'member' }
        : { type: 'club', schoolId: 'pu', description: '新版介紹', clubProfile },
  }));
  expect(await loadClubProfile('one', 'pu', 'club')).toMatchObject({
    description: '新版介紹',
    meetingTime,
  });
  expect(mockDoc).toHaveBeenCalledTimes(2);
});

test('從既有社團入口讀取官方連結與社內活動，僅保留顯示欄位', async () => {
  jest.mocked(callClubPortal).mockResolvedValue({
    success: true,
    office: false,
    club: { instagram: 'https://www.instagram.com/photo_club', line: 'https://line.me/R/club' },
    events: [
      {
        id: 'event',
        title: '夜間攝影',
        startsAt: 1795000000000,
        endsAt: 1795007200000,
        location: '社團教室',
        registrations: [{ uid: 'private' }],
      },
    ],
  } as never);
  const result = await loadClubProfile('one', 'pu', 'club');
  expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', { action: 'read', groupId: 'club' });
  expect(result.feed).toEqual({
    instagram: 'https://www.instagram.com/photo_club',
    line: 'https://line.me/R/club',
    events: [
      {
        id: 'event',
        title: '夜間攝影',
        startsAt: 1795000000000,
        endsAt: 1795007200000,
        location: '社團教室',
      },
    ],
  });
});

test('活動讀取成功且零筆與服務失敗分開，不影響原有公告', async () => {
  expect((await loadClubProfile('one', 'pu', 'club')).feed).toEqual({
    instagram: '',
    line: '',
    events: [],
  });
  jest.mocked(callClubPortal).mockRejectedValueOnce(new Error('unavailable'));
  const result = await loadClubProfile('one', 'pu', 'club');
  expect(result.feed).toBeNull();
  expect(result.announcements.length).toBeGreaterThan(0);
});

test.each([{}, { club: { instagram: '', line: '' } }, { events: [] }])(
  '來源缺少活動投影時不當作零筆：%j',
  async (fields) => {
    jest
      .mocked(callClubPortal)
      .mockResolvedValue({ success: true, office: false, ...fields } as never);
    expect((await loadClubProfile('one', 'pu', 'club')).feed).toBeNull();
  },
);

test.each([
  ['javascript:alert(1)', 'http://line.me/club'],
  ['https://instagram.com.evil.test/club', 'https://line.me.evil.test/club'],
  ['https://user:password@instagram.com/club', 'https://example.com/club'],
  ['', ''],
])('不呈現不安全或缺少的官方連結：%s / %s', async (instagram, line) => {
  jest.mocked(callClubPortal).mockResolvedValue({
    success: true,
    office: false,
    club: { instagram, line },
    events: [],
  } as never);
  expect((await loadClubProfile('one', 'pu', 'club')).feed).toEqual({
    instagram: '',
    line: '',
    events: [],
  });
});

test('入口讀取期間切換帳號不回傳舊社團，即使入口失敗', async () => {
  jest.mocked(callClubPortal).mockImplementationOnce(async () => {
    mockCurrentUser = null;
    throw new Error('帳號已變更');
  });
  await expect(loadClubProfile('one', 'pu', 'club')).rejects.toThrow('帳號已變更');
});
