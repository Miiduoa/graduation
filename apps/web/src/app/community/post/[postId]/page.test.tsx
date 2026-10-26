import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import PostDetailPage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null },
  postId: 'p-1',
  getPost: vi.fn(),
  listReplies: vi.fn(),
  profiles: vi.fn(),
  isBookmarked: vi.fn(),
  saveBookmark: vi.fn(),
  removeBookmark: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({
    schoolId: 'pu',
    schoolName: '靜宜大學',
    ready: true,
  }),
}));
vi.mock('../../_components/CommunityAccess', () => ({
  CommunityAccess: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({ SchoolScopePlaceholder: () => null }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ postId: mocks.postId }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/community/firestore', () => ({
  getCampusPostById: mocks.getPost,
  listCampusReplies: mocks.listReplies,
  fetchSchoolDirectoryProfiles: mocks.profiles,
  flattenCampusRepliesThread: (rows: unknown[]) => rows,
  addCampusReply: vi.fn(),
  deleteCampusPost: vi.fn(),
  getOrCreateBoardAlias: vi.fn(),
  softDeleteCampusReply: vi.fn(),
  submitCampusReport: vi.fn(),
  toggleCampusPostLike: vi.fn(),
  updateCampusPost: vi.fn(),
}));
vi.mock('@/lib/community/bookmarks', () => ({
  isCampusPostBookmarked: mocks.isBookmarked,
  saveCampusPostBookmark: mocks.saveBookmark,
  removeCampusPostBookmark: mocks.removeBookmark,
}));

beforeEach(() => {
  mocks.auth.user = { uid: 'alice' };
  mocks.postId = 'p-1';
  mocks.getPost.mockReset().mockResolvedValue({
    id: 'p-1',
    schoolId: 'pu',
    boardId: 'board',
    anonymous: false,
    authorUid: 'bob',
    title: '小明的貼文',
    content: '一起讀書',
    likes: 0,
    likedBy: [],
    commentCount: 0,
    tags: [],
  });
  mocks.listReplies.mockReset().mockResolvedValue([]);
  mocks.profiles.mockReset().mockResolvedValue([{ uid: 'bob', displayName: 'Bob' }]);
  mocks.isBookmarked.mockReset().mockResolvedValue(false);
  mocks.saveBookmark.mockReset().mockResolvedValue(undefined);
  mocks.removeBookmark.mockReset().mockResolvedValue(undefined);
});

it('does not show a red bookmark error when reading status is permission-denied', async () => {
  mocks.isBookmarked.mockRejectedValueOnce(
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
  );
  render(<PostDetailPage />);
  expect(await screen.findByRole('button', { name: '收藏貼文' })).toBeTruthy();
  expect(screen.queryByText('無法讀取收藏狀態，請確認校籍與連線。')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('prompts only after the user fails to save a bookmark', async () => {
  mocks.isBookmarked.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  mocks.saveBookmark.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<PostDetailPage />);
  const bookmark = await screen.findByRole('button', { name: '收藏貼文' });
  expect(screen.queryByText('這次收藏未成功更新，請確認校籍與連線後重試。')).toBeNull();
  await act(async () => {
    fireEvent.click(bookmark);
  });
  await screen.findByText('這次收藏未成功更新，請確認校籍與連線後重試。');
  expect(mocks.saveBookmark).toHaveBeenCalledWith('alice', 'pu', 'p-1');
});

it('still explains a non-permission bookmark read failure', async () => {
  mocks.isBookmarked.mockRejectedValueOnce(new Error('unavailable'));
  render(<PostDetailPage />);
  await screen.findByText('無法讀取收藏狀態，請確認校籍與連線。');
  await waitFor(() => expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(true));
});
