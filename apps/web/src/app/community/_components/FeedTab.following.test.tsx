import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  loadBookmarks: vi.fn(),
  saveBookmark: vi.fn(),
  toggleLike: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/community/firestore', () => ({
  fetchRecentCampusPosts: mocks.fetchPosts,
  rankFeedPosts: (rows: unknown[]) => rows,
  toggleCampusPostLike: mocks.toggleLike,
  listBoards: mocks.fetchBoards,
  listSubscribedBoardIds: mocks.fetchSubscriptions,
  listActiveStoriesForSchool: mocks.fetchStories,
  groupStoriesByAuthor: () => [],
  fetchSchoolDirectoryProfiles: mocks.fetchProfiles,
}));
vi.mock('@/lib/community/bookmarks', () => ({
  BOOKMARK_UNAVAILABLE_COPY: '收藏功能暫時無法使用',
  listCampusPostBookmarkIds: mocks.listBookmarks,
  loadCampusPostBookmarks: mocks.loadBookmarks,
  saveCampusPostBookmark: mocks.saveBookmark,
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
  vi.resetAllMocks();
  mocks.auth.user = { uid: 'alice' };
  mocks.auth.loading = false;
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
  mocks.loadBookmarks.mockResolvedValue({ ids: [], posts: [] });
  mocks.saveBookmark.mockResolvedValue(undefined);
  mocks.toggleLike.mockResolvedValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function postCard(title: string) {
  const article = screen.getByText(title).closest('article');
  if (!article) throw new Error('Post card is missing');
  return within(article);
}

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
  await waitFor(() => expect(screen.queryByText('無法讀取追蹤清單，請確認網路及校籍後重試。')).toBeNull());
  expect(screen.getByText('小明的貼文')).toBeTruthy();
  expect(screen.queryByText('小華的貼文')).toBeNull();
});

it('explains unavailable author follow controls in the all-posts view and restores them on retry', async () => {
  mocks.listFollowing.mockRejectedValueOnce(new Error('permission-denied'));
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  await screen.findByText('無法讀取追蹤清單，請確認網路及校籍後重試。');
  expect(screen.queryByRole('button', { name: '取消追蹤 Bob' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取追蹤' }));
  await screen.findByRole('button', { name: '取消追蹤 Bob' });
  expect(screen.queryByText('無法讀取追蹤清單，請確認網路及校籍後重試。')).toBeNull();
});

it('refreshes following relations changed on another device before showing the updated feed', async () => {
  mocks.listFollowing.mockResolvedValueOnce(['bob']).mockResolvedValue(['carol']);
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(screen.getByRole('button', { name: '追蹤' }));
  expect(screen.queryByText('小華的貼文')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByText('小華的貼文');
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(mocks.listFollowing).toHaveBeenCalledTimes(2);
});

it('does not claim a saved-post count while a loaded collection is refreshing or denied', async () => {
  const initial = deferred<{ ids: string[]; posts: typeof bob[] }>();
  const reload = deferred<{ ids: string[]; posts: typeof bob[] }>();
  mocks.loadBookmarks
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(reload.promise);
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(screen.getByText('正在讀取收藏…')).toBeTruthy();
  expect(screen.queryByText(/^顯示 .*私人收藏/)).toBeNull();
  await act(async () => initial.resolve({ ids: [bob.id], posts: [bob] }));
  await screen.findByText('顯示 1 則 · 本校最近最多 40 筆私人收藏，跨裝置同步');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByText('正在讀取收藏…');
  expect(screen.queryByText(/^顯示 .*私人收藏/)).toBeNull();
  await act(async () => reload.reject(Object.assign(new Error('revoked'), { code: 'permission-denied' })));
  expect(screen.queryByText('暫時無法讀取收藏，請確認連線與校籍後重試。')).toBeNull();
  expect(screen.queryByText(/^顯示 .*私人收藏/)).toBeNull();
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(screen.queryByText('還沒有收藏貼文')).toBeNull();
  await screen.findByText('收藏功能暫時無法使用');
});

it('disables bookmark controls when a permission-denied read means the feature is unavailable', async () => {
  mocks.listBookmarks.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  await screen.findByText('收藏功能暫時無法使用');
  expect(screen.queryByText('暫時無法讀取收藏，請確認連線與校籍後重試。')).toBeNull();
  expect(screen.queryByText('收藏未更新，請確認連線及校籍後重試。')).toBeNull();
  const bookmark = postCard('小明的貼文').getByRole('button', { name: '收藏功能暫時無法使用' });
  expect((bookmark as HTMLButtonElement).disabled).toBe(true);
  expect(bookmark.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(bookmark);
  expect(mocks.saveBookmark).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables bookmark controls after a permission-denied save instead of offering a retry', async () => {
  mocks.saveBookmark.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(postCard('小明的貼文').getByRole('button', { name: '收藏貼文' }));
  await waitFor(() => expect(mocks.saveBookmark).toHaveBeenCalledWith('alice', 'pu', 'p-bob'));
  await screen.findByText('收藏功能暫時無法使用');
  expect(screen.queryByText('收藏未更新，請確認連線及校籍後重試。')).toBeNull();
  const bookmark = postCard('小明的貼文').getByRole('button', { name: '收藏功能暫時無法使用' });
  expect((bookmark as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(bookmark);
  expect(mocks.saveBookmark).toHaveBeenCalledTimes(1);
});

it('keeps bookmark writes retryable after a network failure', async () => {
  mocks.saveBookmark
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(undefined);
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(postCard('小明的貼文').getByRole('button', { name: '收藏貼文' }));
  await screen.findByText('收藏未更新，請確認連線及校籍後重試。');
  expect(screen.queryByText('收藏功能暫時無法使用')).toBeNull();
  const bookmark = postCard('小明的貼文').getByRole('button', { name: '收藏貼文' });
  expect((bookmark as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(bookmark);
  await waitFor(() => expect(mocks.saveBookmark).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText('收藏未更新，請確認連線及校籍後重試。')).toBeNull());
  expect(screen.queryByText('收藏功能暫時無法使用')).toBeNull();
  expect((postCard('小明的貼文').getByRole('button', { name: /收藏貼文|取消收藏貼文/ }) as HTMLButtonElement).disabled).toBe(false);
});

it('does not claim a followed-post count while previously loaded relations are refreshing or denied', async () => {
  const reload = deferred<string[]>();
  mocks.listFollowing.mockResolvedValueOnce(['bob']).mockReturnValueOnce(reload.promise);
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(screen.getByRole('button', { name: '追蹤' }));
  await screen.findByText('顯示 1 則 · 目前載入 3 則貼文中追蹤的作者');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByText('正在讀取追蹤動態…');
  expect(screen.queryByText(/^顯示 .*追蹤的作者/)).toBeNull();
  await act(async () => reload.reject(Object.assign(new Error('revoked'), { code: 'permission-denied' })));
  await screen.findByText('無法讀取追蹤清單，請確認網路及校籍後重試。');
  expect(screen.queryByText(/^顯示 .*追蹤的作者/)).toBeNull();
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(screen.queryByText('追蹤的作者尚無新貼文')).toBeNull();
});

it('does not replace the new account feed with an earlier account read', async () => {
  const oldRead = deferred<typeof bob[]>();
  mocks.fetchPosts.mockReturnValueOnce(oldRead.promise);
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await waitFor(() => expect(mocks.fetchPosts).toHaveBeenCalledTimes(1));
  mocks.auth.user = { uid: 'dana' };
  mocks.fetchPosts.mockResolvedValue([{ ...carol, title: '新帳號的動態' }]);
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('新帳號的動態');
  await act(async () => oldRead.resolve([bob]));
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(screen.getByText('新帳號的動態')).toBeTruthy();
});

it('clears the previous account content and search while identity is being resolved', async () => {
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小明' } });
  mocks.auth.loading = true;
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
  mocks.auth.loading = false;
  mocks.auth.user = { uid: 'dana' };
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小華的貼文');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('does not restore an old school author profile after changing schools', async () => {
  const oldProfile = deferred<Array<{ uid: string; displayName: string }>>();
  mocks.fetchProfiles.mockReturnValueOnce(oldProfile.promise);
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await waitFor(() => expect(mocks.fetchProfiles).toHaveBeenCalledTimes(1));
  mocks.fetchPosts.mockResolvedValue([{ ...bob, schoolId: 'other', title: '另一校的動態' }]);
  mocks.fetchProfiles.mockResolvedValue([{ uid: 'bob', displayName: '新校公開名稱' }]);
  view.rerender(<FeedTab schoolId="other" schoolSearch="?schoolId=other" />);
  await screen.findByText('新校公開名稱');
  await act(async () => oldProfile.resolve([{ uid: 'bob', displayName: '舊校公開名稱' }]));
  expect(screen.queryByText('舊校公開名稱')).toBeNull();
  expect(screen.getByText('新校公開名稱')).toBeTruthy();
});

it('keeps the new account bookmark state when an old bookmark write finishes', async () => {
  const oldSave = deferred<void>();
  mocks.saveBookmark.mockReturnValueOnce(oldSave.promise);
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(postCard('小明的貼文').getByRole('button', { name: '收藏貼文' }));
  await waitFor(() => expect(mocks.saveBookmark).toHaveBeenCalledWith('alice', 'pu', 'p-bob'));
  mocks.auth.user = { uid: 'dana' };
  mocks.listBookmarks.mockResolvedValue(['p-bob']);
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await waitFor(() => expect(postCard('小明的貼文').getByRole('button', { name: '取消收藏貼文' })).toBeTruthy());
  await act(async () => oldSave.resolve());
  expect(postCard('小明的貼文').getByRole('button', { name: '取消收藏貼文' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.listBookmarks).toHaveBeenCalledTimes(2);
});

it('does not roll back the new account reaction when an old write fails', async () => {
  const oldLike = deferred<void>();
  mocks.fetchPosts.mockResolvedValue([{ ...bob, likes: 0, likedBy: [] }]);
  mocks.toggleLike.mockReturnValueOnce(oldLike.promise);
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('小明的貼文');
  fireEvent.click(postCard('小明的貼文').getByRole('button', { name: '按讚' }));
  await waitFor(() => expect(mocks.toggleLike).toHaveBeenCalledWith('pu', 'p-bob', 'alice'));
  mocks.auth.user = { uid: 'dana' };
  mocks.fetchPosts.mockResolvedValue([{ ...bob, likes: 1, likedBy: ['dana'] }]);
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await waitFor(() => expect(postCard('小明的貼文').getByRole('button', { name: '取消按讚' })).toBeTruthy());
  await act(async () => oldLike.reject(new Error('permission-denied')));
  expect(postCard('小明的貼文').getByRole('button', { name: '取消按讚' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('讚沒有成功更新，請確認網路後再試。')).toBeNull();
});

it('allows the new account to follow an author while the old account write is pending', async () => {
  const oldFollow = deferred<void>();
  mocks.listFollowing.mockResolvedValue([]);
  mocks.follow.mockReturnValueOnce(oldFollow.promise);
  const view = render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '追蹤 Bob' }));
  await waitFor(() => expect(mocks.follow).toHaveBeenCalledWith('pu', 'alice', 'bob'));
  mocks.auth.user = { uid: 'dana' };
  view.rerender(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await waitFor(() => expect((screen.getByRole('button', { name: '追蹤 Bob' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '追蹤 Bob' }));
  await waitFor(() => expect(mocks.follow).toHaveBeenCalledWith('pu', 'dana', 'bob'));
  await act(async () => oldFollow.reject(new Error('permission-denied')));
  expect(screen.queryByText('追蹤狀態未更新，請確認網路和對方校籍後重試。')).toBeNull();
});
