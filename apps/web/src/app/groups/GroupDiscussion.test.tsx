import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GroupDiscussionPage from './[groupId]/page';
import {
  createGroupDiscussionPost,
  loadGroupDiscussionPage,
  type GroupDiscussionPost,
} from './groupDiscussionService';

const account = vi.hoisted(() => ({
  user: { uid: 'alice', displayName: 'Alice' } as {
    uid: string;
    displayName?: string | null;
  } | null,
  loading: false,
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('./groupDiscussionService', async () => {
  const actual = await vi.importActual<typeof import('./groupDiscussionService')>(
    './groupDiscussionService',
  );
  return {
    ...actual,
    loadGroupDiscussionPage: vi.fn(),
    createGroupDiscussionPost: vi.fn(),
    updateGroupDiscussionPost: vi.fn(),
    deleteGroupDiscussionPost: vi.fn(),
  };
});

const group = {
  id: 'g1',
  schoolId: 'pu',
  name: '攝影社',
  description: '',
  type: 'club' as const,
  role: 'member',
  memberCount: 4,
};

const post: GroupDiscussionPost = {
  id: 'p1',
  groupId: 'g1',
  kind: 'post',
  title: '週三外拍',
  body: '中午校門口集合',
  authorId: 'alice',
  authorName: 'Alice',
  schoolId: 'pu',
  createdAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  const params = Promise.resolve({ groupId: 'g1' });
  const searchParams = Promise.resolve({ schoolId: 'pu' });
  return render(
    <Suspense>
      <GroupDiscussionPage params={params} searchParams={searchParams} />
    </Suspense>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  account.user = { uid: 'alice', displayName: 'Alice' };
  account.loading = false;
  sessionStorage.clear();
  vi.mocked(loadGroupDiscussionPage).mockResolvedValue({
    group,
    page: { posts: [post], cursor: null, hasMore: false },
  });
  vi.mocked(createGroupDiscussionPost).mockResolvedValue({
    ...post,
    id: 'p-new',
    title: '新貼文',
    body: '內容',
  });
});

it('requires school Firebase account and does not invent posts while loading', async () => {
  account.user = null;
  await act(async () => {
    renderPage();
  });
  expect(screen.getByRole('link', { name: '登入學校帳號' })).toBeTruthy();
  expect(loadGroupDiscussionPage).not.toHaveBeenCalled();
});

it('lists authorized posts and recovers draft after a failed publish', async () => {
  const failed = deferred<GroupDiscussionPost>();
  vi.mocked(createGroupDiscussionPost).mockReturnValueOnce(failed.promise);
  await act(async () => {
    renderPage();
  });
  await screen.findByText('週三外拍');
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '草稿標題' } });
  fireEvent.change(screen.getByLabelText('內容'), { target: { value: '草稿內容' } });
  fireEvent.click(screen.getByRole('button', { name: '發布' }));
  await act(async () => failed.reject(new Error('offline')));
  expect(screen.getByRole('alert').textContent).toMatch(/尚未確認|原稿已保留/);
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('草稿標題');
  expect((screen.getByLabelText('內容') as HTMLTextAreaElement).value).toBe('草稿內容');
  expect(screen.getByRole('button', { name: '重試確認' })).toBeTruthy();
  expect(createGroupDiscussionPost).toHaveBeenCalledWith(
    'alice',
    'pu',
    'g1',
    expect.objectContaining({
      title: '草稿標題',
      body: '草稿內容',
      postId: expect.any(String),
    }),
    expect.any(Function),
    'Alice',
  );
});

it('leave during publish keeps the same intent so remount retry confirms one post', async () => {
  const first = deferred<GroupDiscussionPost>();
  vi.mocked(createGroupDiscussionPost).mockReturnValueOnce(first.promise);
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = renderPage();
  });
  await screen.findByText('週三外拍');
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '外拍集合' } });
  fireEvent.change(screen.getByLabelText('內容'), { target: { value: '週三中午' } });
  fireEvent.click(screen.getByRole('button', { name: '發布' }));
  const firstCall = vi.mocked(createGroupDiscussionPost).mock.calls[0]!;
  const intentId = (firstCall[3] as { postId: string }).postId;
  const firstScope = firstCall[4];
  account.user = null;
  await act(async () => {
    view.rerender(
      <Suspense>
        <GroupDiscussionPage
          params={Promise.resolve({ groupId: 'g1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(screen.getByRole('link', { name: '登入學校帳號' })).toBeTruthy();
  expect(firstScope()).toBe(false);
  await act(async () =>
    first.resolve({
      ...post,
      id: intentId,
      title: '外拍集合',
      body: '週三中午',
    }),
  );
  expect(screen.queryByText('外拍集合')).toBeNull();

  account.user = { uid: 'alice', displayName: 'Alice' };
  vi.mocked(loadGroupDiscussionPage).mockResolvedValueOnce({
    group,
    page: {
      posts: [{ ...post, id: intentId, title: '外拍集合', body: '週三中午' }],
      cursor: null,
      hasMore: false,
    },
  });
  vi.mocked(createGroupDiscussionPost).mockResolvedValueOnce({
    ...post,
    id: intentId,
    title: '外拍集合',
    body: '週三中午',
  });
  await act(async () => {
    view.rerender(
      <Suspense>
        <GroupDiscussionPage
          params={Promise.resolve({ groupId: 'g1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  await screen.findByText('外拍集合');
  // 鎖定意圖自 sessionStorage 恢復；重試必須使用同一 postId，不可自動換新。
  fireEvent.click(screen.getByRole('button', { name: '重試確認' }));
  await waitFor(() =>
    expect(createGroupDiscussionPost).toHaveBeenLastCalledWith(
      'alice',
      'pu',
      'g1',
      expect.objectContaining({ title: '外拍集合', body: '週三中午', postId: intentId }),
      expect.any(Function),
      'Alice',
    ),
  );
  expect(
    vi
      .mocked(createGroupDiscussionPost)
      .mock.calls.filter((call) => (call[3] as { postId: string }).postId === intentId),
  ).toHaveLength(2);
});

it('conflict never auto-mints a new id; uncertain edits cannot overwrite locked intent', async () => {
  const intentId = 'locked-intent';
  sessionStorage.setItem(
    'campus-one:group-draft:pu:g1:alice',
    JSON.stringify({
      intent: { postId: intentId, title: '原稿標題', body: '原稿內容', kind: 'post' },
      phase: 'conflict',
    }),
  );
  vi.mocked(createGroupDiscussionPost).mockRejectedValueOnce(new Error('Post intent conflict'));
  await act(async () => {
    renderPage();
  });
  await screen.findByText('週三外拍');
  expect(screen.getByDisplayValue('原稿標題')).toBeTruthy();
  expect((screen.getByLabelText('標題') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重試確認' }));
  await screen.findByText(/請先查看討論列表/);
  expect(createGroupDiscussionPost).toHaveBeenCalledTimes(1);
  expect(createGroupDiscussionPost).toHaveBeenCalledWith(
    'alice',
    'pu',
    'g1',
    expect.objectContaining({ postId: intentId, title: '原稿標題', body: '原稿內容' }),
    expect.any(Function),
    'Alice',
  );
  // 明確開始新貼文後才換意圖
  fireEvent.click(screen.getByRole('button', { name: '開始新貼文' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '新意圖標題' } });
  fireEvent.change(screen.getByLabelText('內容'), { target: { value: '新意圖內容' } });
  vi.mocked(createGroupDiscussionPost).mockResolvedValueOnce({
    ...post,
    id: 'brand-new',
    title: '新意圖標題',
    body: '新意圖內容',
  });
  fireEvent.click(screen.getByRole('button', { name: '發布' }));
  await waitFor(() =>
    expect(createGroupDiscussionPost).toHaveBeenLastCalledWith(
      'alice',
      'pu',
      'g1',
      expect.objectContaining({
        title: '新意圖標題',
        body: '新意圖內容',
        postId: expect.not.stringMatching(intentId),
      }),
      expect.any(Function),
      'Alice',
    ),
  );
});

it('ignores stale discussion results after account switch', async () => {
  const slow = deferred<Awaited<ReturnType<typeof loadGroupDiscussionPage>>>();
  vi.mocked(loadGroupDiscussionPage).mockReturnValueOnce(slow.promise);
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = renderPage();
  });
  account.user = { uid: 'bob', displayName: 'Bob' };
  vi.mocked(loadGroupDiscussionPage).mockResolvedValueOnce({
    group: { ...group, name: 'Bob 的群組' },
    page: { posts: [], cursor: null, hasMore: false },
  });
  await act(async () => {
    view.rerender(
      <Suspense>
        <GroupDiscussionPage
          params={Promise.resolve({ groupId: 'g1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  await screen.findByText('尚無貼文');
  await act(async () =>
    slow.resolve({
      group: { ...group, name: '舊帳號群組' },
      page: {
        posts: [{ ...post, title: '不該出現的貼文' }],
        cursor: null,
        hasMore: false,
      },
    }),
  );
  expect(screen.queryByText('不該出現的貼文')).toBeNull();
});

it('paginates discussion history without dropping the first page', async () => {
  vi.mocked(loadGroupDiscussionPage)
    .mockResolvedValueOnce({
      group,
      page: {
        posts: [post],
        cursor: { id: 'cursor' } as never,
        hasMore: true,
      },
    })
    .mockResolvedValueOnce({
      group,
      page: {
        posts: [{ ...post, id: 'p2', title: '更早的貼文' }],
        cursor: null,
        hasMore: false,
      },
    });
  await act(async () => {
    renderPage();
  });
  await screen.findByText('週三外拍');
  fireEvent.click(screen.getByRole('button', { name: '載入更早的貼文' }));
  await screen.findByText('更早的貼文');
  expect(screen.getByText('週三外拍')).toBeTruthy();
  expect(loadGroupDiscussionPage).toHaveBeenCalledTimes(2);
});

it('keeps the visible draft and does not dispatch when the publication record cannot be saved', async () => {
  await act(async () => { renderPage(); });
  await screen.findByText('週三外拍');
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  });
  try {
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: '需保留標題' } });
    fireEvent.change(screen.getByLabelText('內容'), { target: { value: '需保留內容' } });
    fireEvent.click(screen.getByRole('button', { name: '發布' }));
    expect(createGroupDiscussionPost).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('尚未送出貼文');
    expect((screen.getByLabelText('內容') as HTMLTextAreaElement).value).toBe('需保留內容');
    expect((screen.getByLabelText('內容') as HTMLTextAreaElement).disabled).toBe(false);
  } finally {
    storage.mockRestore();
  }
});
