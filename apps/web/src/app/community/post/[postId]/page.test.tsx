import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  updatePost: vi.fn(),
  toggleLike: vi.fn(),
  addReply: vi.fn(),
  deleteReply: vi.fn(),
  deletePost: vi.fn(),
  push: vi.fn(),
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
  useRouter: () => ({ replace: vi.fn(), push: mocks.push }),
}));
vi.mock('@/lib/community/firestore', () => ({
  getCampusPostById: mocks.getPost,
  listCampusReplies: mocks.listReplies,
  fetchSchoolDirectoryProfiles: mocks.profiles,
  flattenCampusRepliesThread: (rows: unknown[]) => rows,
  addCampusReply: mocks.addReply,
  deleteCampusPost: mocks.deletePost,
  getOrCreateBoardAlias: vi.fn(),
  softDeleteCampusReply: mocks.deleteReply,
  submitCampusReport: vi.fn(),
  toggleCampusPostLike: mocks.toggleLike,
  updateCampusPost: mocks.updatePost,
}));
vi.mock('@/lib/community/bookmarks', () => ({
  BOOKMARK_UNAVAILABLE_COPY: '收藏功能暫時無法使用',
  isCampusPostBookmarked: mocks.isBookmarked,
  saveCampusPostBookmark: mocks.saveBookmark,
  removeCampusPostBookmark: mocks.removeBookmark,
}));

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
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
  mocks.toggleLike.mockReset().mockResolvedValue(true);
  mocks.addReply.mockReset().mockResolvedValue(undefined);
  mocks.deleteReply.mockReset().mockResolvedValue(undefined);
  mocks.deletePost.mockReset().mockResolvedValue(undefined);
  mocks.push.mockReset();
  mocks.updatePost.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  document.body.style.removeProperty('overflow');
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
  let confirmSave!: () => void;
  mocks.saveBookmark
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockImplementationOnce(() => new Promise<void>((resolve) => { confirmSave = resolve; }));
  render(<PostDetailPage />);
  const bookmark = await screen.findByRole('button', { name: '收藏貼文' });
  await waitFor(() => expect((bookmark as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(bookmark);
  });
  await screen.findByText('這次收藏未成功更新，請確認校籍與連線後重試。');
  expect(screen.queryByText('收藏功能暫時無法使用')).toBeNull();
  expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  await act(async () => {
    fireEvent.click(bookmark);
    fireEvent.click(bookmark);
  });
  expect((bookmark as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.saveBookmark).toHaveBeenCalledTimes(2);
  await act(async () => confirmSave());
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消收藏貼文' }).disabled).toBe(false);
});

it('still explains a non-permission bookmark read failure', async () => {
  mocks.isBookmarked.mockRejectedValueOnce(new Error('unavailable'));
  render(<PostDetailPage />);
  await screen.findByText('無法讀取收藏狀態，請確認校籍與連線。');
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
});

function ownPost(title: string | null = '原標題') {
  const original = {
    id: 'p-1',
    schoolId: 'pu',
    boardId: 'board',
    anonymous: false,
    authorUid: 'alice',
    ...(title === null ? {} : { title }),
    content: '原內文',
    likes: 0,
    likedBy: [],
    commentCount: 0,
    tags: ['課程'],
    mediaUrls: ['https://example.test/photo.jpg'],
  };
  mocks.getPost.mockResolvedValue(original);
  mocks.updatePost.mockImplementation(async (_school, _id, patch) => {
    mocks.getPost.mockResolvedValue({ ...original, ...patch });
  });
}

it('uses a named native edit dialog and restores focus after cancelling', async () => {
  ownPost();
  render(<PostDetailPage />);
  const opener = await screen.findByRole('button', { name: '✏️ 編輯' });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: '編輯貼文' }).tagName).toBe('DIALOG');
  expect(document.activeElement).toBe(screen.getByLabelText('標題'));
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
  expect(mocks.updatePost).not.toHaveBeenCalled();
});

it.each(['cancel', 'close', 'escape', 'backdrop'])(
  'holds one edit write across immediate %s dismissal and updates the confirmed post',
  async (dismissal) => {
    ownPost();
    let resolve!: () => void;
    mocks.updatePost.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<PostDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: ' 新標題 ' } });
    fireEvent.change(screen.getByLabelText('內文'), { target: { value: ' 新內文 ' } });
    fireEvent.change(screen.getByLabelText('標籤（逗號分隔）'), {
      target: { value: '#課程,新生,三,四,五,六' },
    });
    const dialog = screen.getByRole('dialog', { name: '編輯貼文' });
    const form = dialog.querySelector('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(mocks.updatePost).toHaveBeenCalledOnce();
    expect(mocks.updatePost).toHaveBeenCalledWith('pu', 'p-1', {
      title: '新標題',
      content: '新內文',
      tags: ['課程', '新生', '三', '四', '五'],
    });
    expect(screen.getByLabelText('標題').matches(':disabled')).toBe(true);
    if (dismissal === 'escape') {
      fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    } else if (dismissal === 'backdrop') {
      fireEvent.pointerDown(dialog, { clientX: -1, clientY: -1 });
      fireEvent.click(dialog, { clientX: -1, clientY: -1 });
    } else {
      fireEvent.click(screen.getByRole('button', { name: dismissal === 'cancel' ? '取消' : '關閉視窗' }));
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '✏️ 編輯' }));
    expect(screen.getByLabelText<HTMLInputElement>('標題').value).toBe(' 新標題 ');
    expect(screen.getByRole('button', { name: '儲存中…' }).matches(':disabled')).toBe(true);
    const original = await mocks.getPost.mock.results[0].value;
    mocks.getPost.mockResolvedValue({ ...original, title: '另一分頁的標題', content: '另一分頁的內文' });
    await act(async () => {
      resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('另一分頁的標題')).toBeTruthy();
    expect(screen.getByText('另一分頁的內文')).toBeTruthy();
    expect(mocks.getPost).toHaveBeenCalledTimes(2);
    expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', 'server');
    fireEvent.click(screen.getByRole('button', { name: '✏️ 編輯' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('內文').value).toBe('另一分頁的內文');
  },
);

it.each(['post', 'replies', 'both'])(
  'keeps a successful reply committed when refreshing %s fails',
  async (failedRead) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    ownPost();
    render(<PostDetailPage />);
    const input = await screen.findByPlaceholderText('輸入留言⋯');
    if (failedRead !== 'replies') mocks.getPost.mockRejectedValueOnce(new Error('offline'));
    if (failedRead !== 'post') mocks.listReplies.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(input, { target: { value: '新留言' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
    expect(mocks.addReply).toHaveBeenCalledOnce();
    expect(mocks.getPost).toHaveBeenCalledTimes(2);
    expect(mocks.listReplies).toHaveBeenCalledTimes(2);
    expect((input as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '送出留言' }));
    expect(mocks.addReply).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '✏️ 編輯' }).matches(':disabled')).toBe(false);
    expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
    expect(mocks.listReplies).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
    expect(screen.getByRole('status').textContent).toContain('部分資料無法更新。');
    expect(alert).not.toHaveBeenCalled();
  },
);

it.each([false, true])('uses default reads after adding a reply (nested: %s)', async (nested) => {
  const original = await mocks.getPost();
  const parent = { id: 'r-1', authorUid: 'bob', content: '原留言', threadDepth: 0 };
  mocks.listReplies.mockResolvedValue([parent]);
  render(<PostDetailPage />);
  await screen.findByText('原留言');
  if (nested) fireEvent.click(screen.getByRole('button', { name: '回覆' }));
  mocks.getPost.mockResolvedValueOnce({ ...original, title: '伺服器更新的標題', commentCount: 2 });
  mocks.listReplies.mockResolvedValueOnce([
    parent,
    { id: 'r-2', authorUid: 'alice', content: '伺服器確認的留言', threadDepth: nested ? 1 : 0 },
  ]);
  fireEvent.change(screen.getByPlaceholderText('輸入留言⋯'), { target: { value: '送出的文字' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
  expect(mocks.addReply).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', expect.objectContaining({
    parentReplyId: nested ? parent.id : null,
  }));
  expect(mocks.listReplies).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
  expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
  expect(screen.getByText('伺服器確認的留言')).toBeTruthy();
  expect(screen.getByText('伺服器更新的標題')).toBeTruthy();
});

it('preserves the reply draft and reports an actual write failure', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  mocks.addReply.mockRejectedValueOnce(new Error('offline'));
  render(<PostDetailPage />);
  const input = await screen.findByPlaceholderText<HTMLTextAreaElement>('輸入留言⋯');
  fireEvent.change(input, { target: { value: '尚未送出的留言' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
  expect(input.value).toBe('尚未送出的留言');
  expect(alert).toHaveBeenCalledWith('這次未能送出，請稍後再試。');
  expect(mocks.getPost).toHaveBeenCalledOnce();
  expect(mocks.listReplies).toHaveBeenCalledOnce();
});

it.each(['post', 'replies', 'both'])(
  'prevents a second reply deletion when refreshing %s fails',
  async (failedRead) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    ownPost();
    const oldReplies = [{ id: 'r-1', authorUid: 'alice', content: '我的留言', threadDepth: 0 }];
    mocks.listReplies.mockResolvedValue(oldReplies);
    render(<PostDetailPage />);
    const remove = await screen.findByRole('button', { name: /^刪除$/ });
    fireEvent.click(screen.getByRole('button', { name: '回覆' }));
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('輸入留言⋯');
    fireEvent.change(input, { target: { value: '仍在回覆' } });
    if (failedRead !== 'replies') mocks.getPost.mockRejectedValueOnce(new Error('offline'));
    if (failedRead !== 'post') mocks.listReplies.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      fireEvent.click(remove);
      fireEvent.click(remove);
    });
    expect(mocks.deleteReply).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', 'r-1');
    expect(screen.queryByRole('button', { name: /^刪除$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '回覆' })).toBeNull();
    expect(screen.queryByText('我的留言')).toBeNull();
    expect(screen.getByText('正在回覆⋯')).toBeTruthy();
    expect(input.value).toBe('仍在回覆');
    expect(screen.getByText('（此留言已被作者刪除）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '✏️ 編輯' }).matches(':disabled')).toBe(false);
    expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
    expect(mocks.listReplies).toHaveBeenLastCalledWith('pu', 'p-1', 'default');
    expect(screen.getByRole('status').textContent).toContain('部分資料無法更新。');

    // Even a successful retry can return a stale snapshot.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取' })));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /^刪除$/ })).toBeNull();
    expect(mocks.deleteReply).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
    expect(mocks.addReply).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', expect.objectContaining({
      content: '仍在回覆',
      parentReplyId: 'r-1',
    }));
  },
);

it.each([
  ['post', 'child', 'success', 'during'],
  ['post', 'child', 'failure', 'after'],
  ['parent', 'child', 'success', 'after'],
  ['child', 'child', 'success', 'during'],
  ['child', 'child', 'failure', 'after'],
  ['other', 'child', 'success', 'after'],
  ['parent', null, 'success', 'during'],
] as const)('preserves reply submission when deleting %s (target %s, %s, %s)', async (
  deletion, target, outcome, sendWhen,
) => {
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  ownPost();
  const rows = [
    { id: 'parent', authorUid: 'alice', content: '父留言', threadDepth: 0 },
    { id: 'child', authorUid: 'alice', content: '子留言', depth: 1, threadDepth: 1, parentReplyId: 'parent' },
    { id: 'other', authorUid: 'alice', content: '其他留言', threadDepth: 0 },
  ];
  mocks.listReplies.mockResolvedValue(rows);
  let finishDeletion!: () => void;
  const write = deletion === 'post' ? mocks.deletePost : mocks.deleteReply;
  write.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
    finishDeletion = outcome === 'success' ? resolve : () => reject(new Error('offline'));
  }));
  render(<PostDetailPage />);
  const input = await screen.findByPlaceholderText<HTMLTextAreaElement>('輸入留言⋯');
  if (target) fireEvent.click(screen.getAllByRole('button', { name: '回覆' })[1]);
  fireEvent.change(input, { target: { value: '等候刪除時的草稿' } });
  const remove = deletion === 'post'
    ? screen.getByRole('button', { name: /🗑 刪除/ })
    : screen.getAllByRole('button', { name: /^刪除$/ })[rows.findIndex(({ id }) => id === deletion)];
  fireEvent.click(remove);
  fireEvent.click(remove);
  expect(write).toHaveBeenCalledOnce();
  const assertDraft = () => {
    expect(input.value).toBe('等候刪除時的草稿');
    expect(Boolean(screen.queryByText('正在回覆⋯'))).toBe(Boolean(target));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '送出留言' }).disabled).toBe(false);
  };
  assertDraft();
  if (sendWhen === 'after') {
    await act(async () => finishDeletion());
    assertDraft();
  }
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
  expect(mocks.addReply).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', expect.objectContaining({
    content: '等候刪除時的草稿',
    parentReplyId: target,
    depth: target ? 2 : 0,
  }));
  if (sendWhen === 'during') await act(async () => finishDeletion());
});

it('keeps a deleted reply hidden when an earlier thread read arrives late', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const oldReplies = [{ id: 'r-1', authorUid: 'alice', content: '我的留言', threadDepth: 0 }];
  mocks.listReplies.mockResolvedValue(oldReplies);
  render(<PostDetailPage />);
  const remove = await screen.findByRole('button', { name: /^刪除$/ });
  let resolveEarlierRead!: (rows: typeof oldReplies) => void;
  mocks.listReplies.mockImplementationOnce(() => new Promise((resolve) => {
    resolveEarlierRead = resolve;
  }));
  fireEvent.click(screen.getByRole('button', { name: '回覆' }));
  fireEvent.change(screen.getByPlaceholderText('輸入留言⋯'), { target: { value: '新回覆' } });
  fireEvent.click(screen.getByRole('button', { name: '送出留言' }));
  await waitFor(() => expect(resolveEarlierRead).toBeDefined());
  expect(mocks.addReply).toHaveBeenCalledWith('pu', 'p-1', expect.objectContaining({
    content: '新回覆',
    parentReplyId: 'r-1',
  }));

  let failDeletionRefresh!: (error: Error) => void;
  mocks.listReplies.mockImplementationOnce(() => new Promise((_, reject) => {
    failDeletionRefresh = reject;
  }));
  await act(async () => fireEvent.click(remove));
  expect(screen.getByText('（此留言已被作者刪除）')).toBeTruthy();
  expect(screen.queryByText('尚無留言，當第一人吧。')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();

  await act(async () => failDeletionRefresh(new Error('offline')));
  await act(async () => resolveEarlierRead(oldReplies));
  expect(screen.getByRole('status').textContent).toContain('部分資料無法更新。');
  expect(screen.getByText('（此留言已被作者刪除）')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^刪除$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: '回覆' })).toBeNull();
  expect(mocks.deleteReply).toHaveBeenCalledOnce();
});

it('retains reply actions when the deletion write fails', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mocks.listReplies.mockResolvedValue([
    { id: 'r-1', authorUid: 'alice', content: '我的留言', threadDepth: 0 },
  ]);
  mocks.deleteReply.mockRejectedValueOnce(new Error('offline'));
  render(<PostDetailPage />);
  const remove = await screen.findByRole('button', { name: /^刪除$/ });
  await act(async () => fireEvent.click(remove));
  expect(alert).toHaveBeenCalledWith('這次未能刪除，請稍後再試。');
  expect(screen.getByText('我的留言')).toBeTruthy();
  await act(async () => fireEvent.click(remove));
  expect(mocks.deleteReply).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: /^刪除$/ })).toBeNull();
});

it.each([
  [false, 'success'], [true, 'success'],
  [false, 'failure'], [true, 'failure'],
])('keeps like locked through a slow %s → %s refresh', async (liked, outcome) => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  ownPost();
  const original = await mocks.getPost();
  mocks.getPost.mockResolvedValue({ ...original, likedBy: liked ? ['alice'] : [], likes: Number(liked) });
  mocks.toggleLike.mockResolvedValue(!liked);
  const confirmed = { ...original, likedBy: liked ? [] : ['alice'], likes: Number(!liked) };
  render(<PostDetailPage />);
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: liked ? /❤️/ : /🤍/ });

  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  mocks.getPost.mockImplementationOnce(() => new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  }));
  await act(async () => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain(liked ? '🤍' : '❤️');
  fireEvent.click(button);
  expect(mocks.toggleLike).toHaveBeenCalledOnce();
  expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', 'server');
  expect(screen.getByText('原內文')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '討論串 · 0' })).toBeTruthy();
  expect(mocks.listReplies).toHaveBeenCalledOnce();

  await act(async () => {
    if (outcome === 'success') resolve({ ...confirmed, content: '伺服器最新內文' });
    else reject(new Error('offline'));
  });
  expect(button.disabled).toBe(false);
  expect(button.textContent).toContain(liked ? '🤍' : '❤️');
  expect(screen.getByRole('button', { name: '✏️ 編輯' }).matches(':disabled')).toBe(false);
  expect(alert).not.toHaveBeenCalled();
  if (outcome === 'success') {
    expect(screen.getByText('伺服器最新內文')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新讀取' })).toBeNull();
  } else {
    expect(screen.getByText('原內文')).toBeTruthy();
    mocks.getPost.mockResolvedValue({ ...confirmed, content: '重試後的內文' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取' })));
    expect(screen.getByText('重試後的內文')).toBeTruthy();
  }
  expect(mocks.toggleLike).toHaveBeenCalledOnce();
});

it.each(['success', 'failure'])('keeps the post and replies visible through a slow %s refresh', async (outcome) => {
  ownPost();
  const original = await mocks.getPost();
  const reply = { id: 'r-1', authorUid: 'alice', content: '原留言', threadDepth: 0 };
  mocks.listReplies.mockResolvedValue([reply]);
  render(<PostDetailPage />);
  await screen.findByText('原留言');
  let finishPost!: (value: unknown) => void;
  let finishReplies!: (value: unknown) => void;
  let failPost!: (error: Error) => void;
  let failReplies!: (error: Error) => void;
  mocks.getPost.mockImplementationOnce(() => new Promise((resolve, reject) => {
    finishPost = resolve;
    failPost = reject;
  }));
  mocks.listReplies.mockImplementationOnce(() => new Promise((resolve, reject) => {
    finishReplies = resolve;
    failReplies = reject;
  }));
  fireEvent.change(screen.getByPlaceholderText('輸入留言⋯'), { target: { value: '新留言' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '送出留言' })));
  expect(screen.getByText('原內文')).toBeTruthy();
  expect(screen.getByText('原留言')).toBeTruthy();
  const finish = () => {
    finishPost({ ...original, content: '刷新後的內文' });
    finishReplies([{ ...reply, content: '刷新後的留言' }]);
  };
  await act(async () => {
    if (outcome === 'success') finish();
    else {
      failPost(new Error('offline'));
      failReplies(new Error('offline'));
    }
  });
  const refreshed = outcome === 'success';
  expect(screen.getByText(refreshed ? '刷新後的內文' : '原內文')).toBeTruthy();
  expect(screen.getByText(refreshed ? '刷新後的留言' : '原留言')).toBeTruthy();
  expect(Boolean(screen.queryByRole('button', { name: '重新讀取' }))).toBe(!refreshed);
});

it.each([
  [false, false], [false, true], [true, false], [true, true],
])('waits for replies before showing the thread (past 45 seconds: %s, has replies: %s)', async (
  late, hasReplies,
) => {
  vi.useFakeTimers();
  const reply = { id: 'r-1', authorUid: 'bob', content: '既有留言', threadDepth: 0 };
  let finishReplies!: (rows: (typeof reply)[]) => void;
  mocks.listReplies.mockReturnValueOnce(new Promise((resolve) => { finishReplies = resolve; }));

  await act(async () => { render(<PostDetailPage />); });
  expect(mocks.getPost).toHaveBeenCalledOnce();
  if (late) await act(async () => vi.advanceTimersByTimeAsync(46_000));
  expect(screen.getByText('載入中…')).toBeTruthy();
  expect(screen.queryByText('小明的貼文')).toBeNull();
  expect(screen.queryByRole('heading', { name: /討論串/ })).toBeNull();
  expect(screen.queryByText('尚無留言，當第一人吧。')).toBeNull();
  expect(screen.queryByPlaceholderText('輸入留言⋯')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => finishReplies(hasReplies ? [reply] : []));
  expect(screen.getByText('小明的貼文')).toBeTruthy();
  expect(screen.getByRole('heading', { name: `討論串 · ${Number(hasReplies)}` })).toBeTruthy();
  expect(Boolean(screen.queryByText('既有留言'))).toBe(hasReplies);
  expect(Boolean(screen.queryByText('尚無留言，當第一人吧。'))).toBe(!hasReplies);
  expect(mocks.listReplies).toHaveBeenCalledOnce();
});

it.each([
  ['post', 'offline'], ['replies', 'offline'], ['replies', 'deadline-exceeded'],
])('offers a full-page retry after a first %s read fails with %s', async (failedRead, reason) => {
  const read = failedRead === 'post' ? mocks.getPost : mocks.listReplies;
  read.mockRejectedValueOnce(new Error(reason)).mockRejectedValueOnce(new Error(reason));
  render(<PostDetailPage />);
  const retry = await screen.findByRole('button', { name: '重試' });
  expect(screen.getByRole('alert').textContent).toContain('無法讀取貼文，請確認連線與學校資格後重試。');
  expect(screen.queryByRole('heading', { name: /討論串/ })).toBeNull();
  expect(screen.queryByText('尚無留言，當第一人吧。')).toBeNull();

  await act(async () => fireEvent.click(retry));
  expect(screen.getByRole('alert').textContent).toContain('無法讀取貼文，請稍後重試。');

  let finishReplies!: (rows: unknown[]) => void;
  mocks.listReplies.mockReturnValueOnce(new Promise((resolve) => { finishReplies = resolve; }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重試' })));
  expect(screen.getByText('載入中…')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /討論串/ })).toBeNull();
  await act(async () => finishReplies([]));
  expect(screen.getByText('小明的貼文')).toBeTruthy();
  expect(screen.getByText('尚無留言，當第一人吧。')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.getPost).toHaveBeenCalledTimes(3);
  expect(mocks.listReplies).toHaveBeenCalledTimes(3);
});

it.each(['like', 'reply', 'delete'] as const)(
  'deduplicates a queued %s write and enables retry after its deadline',
  async (action) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    ownPost();
    mocks.listReplies.mockResolvedValue([
      { id: 'r-1', authorUid: 'alice', content: '我的留言', threadDepth: 0 },
    ]);
    const write = { like: mocks.toggleLike, reply: mocks.addReply, delete: mocks.deleteReply }[action];
    let reject!: (error: Error) => void;
    write.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<PostDetailPage />);
    const input = await screen.findByPlaceholderText<HTMLTextAreaElement>('輸入留言⋯');
    const button = screen.getByRole('button', {
      name: { like: /🤍/, reply: '送出留言', delete: /^刪除$/ }[action],
    });
    fireEvent.change(input, { target: { value: '保留的留言' } });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(write).toHaveBeenCalledOnce();
    expect(mocks.getPost).toHaveBeenCalledOnce();

    await act(async () => reject(new Error('deadline-exceeded')));
    expect(alert).toHaveBeenCalledOnce();
    expect(input.value).toBe('保留的留言');
    expect(mocks.getPost).toHaveBeenCalledOnce();
    await act(async () => fireEvent.click(button));
    expect(write).toHaveBeenCalledTimes(2);
    expect(mocks.getPost).toHaveBeenLastCalledWith('pu', 'p-1', action === 'like' ? 'server' : 'default');
  },
);

it('removes post actions after deletion even while navigation has not changed the page', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  ownPost();
  render(<PostDetailPage />);
  const remove = await screen.findByRole('button', { name: /🗑 刪除/ });
  await act(async () => {
    fireEvent.click(remove);
    fireEvent.click(remove);
  });
  expect(mocks.deletePost).toHaveBeenCalledExactlyOnceWith('pu', 'p-1');
  expect(mocks.push).toHaveBeenCalledOnce();
  expect(alert).toHaveBeenCalledExactlyOnceWith('已刪除');
  expect(screen.getByText('找不到貼文，可能已被刪除。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /🗑 刪除/ })).toBeNull();
});

it.each(['like', 'reply', 'both'])(
  'keeps the confirmed edit and %s writes when the edit refresh fails',
  async (source) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    ownPost();
    render(<PostDetailPage />);
    const edit = await screen.findByRole('button', { name: '✏️ 編輯' });
    const original = await mocks.getPost.mock.results[0].value;
    const resolveReads: ((value: unknown) => void)[] = [];
    const deferRead = () => mocks.getPost.mockImplementationOnce(
      () => new Promise((resolve) => resolveReads.push(resolve)),
    );
    if (source !== 'reply') {
      deferRead();
      fireEvent.click(screen.getByRole('button', { name: /🤍/ }));
    }
    if (source !== 'like') {
      deferRead();
      fireEvent.change(screen.getByPlaceholderText('輸入留言⋯'), { target: { value: '新留言' } });
      fireEvent.click(screen.getByRole('button', { name: '送出留言' }));
    }
    await waitFor(() => expect(resolveReads).toHaveLength(source === 'both' ? 2 : 1));

    mocks.getPost.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('內文'), { target: { value: '已儲存內文' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => resolveReads.forEach((resolve) => resolve(original)));
    expect(mocks.getPost).toHaveBeenCalledTimes(2 + resolveReads.length);
    expect(mocks.updatePost).toHaveBeenCalledOnce();
    expect(mocks.addReply).toHaveBeenCalledTimes(source === 'like' ? 0 : 1);
    expect(mocks.toggleLike).toHaveBeenCalledTimes(source === 'reply' ? 0 : 1);
    expect(screen.getByText('已儲存內文')).toBeTruthy();
    expect(screen.queryByText('原內文')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('部分資料無法更新。');
    fireEvent.click(edit);
    expect(screen.getByLabelText<HTMLTextAreaElement>('內文').value).toBe('已儲存內文');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    mocks.getPost.mockRejectedValueOnce(new Error('still offline'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取' })));
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('已儲存內文')).toBeTruthy();
    mocks.getPost.mockResolvedValue({ ...original, content: '伺服器最新內文' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取' })));
    fireEvent.click(edit);
    expect(screen.getByLabelText<HTMLTextAreaElement>('內文').value).toBe('伺服器最新內文');
    expect(mocks.updatePost).toHaveBeenCalledOnce();
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('輸入留言⋯').value).toBe('');
    expect(alert).not.toHaveBeenCalled();
  },
);

it.each(['like', 'reply', 'both'])(
  'keeps the saved fields when earlier %s reads finish after saving',
  async (source) => {
    ownPost();
    render(<PostDetailPage />);
    const edit = await screen.findByRole('button', { name: '✏️ 編輯' });
    const original = await mocks.getPost.mock.results[0].value;
    const resolveReads: ((value: unknown) => void)[] = [];
    const startRead = () => {
      mocks.getPost.mockImplementationOnce(
        () => new Promise((resolve) => resolveReads.push(resolve)),
      );
    };
    if (source !== 'reply') {
      startRead();
      fireEvent.click(screen.getByRole('button', { name: /🤍/ }));
    }
    if (source !== 'like') {
      startRead();
      fireEvent.change(screen.getByPlaceholderText('輸入留言⋯'), { target: { value: '新留言' } });
      fireEvent.click(screen.getByRole('button', { name: '送出留言' }));
    }
    await waitFor(() => expect(resolveReads).toHaveLength(source === 'both' ? 2 : 1));

    const saved = { title: '', content: '新內文', tags: ['新標籤'] };
    const fresh = { ...original, ...saved, likes: 1, likedBy: ['alice'] };
    let resolveFresh!: (value: unknown) => void;
    mocks.getPost.mockImplementationOnce(() => new Promise((resolve) => (resolveFresh = resolve)));
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: saved.title } });
    fireEvent.change(screen.getByLabelText('內文'), { target: { value: saved.content } });
    fireEvent.change(screen.getByLabelText('標籤（逗號分隔）'), {
      target: { value: saved.tags.join(', ') },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((edit as HTMLButtonElement).disabled).toBe(false);

    // The stale response may even report a missing post.
    for (const resolve of resolveReads.reverse()) {
      await act(async () => resolve(source === 'reply' ? null : { ...original, likes: 1 }));
      expect(screen.queryByText('原標題')).toBeNull();
      expect(screen.getByText('新內文')).toBeTruthy();
      expect(screen.getByText('#新標籤')).toBeTruthy();
    }

    await act(async () => resolveFresh(fresh));
    fireEvent.click(edit);
    expect(screen.getByLabelText<HTMLInputElement>('標題').value).toBe(saved.title);
    expect(screen.getByLabelText<HTMLTextAreaElement>('內文').value).toBe(saved.content);
    expect(screen.getByLabelText<HTMLInputElement>('標籤（逗號分隔）').value).toBe('新標籤');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: /❤️.*1/ })).toBeTruthy();
  },
);

it.each([
  { name: 'a nonempty title cleared by the author', title: '原標題', entered: '' },
  { name: 'a missing legacy title', title: null },
  { name: 'an existing whitespace-only title', title: '   ' },
  { name: 'a title replaced with whitespace', title: '原標題', entered: '   ' },
])('saves $name as an empty string', async ({ title, entered }) => {
  ownPost(title);
  render(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  const input = screen.getByLabelText<HTMLInputElement>('標題');
  expect(input.value).toBe(title ?? '');
  if (entered !== undefined) fireEvent.change(input, { target: { value: entered } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.updatePost).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', {
    title: '',
    content: '原內文',
    tags: ['課程'],
  });
});

it('lets the author save an untitled legacy post and retains the draft after a lost response', async () => {
  ownPost('');
  mocks.updatePost.mockRejectedValueOnce(new Error('network'));
  render(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  fireEvent.change(screen.getByLabelText('內文'), { target: { value: '保留的修改內容' } });
  fireEvent.change(screen.getByLabelText('標籤（逗號分隔）'), { target: { value: '更新標籤' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await screen.findByText('暫時無法確認儲存結果，修改內容已保留。請先查看貼文，再決定是否重試。');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '✏️ 編輯' }));
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('內文') as HTMLTextAreaElement).value).toBe('保留的修改內容');
  expect(screen.getByLabelText('標題').matches(':disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.updatePost).toHaveBeenCalledTimes(2);
  expect(mocks.updatePost).toHaveBeenLastCalledWith('pu', 'p-1', {
    title: '',
    content: '保留的修改內容',
    tags: ['更新標籤'],
  });
  expect(screen.getByText('保留的修改內容')).toBeTruthy();
});

it('reopens the same slow edit without resubmitting and applies a hidden success without moving focus', async () => {
  ownPost();
  let resolve!: () => void;
  mocks.updatePost.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<PostDetailPage />);
  const opener = await screen.findByRole('button', { name: '✏️ 編輯' });
  vi.useFakeTimers();
  opener.focus();
  fireEvent.click(opener);
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '等待確認的修改' } });
  fireEvent.change(screen.getByLabelText('內文'), { target: { value: '仍保留的內文' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(screen.getByText(/這次送出仍可能完成，請勿重複送出/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('等待確認的修改');
  expect((screen.getByLabelText('內文') as HTMLTextAreaElement).value).toBe('仍保留的內文');
  expect(screen.getByLabelText('標題').matches(':disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  expect(mocks.updatePost).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  const focused = screen.getByPlaceholderText('輸入留言⋯');
  focused.focus();
  const original = await mocks.getPost.mock.results[0].value;
  mocks.getPost.mockResolvedValue({ ...original, title: '等待確認的修改', content: '仍保留的內文' });
  await act(async () => {
    resolve();
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('等待確認的修改')).toBeTruthy();
  expect(screen.getByText('仍保留的內文')).toBeTruthy();
  expect(document.activeElement).toBe(focused);
  expect(mocks.updatePost).toHaveBeenCalledOnce();
  fireEvent.click(opener);
  expect(screen.getByLabelText('標題').matches(':disabled')).toBe(false);
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '取消後不保留' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(opener);
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('等待確認的修改');
});

it('does not let a previous account edit completion close a new editing session', async () => {
  ownPost();
  let resolve!: () => void;
  mocks.updatePost.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const view = render(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  mocks.auth.user = null;
  view.rerender(<PostDetailPage />);
  await screen.findByText('原標題');
  expect(screen.queryByRole('dialog')).toBeNull();
  mocks.auth.user = { uid: 'alice' };
  view.rerender(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '新一輪編輯' } });
  await act(async () => {
    resolve();
  });
  expect(screen.getByRole('dialog', { name: '編輯貼文' })).toBeTruthy();
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('新一輪編輯');
});

it('saves the complete edit only after activating the save button', async () => {
  ownPost();
  render(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  const title = screen.getByLabelText('標題');
  const tags = screen.getByLabelText('標籤（逗號分隔）');
  const body = screen.getByLabelText('內文');
  const save = screen.getByRole('button', { name: '儲存' });
  fireEvent.change(title, { target: { value: '新標題' } });
  for (const field of [title, tags]) {
    for (const options of [{}, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      expect(fireEvent.keyDown(field, { key: 'Enter', ...options })).toBe(false);
    }
  }
  expect(fireEvent.keyDown(body, { key: 'Enter' })).toBe(true);
  expect(fireEvent.keyDown(body, { key: 'Enter', shiftKey: true })).toBe(true);
  expect(fireEvent.keyDown(save, { key: 'Enter', isComposing: true })).toBe(false);
  expect(fireEvent.keyDown(save, { key: 'Enter' })).toBe(true);
  expect(mocks.updatePost).not.toHaveBeenCalled();
  fireEvent.change(body, { target: { value: '第一行\n第二行' } });
  fireEvent.change(tags, { target: { value: '更新標籤' } });
  await act(async () => fireEvent.click(save));
  expect(mocks.updatePost).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', {
    title: '新標題',
    content: '第一行\n第二行',
    tags: ['更新標籤'],
  });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '✏️ 編輯' }));
});

it.each(['body', 'other control'])('keeps reply Enter multiline and handles %s focus on completion', async (position) => {
  const write = Promise.withResolvers<void>();
  mocks.addReply.mockReturnValueOnce(write.promise);
  ownPost();
  render(<PostDetailPage />);
  const input = await screen.findByPlaceholderText('輸入留言⋯');
  fireEvent.change(input, { target: { value: '第一行\n第二行' } });
  const send = screen.getByRole('button', { name: '送出留言' });
  for (const options of [{}, { shiftKey: true }, { ctrlKey: true }, { isComposing: true }]) {
    expect(fireEvent.keyDown(input, { key: 'Enter', ...options })).toBe(true);
  }
  expect(fireEvent.keyDown(send, { key: 'Enter', isComposing: true })).toBe(false);
  expect(mocks.addReply).not.toHaveBeenCalled();
  fireEvent.click(send);
  const other = screen.getByRole('button', { name: '✏️ 編輯' });
  if (position === 'other control') other.focus();
  else expect(document.activeElement).toBe(document.body);
  await act(async () => write.resolve());
  expect(mocks.addReply).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(position === 'other control' ? other : input);
});
