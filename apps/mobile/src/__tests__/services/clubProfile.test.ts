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
test('只讀既有群組與公告，不讀取兩層活動或呼叫試辦服務', async () => {
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
});
