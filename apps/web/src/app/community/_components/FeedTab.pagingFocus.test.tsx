import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FeedTab } from './FeedTab';

// Browser-to-emulator regression covers native disabled-button blur; these tests
// separately protect the request guard and both completion/error focus contracts.
const mocks = vi.hoisted(() => ({ page: vi.fn(), auth: { user: { uid: 'alice' }, loading: false } }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a> }));
vi.mock('@/lib/community/feedPages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/community/feedPages')>()), fetchCampusPostPage: mocks.page }));
vi.mock('@/lib/community/firestore', () => ({
  rankFeedPosts: (rows: unknown[]) => rows,
  listBoards: async () => [],
  listSubscribedBoardIds: async () => [],
  listActiveStoriesForSchool: async () => [],
  groupStoriesByAuthor: () => [],
  fetchSchoolDirectoryProfiles: async () => [],
  toggleCampusPostLike: vi.fn(),
  markStoryViewed: vi.fn(),
}));
vi.mock('@/lib/community/follows', () => ({
  listFollowingIds: async () => [], followUser: vi.fn(), unfollowUser: vi.fn(),
}));
vi.mock('@/lib/community/bookmarks', () => ({
  BOOKMARK_UNAVAILABLE_COPY: '收藏功能暫時無法使用',
  listCampusPostBookmarkIds: async () => [],
  loadCampusPostBookmarks: async () => ({ ids: [], posts: [] }),
  saveCampusPostBookmark: vi.fn(), removeCampusPostBookmark: vi.fn(),
}));

const post = { id: 'one', schoolId: 'pu', boardId: 'public', anonymous: true, title: '原本的貼文', content: '測試內容' };
const cursor = { schoolId: 'pu', document: { id: 'one' } };
const first = { posts: [post], nextCursor: cursor, hasMore: true };
const last = { posts: [], nextCursor: null, hasMore: false };
function deferred() {
  let resolve!: (page: typeof last) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof last>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  mocks.page.mockResolvedValueOnce(first).mockResolvedValue(last);
});
async function ready() {
  render(<FeedTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('原本的貼文');
  const button = screen.getByRole('button', { name: '載入更多貼文' });
  button.focus();
  return button;
}

it('keeps the busy control focusable while repeated activation issues only one request', async () => {
  const pending = deferred();
  mocks.page.mockReturnValueOnce(pending.promise);
  const button = await ready();
  fireEvent.click(button);
  expect(button).toHaveProperty('disabled', false);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.page).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(last));
  expect(document.activeElement).toBe(screen.getByText('已讀到本次查詢的最後一頁。'));
});

it('moves focus after a fast final page even when loading state is batched', async () => {
  const button = await ready();
  await act(async () => { fireEvent.click(button); });
  expect(screen.queryByRole('button', { name: '載入更多貼文' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByText('已讀到本次查詢的最後一頁。'));
});

it('focuses revalidation when access is revoked while the continuation control is focused', async () => {
  const pending = deferred();
  mocks.page.mockReturnValueOnce(pending.promise);
  const button = await ready();
  fireEvent.click(button);
  await act(async () => pending.reject(Object.assign(new Error('revoked'), { code: 'permission-denied' })));
  expect(screen.queryByText('原本的貼文')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新驗證' }));
  expect(screen.queryByRole('button', { name: '載入更多貼文' })).toBeNull();
});

it.each(['success', 'permission-denied'] as const)('does not take search focus after a late %s', async (outcome) => {
  const pending = deferred();
  mocks.page.mockReturnValueOnce(pending.promise);
  const button = await ready();
  fireEvent.click(button);
  const search = screen.getByRole('searchbox');
  search.focus();
  fireEvent.change(search, { target: { value: '繼續輸入' } });
  await act(async () => {
    if (outcome === 'success') pending.resolve(last);
    else pending.reject(Object.assign(new Error('revoked'), { code: outcome }));
  });
  expect(document.activeElement).toBe(search);
  expect(search).toHaveProperty('value', '繼續輸入');
});

it('restores the same retry control after a network failure without replacing the cursor', async () => {
  const pending = deferred();
  mocks.page.mockReturnValueOnce(pending.promise);
  const button = await ready();
  fireEvent.click(button);
  await act(async () => pending.reject(Object.assign(new Error('offline'), { code: 'unavailable' })));
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBe('false');
  expect(screen.getByText('原本的貼文')).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(3));
  expect(mocks.page.mock.calls[1][1]).toBe(cursor);
  expect(mocks.page.mock.calls[2][1]).toBe(cursor);
  expect(document.activeElement).toBe(screen.getByText('已讀到本次查詢的最後一頁。'));
});

it('jumps to older posts by Taiwan date without scanning recent pages and keeps keyword and sort', async () => {
  const button = await ready();
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '專題' } });
  fireEvent.click(screen.getByRole('button', { name: '最新' }));
  const older = { posts: [{ ...post, id: 'old', title: '去年的專題' }], nextCursor: null, hasMore: false };
  mocks.page.mockResolvedValueOnce(older);
  fireEvent.change(screen.getByLabelText('選擇歷史貼文截止日期'), { target: { value: '2024-02-29' } });
  fireEvent.click(screen.getByRole('button', { name: '從這天往前找' }));
  await screen.findByText('去年的專題');
  expect(mocks.page).toHaveBeenCalledTimes(2);
  expect(mocks.page.mock.calls[1][1]).toBeNull();
  expect((mocks.page.mock.calls[1][2] as Date).toISOString()).toBe('2024-02-29T15:59:59.999Z');
  expect(search).toHaveProperty('value', '專題');
  expect(screen.getByRole('button', { name: '最新' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/2024-02-29 當日以前/)).toBeTruthy();
  expect(screen.queryByText('原本的貼文')).toBeNull();
  expect(button.isConnected).toBe(false);
});

it('keeps original cards and active date when a new historical date is offline, then retries', async () => {
  await ready();
  const offline = Object.assign(new Error('offline'), { code: 'unavailable' });
  mocks.page.mockRejectedValueOnce(offline)
    .mockResolvedValueOnce({ posts: [{ ...post, id: 'old', title: '歷史貼文' }], nextCursor: null, hasMore: false });
  const date = screen.getByLabelText('選擇歷史貼文截止日期');
  fireEvent.change(date, { target: { value: '2022-09-03' } });
  fireEvent.click(screen.getByRole('button', { name: '從這天往前找' }));
  await screen.findByRole('alert');
  expect(screen.getByText('原本的貼文')).toBeTruthy();
  expect(screen.queryByText(/2022-09-03 當日以前/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '從這天往前找' }));
  await screen.findByText('歷史貼文');
  expect((mocks.page.mock.calls[1][2] as Date).getTime()).toBe((mocks.page.mock.calls[2][2] as Date).getTime());
  fireEvent.click(screen.getByRole('button', { name: '回到最新貼文' }));
  await screen.findByText('已讀到本次查詢的最後一頁。');
  expect(mocks.page.mock.calls[3][2]).toBeNull();
});

it('clears old cards if a historical lookup discovers revoked membership', async () => {
  await ready();
  mocks.page.mockRejectedValueOnce(Object.assign(new Error('revoked'), {code:'permission-denied'}));
  fireEvent.change(screen.getByLabelText('選擇歷史貼文截止日期'), { target: {value:'2023-11-15'} });
  fireEvent.click(screen.getByRole('button', {name:'從這天往前找'}));
  await screen.findByRole('button', {name:'重新驗證'});
  expect(screen.queryByText('原本的貼文')).toBeNull();
  expect(screen.queryByRole('button', {name:'載入更多貼文'})).toBeNull();
});
