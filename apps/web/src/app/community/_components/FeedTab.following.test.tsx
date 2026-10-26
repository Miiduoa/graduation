import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FeedTab } from './FeedTab';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' }, loading: false },
  fetchPosts: vi.fn(),
  fetchBoards: vi.fn(),
  fetchSubscriptions: vi.fn(),
  fetchStories: vi.fn(),
  fetchProfiles: vi.fn(),
  listFollowing: vi.fn(),
  follow: vi.fn(),
  unfollow: vi.fn(),
  listBookmarks: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/community/firestore', () => ({
  fetchRecentCampusPosts: mocks.fetchPosts,
  rankFeedPosts: (rows: unknown[]) => rows,
  toggleCampusPostLike: vi.fn(),
  listBoards: mocks.fetchBoards,
  listSubscribedBoardIds: mocks.fetchSubscriptions,
  listActiveStoriesForSchool: mocks.fetchStories,
  groupStoriesByAuthor: () => [],
  fetchSchoolDirectoryProfiles: mocks.fetchProfiles,
}));
vi.mock('@/lib/community/bookmarks', () => ({
  listCampusPostBookmarkIds: mocks.listBookmarks,
  loadCampusPostBookmarks: vi.fn(),
  saveCampusPostBookmark: vi.fn(),
  removeCampusPostBookmark: vi.fn(),
}));
vi.mock('@/lib/community/follows', () => ({
  listFollowingIds: mocks.listFollowing,
  followUser: mocks.follow,
  unfollowUser: mocks.unfollow,
}));

const bob = {
  id: 'p-bob', schoolId: 'pu', boardId: 'board', anonymous: false,
  authorUid: 'bob', title: '小明的貼文', content: '一起讀書',
};
const carol = {
  id: 'p-carol', schoolId: 'pu', boardId: 'board', anonymous: false,
  authorUid: 'carol', title: '小華的貼文', content: '社團活動',
};
const anonymous = {
  id: 'p-anon', schoolId: 'pu', boardId: 'board', anonymous: true,
  authorUid: 'bob', aliasSnapshot: '匿名使用者',
  title: '匿名提問', content: '只有公開內容',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchPosts.mockResolvedValue([bob, carol, anonymous]);
  mocks.fetchBoards.mockResolvedValue([{ id: 'board', name: '自由討論', schoolId: 'pu' }]);
  mocks.fetchSubscriptions.mockResolvedValue([]);
  mocks.fetchStories.mockResolvedValue([]);
  mocks.fetchProfiles.mockResolvedValue([
    { uid: 'bob', displayName: 'Bob' },
    { uid: 'carol', displayName: 'Carol' },
  ]);
  mocks.listFollowing.mockResolvedValue(['bob']);
  mocks.follow.mockResolvedValue(undefined);
  mocks.unfollow.mockResolvedValue(undefined);
  mocks.listBookmarks.mockResolvedValue([]);
});

it('shows followed authors without exposing an anonymous post by the same author', async () => {
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  await waitFor(() => expect(mocks.listFollowing).toHaveBeenCalledWith('pu', 'alice'));
  fireEvent.click(screen.getByRole('button', { name: '追蹤' }));
  expect(screen.getByText('小明的貼文')).toBeTruthy();
  expect(screen.queryByText('小華的貼文')).toBeNull();
  expect(screen.queryByText('匿名提問')).toBeNull();
});

it('a follow write is confirmed and can be unfollowed with the current account', async () => {
  mocks.listFollowing
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(['bob'])
    .mockResolvedValue(['bob']);
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const button = await screen.findByRole('button', { name: '追蹤 Bob' });
  fireEvent.click(button);
  await waitFor(() => expect(mocks.follow).toHaveBeenCalledWith('pu', 'alice', 'bob'));
  const followed = await screen.findByRole('button', { name: '取消追蹤 Bob' });
  fireEvent.click(followed);
  await waitFor(() => expect(mocks.unfollow).toHaveBeenCalledWith('pu', 'alice', 'bob'));
});

it('shows a retryable error rather than pretending a denied following query is empty', async () => {
  mocks.listFollowing.mockRejectedValueOnce(new Error('permission-denied'));
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(screen.getByRole('button', { name: '追蹤' }));
  await screen.findByText('無法讀取追蹤清單，請確認網路及校籍後重試。');
  expect(screen.queryByText('追蹤的作者尚無新貼文')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取追蹤' }));
  await waitFor(() => expect(mocks.listFollowing).toHaveBeenCalledTimes(2));
});
