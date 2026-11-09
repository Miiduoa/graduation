import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreatorProfile } from './CreatorProfile';

const mocks = vi.hoisted(() => ({
  user: { uid: 'alice', displayName: 'Alice' } as { uid: string; displayName: string } | null,
  loading: false,
  identity: vi.fn(),
  posts: vi.fn(),
  bookmarks: vi.fn(),
  following: vi.fn(),
  follow: vi.fn(),
  unfollow: vi.fn(),
  pinRead: vi.fn(),
  pinSave: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.loading }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    'aria-label'?: string;
  }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/community/creatorProfile', () => ({
  readCreatorIdentity: mocks.identity,
  listCreatorPosts: mocks.posts,
}));
vi.mock('@/lib/community/creatorPin', () => ({
  readCreatorPin: mocks.pinRead,
  saveCreatorPin: mocks.pinSave,
}));
vi.mock('@/lib/community/creatorCard', () => ({
  readCreatorCard: vi.fn(async () => null),
  saveCreatorCard: vi.fn(),
}));
vi.mock('@/lib/community/bookmarks', () => ({
  loadCampusPostBookmarks: mocks.bookmarks,
}));
vi.mock('@/lib/community/follows', () => ({
  listFollowingIds: mocks.following,
  followUser: mocks.follow,
  unfollowUser: mocks.unfollow,
}));

const school = { schoolId: 'pu', schoolName: '靜宜大學' };
const myPost = {
  id: 'post-alice',
  schoolId: 'pu',
  authorUid: 'alice',
  anonymous: false,
  title: '週末校園散步',
  content: '拍了幾張照片',
  likes: 3,
  commentCount: 2,
  mediaUrls: ['https://example.test/photo.jpg'],
  createdAt: new Date('2026-11-08T12:00:00Z'),
};
const theirPost = { ...myPost, id: 'post-bob', authorUid: 'bob', title: '社團分享' };
const page = (rows: typeof myPost[], hasMore = false) =>
  ({ posts: rows, cursor: hasMore ? { id: rows[rows.length - 1]?.id } : null, hasMore });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: 'alice', displayName: 'Alice' };
  mocks.loading = false;
  mocks.identity.mockResolvedValue({ displayName: 'Alice', avatarUrl: null });
  mocks.posts.mockResolvedValue(page([myPost]));
  mocks.bookmarks.mockResolvedValue({ ids: [], posts: [] });
  mocks.following.mockResolvedValue([]);
  mocks.follow.mockResolvedValue(undefined);
  mocks.unfollow.mockResolvedValue(undefined);
  mocks.pinRead.mockResolvedValue({ postId: null, post: null });
  mocks.pinSave.mockResolvedValue({ postId: null, post: null });
});

it('lets the owner publish and browse their public posts, media and private saved posts', async () => {
  mocks.bookmarks.mockResolvedValue({
    ids: ['saved'],
    posts: [{ ...myPost, id: 'saved', title: '我的私人收藏' }],
  });
  render(<CreatorProfile {...school} memberUid="alice" />);
  expect(await screen.findByText('週末校園散步')).toBeTruthy();
  expect(screen.getByText('已載入 1 則公開貼文')).toBeTruthy();
  expect(screen.getByRole('link', { name: '發表貼文' }).getAttribute('href')).toBe(
    '/community/post/new?schoolId=pu',
  );
  expect(screen.getByRole('link', { name: '發布限動' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '相片與影片' }));
  expect(screen.getByRole('link', { name: '觀看 週末校園散步 的第 1 則媒體' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '我的收藏' }));
  await screen.findByText('我的私人收藏');
  expect(mocks.bookmarks).toHaveBeenCalledWith('alice', 'pu', 40);
  expect(screen.getByText(/私人收藏 · 最多顯示最近 40 筆/)).toBeTruthy();
});

it('keeps private collections and account fields off another member profile', async () => {
  mocks.identity.mockResolvedValue({
    displayName: 'Bob',
    avatarUrl: 'https://example.test/bob.png',
    studentId: 'must-not-render',
  });
  mocks.posts.mockResolvedValue(page([theirPost]));
  render(<CreatorProfile {...school} memberUid="bob" />);
  await screen.findByText('社團分享');
  expect(screen.getByRole('heading', { name: 'Bob' })).toBeTruthy();
  expect(screen.queryByText('must-not-render')).toBeNull();
  expect(screen.queryByRole('tab', { name: '我的收藏' })).toBeNull();
  expect(screen.queryByRole('link', { name: '帳號設定' })).toBeNull();
  expect(mocks.bookmarks).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: '追蹤' })).toBeTruthy();
});

it('follows and unfollows with school-scoped persistence, including denied reads', async () => {
  mocks.identity.mockResolvedValue({ displayName: 'Bob', avatarUrl: null });
  mocks.posts.mockResolvedValue(page([theirPost]));
  render(<CreatorProfile {...school} memberUid="bob" />);
  fireEvent.click(await screen.findByRole('button', { name: '追蹤' }));
  await waitFor(() => expect(mocks.follow).toHaveBeenCalledWith('pu', 'alice', 'bob'));
  fireEvent.click(await screen.findByRole('button', { name: '追蹤中' }));
  await waitFor(() => expect(mocks.unfollow).toHaveBeenCalledWith('pu', 'alice', 'bob'));
});

it('does not show a false unfollowed state after a permissions failure', async () => {
  mocks.identity.mockResolvedValue({ displayName: 'Bob', avatarUrl: null });
  mocks.following.mockRejectedValueOnce(new Error('permission-denied'));
  render(<CreatorProfile {...school} memberUid="bob" />);
  expect(await screen.findByRole('button', { name: '重新確認追蹤' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '追蹤' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認追蹤' }));
  await screen.findByRole('button', { name: '追蹤' });
  expect(mocks.following).toHaveBeenCalledTimes(2);
});

it('shows retryable failures instead of pretending denied posts are empty', async () => {
  mocks.posts.mockRejectedValueOnce(new Error('permission-denied'));
  render(<CreatorProfile {...school} memberUid="alice" />);
  await screen.findByText(/公開貼文暫時無法讀取/);
  expect(screen.queryByText('你還沒有用公開身分發表貼文。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('週末校園散步');
});

it('preserves loaded content when loading more fails', async () => {
  mocks.posts.mockResolvedValueOnce(page([myPost], true));
  mocks.posts.mockRejectedValueOnce(new Error('offline'));
  render(<CreatorProfile {...school} memberUid="alice" />);
  await screen.findByText('週末校園散步');
  fireEvent.click(screen.getByRole('button', { name: '載入更多貼文' }));
  await screen.findByText(/更多貼文暫時無法讀取/);
  expect(screen.getByText('週末校園散步')).toBeTruthy();
  expect(screen.getByRole('button', { name: '載入更多貼文' })).toBeTruthy();
});

it('discards a late response after switching campuses', async () => {
  let finishOld!: (result: ReturnType<typeof page>) => void;
  mocks.posts.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  mocks.posts.mockResolvedValueOnce(page([{ ...myPost, id: 'new', schoolId: 'nt', title: '另一所學校的貼文' }]));
  const view = render(<CreatorProfile {...school} memberUid="alice" />);
  view.rerender(<CreatorProfile schoolId="nt" schoolName="臺灣大學" memberUid="alice" />);
  await screen.findByText('另一所學校的貼文');
  await act(async () => finishOld(page([myPost])));
  expect(screen.queryByText('週末校園散步')).toBeNull();
  expect(screen.getByText('另一所學校的貼文')).toBeTruthy();
});

it('does not read personal or school data while auth is unresolved', () => {
  mocks.loading = true;
  render(<CreatorProfile {...school} memberUid="alice" />);
  expect(screen.getByRole('status').textContent).toBe('正在確認登入狀態…');
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.posts).not.toHaveBeenCalled();
});
