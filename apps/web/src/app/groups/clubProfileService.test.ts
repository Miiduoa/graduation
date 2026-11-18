import { callClubPortal } from './clubPortalService';
import { beforeEach, expect, test, vi } from 'vitest';
import { loadGroupDiscussionPage } from './groupDiscussionService';
import { loadClubProfile } from './clubProfileService';
vi.mock('./groupDiscussionService', () => ({ loadGroupDiscussionPage: vi.fn() }));
vi.mock('./clubPortalService', () => ({ callClubPortal: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(callClubPortal).mockResolvedValue({
    success: true,
    office: false,
    club: { instagram: '', line: '' },
    events: [],
  } as never);
});
beforeEach(() => {
  vi.mocked(loadGroupDiscussionPage).mockResolvedValue({
    group: {
      id: 'club',
      schoolId: 'pu',
      type: 'club',
      name: '攝影社',
      description: '',
      role: 'member',
      memberCount: null,
    },
    page: {
      posts: [
        { id: 'chat', kind: 'post', title: '聊天', body: '社員討論' },
        ...[1, 2, 3, 4].map((n) => ({
          id: String(n),
          kind: 'announcement',
          title: `公告${n}`,
          body: '社課資訊',
        })),
      ],
      hasMore: true,
      cursor: null,
    },
  } as never);
});
test('只使用成員原本可讀的社團及公告，不把一般貼文當公告', async () => {
  const result = await loadClubProfile('one', 'pu', 'club');
  expect(result.announcements.map((post) => post.title)).toEqual(['公告1', '公告2', '公告3']);
  expect(result.memberCount).toBeNull();
  expect(loadGroupDiscussionPage).toHaveBeenCalledWith('one', 'pu', 'club');
});
test('失去讀權不使用假資料或快取代替', async () => {
  vi.mocked(loadGroupDiscussionPage).mockRejectedValue(new Error('permission-denied'));
  await expect(loadClubProfile('one', 'pu', 'club')).rejects.toThrow('permission-denied');
});

test('可讀的課程群組也不能呈現為社團', async () => {
  vi.mocked(loadGroupDiscussionPage).mockResolvedValue({
    group: { type: 'course' },
    page: { posts: [] },
  } as never);
  await expect(loadClubProfile('one', 'pu', 'course')).rejects.toThrow('這不是社團');
});

test('社團頁保留群組讀取取得的已儲存介紹與社課時間', async () => {
  vi.mocked(loadGroupDiscussionPage).mockResolvedValue({
    group: { type: 'club', description: '新版介紹', meetingTime: '週三 18:00' },
    page: { posts: [] },
  } as never);
  expect(await loadClubProfile('one', 'pu', 'club')).toMatchObject({
    description: '新版介紹',
    meetingTime: '週三 18:00',
  });
});

test('從既有社團入口讀取官方連結與社內活動，僅保留顯示欄位', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({
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
  vi.mocked(callClubPortal).mockRejectedValueOnce(new Error('unavailable'));
  const result = await loadClubProfile('one', 'pu', 'club');
  expect(result.feed).toBeNull();
  expect(result.announcements.length).toBeGreaterThan(0);
});

test.each([{}, { club: { instagram: '', line: '' } }, { events: [] }])(
  '來源缺少活動投影時不當作零筆：%j',
  async (fields) => {
    vi.mocked(callClubPortal).mockResolvedValue({
      success: true,
      office: false,
      ...fields,
    } as never);
    expect((await loadClubProfile('one', 'pu', 'club')).feed).toBeNull();
  },
);

test.each([
  ['javascript:alert(1)', 'http://line.me/club'],
  ['https://instagram.com.evil.test/club', 'https://line.me.evil.test/club'],
  ['https://user:password@instagram.com/club', 'https://example.com/club'],
  ['', ''],
])('不呈現不安全或缺少的官方連結：%s / %s', async (instagram, line) => {
  vi.mocked(callClubPortal).mockResolvedValue({
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
