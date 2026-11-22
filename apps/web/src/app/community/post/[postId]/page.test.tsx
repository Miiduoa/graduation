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
  addCampusReply: mocks.addReply,
  deleteCampusPost: vi.fn(),
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
  mocks.toggleLike.mockReset().mockResolvedValue(undefined);
  mocks.addReply.mockReset().mockResolvedValue(undefined);
  mocks.deleteReply.mockReset().mockResolvedValue(undefined);
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
  expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
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
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '收藏貼文' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
});

function ownPost(title: string | null = '原標題') {
  mocks.getPost.mockResolvedValue({
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

it('holds one edit write, prevents dismissal while pending, and updates the confirmed post', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  fireEvent.pointerDown(dialog, { clientX: -1, clientY: -1 });
  fireEvent.click(dialog, { clientX: -1, clientY: -1 });
  expect(screen.getByRole('dialog', { name: '編輯貼文' })).toBeTruthy();
  await act(async () => {
    resolve();
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('新標題')).toBeTruthy();
  expect(screen.getByText('新內文')).toBeTruthy();
  expect(mocks.getPost).toHaveBeenCalledOnce();
});

it.each(['post', 'replies', 'both'])(
  'keeps a successful reply committed when refreshing %s fails',
  async (failedRead) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
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
    expect(alert).not.toHaveBeenCalled();
  },
);

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

it('keeps a confirmed reply deletion when both reads fail', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mocks.listReplies.mockResolvedValueOnce([
    { id: 'r-1', authorUid: 'alice', content: '我的留言', threadDepth: 0 },
  ]);
  render(<PostDetailPage />);
  const remove = await screen.findByRole('button', { name: /^刪除$/ });
  mocks.getPost.mockRejectedValueOnce(new Error('offline'));
  mocks.listReplies.mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.click(remove));
  expect(mocks.deleteReply).toHaveBeenCalledExactlyOnceWith('pu', 'p-1', 'r-1');
  expect(alert).not.toHaveBeenCalled();
});

it.each(['like', 'reply', 'both'])(
  'keeps the confirmed edit and %s writes when successful stale reads need a refresh that fails',
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

    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('內文'), { target: { value: '已儲存內文' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    mocks.getPost.mockRejectedValue(new Error('offline'));
    await act(async () => resolveReads.forEach((resolve) => resolve(original)));
    expect(mocks.getPost).toHaveBeenCalledTimes(1 + 2 * resolveReads.length);
    expect(mocks.updatePost).toHaveBeenCalledOnce();
    expect(mocks.addReply).toHaveBeenCalledTimes(source === 'like' ? 0 : 1);
    expect(mocks.toggleLike).toHaveBeenCalledTimes(source === 'reply' ? 0 : 1);
    expect(screen.getByText('已儲存內文')).toBeTruthy();
    expect(screen.queryByText('原內文')).toBeNull();
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
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: saved.title } });
    fireEvent.change(screen.getByLabelText('內文'), { target: { value: saved.content } });
    fireEvent.change(screen.getByLabelText('標籤（逗號分隔）'), {
      target: { value: saved.tags.join(', ') },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The stale response may even report a missing post.
    let resolveFresh!: (value: unknown) => void;
    mocks.getPost.mockImplementationOnce(() => new Promise((resolve) => (resolveFresh = resolve)));
    const fresh = { ...original, ...saved, likes: 1, likedBy: ['alice'] };
    mocks.getPost.mockResolvedValue(fresh);
    for (const resolve of resolveReads.reverse()) {
      await act(async () => resolve(source === 'reply' ? null : { ...original, likes: 1 }));
      expect(screen.queryByText('原標題')).toBeNull();
      expect(screen.getByText('新內文')).toBeTruthy();
      expect(screen.getByText('#新標籤')).toBeTruthy();
    }

    fireEvent.click(edit);
    expect(screen.getByLabelText<HTMLInputElement>('標題').value).toBe(saved.title);
    expect(screen.getByLabelText<HTMLTextAreaElement>('內文').value).toBe(saved.content);
    expect(screen.getByLabelText<HTMLInputElement>('標籤（逗號分隔）').value).toBe('新標籤');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => resolveFresh(fresh));
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
  mocks.updatePost.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
  render(<PostDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '✏️ 編輯' }));
  fireEvent.change(screen.getByLabelText('內文'), { target: { value: '保留的修改內容' } });
  fireEvent.change(screen.getByLabelText('標籤（逗號分隔）'), { target: { value: '更新標籤' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await screen.findByText('暫時無法確認儲存結果，修改內容已保留。請先查看貼文，再決定是否重試。');
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
  fireEvent.click(screen.getByRole('button', { name: '先關閉' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('等待確認的修改');
  expect((screen.getByLabelText('內文') as HTMLTextAreaElement).value).toBe('仍保留的內文');
  expect(screen.getByLabelText('標題').matches(':disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  expect(mocks.updatePost).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '先關閉' }));
  const focused = screen.getByPlaceholderText('輸入留言⋯');
  focused.focus();
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
