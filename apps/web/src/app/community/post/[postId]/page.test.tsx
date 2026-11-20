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
  BOOKMARK_UNAVAILABLE_COPY: '收藏功能暫時無法使用',
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
  const bookmark = await screen.findByRole('button', { name: '收藏功能暫時無法使用' });
  expect((bookmark as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('收藏功能暫時無法使用')).toBeTruthy();
  expect(screen.queryByText('無法讀取收藏狀態，請確認校籍與連線。')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(bookmark);
  expect(mocks.saveBookmark).not.toHaveBeenCalled();
});

it('disables bookmark controls after a permission-denied save instead of offering a retry', async () => {
  mocks.saveBookmark.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<PostDetailPage />);
  const bookmark = await screen.findByRole('button', { name: '收藏貼文' });
  await waitFor(() => expect((bookmark as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText('這次收藏未成功更新，請確認校籍與連線後重試。')).toBeNull();
  await act(async () => {
    fireEvent.click(bookmark);
  });
  await waitFor(() => expect(mocks.saveBookmark).toHaveBeenCalledWith('alice', 'pu', 'p-1'));
  await screen.findByText('收藏功能暫時無法使用');
  expect(screen.queryByText('這次收藏未成功更新，請確認校籍與連線後重試。')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  const unavailable = screen.getByRole('button', { name: '收藏功能暫時無法使用' });
  expect((unavailable as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(unavailable);
  expect(mocks.saveBookmark).toHaveBeenCalledTimes(1);
});

it('keeps bookmark writes retryable after a network failure', async () => {
  mocks.saveBookmark
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(undefined);
  render(<PostDetailPage />);
  const bookmark = await screen.findByRole('button', { name: '收藏貼文' });
  await waitFor(() => expect((bookmark as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(bookmark);
  });
  await screen.findByText('這次收藏未成功更新，請確認校籍與連線後重試。');
  expect(screen.queryByText('收藏功能暫時無法使用')).toBeNull();
  expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '收藏貼文' }));
  });
  await waitFor(() => expect(mocks.saveBookmark).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏貼文' })).toBeTruthy());
});

it('still explains a non-permission bookmark read failure', async () => {
  mocks.isBookmarked.mockRejectedValueOnce(new Error('unavailable'));
  render(<PostDetailPage />);
  await screen.findByText('無法讀取收藏狀態，請確認校籍與連線。');
  await waitFor(() => expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(true));
});
