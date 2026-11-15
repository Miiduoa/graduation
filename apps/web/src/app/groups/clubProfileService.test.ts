import { beforeEach, expect, test, vi } from 'vitest';
import { loadGroupDiscussionPage } from './groupDiscussionService';
import { loadClubProfile } from './clubProfileService';
vi.mock('./groupDiscussionService', () => ({ loadGroupDiscussionPage: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
test('只使用成員原本可讀的社團及公告，不把一般貼文當公告', async () => {
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
