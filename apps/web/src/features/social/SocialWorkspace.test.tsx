import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { SocialWorkspace } from './SocialWorkspace';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  context: 'a'.repeat(43),
  account: 'account-a',
  school: null as string | null,
  authenticated: true,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => <p>選擇瀏覽校園</p> }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({ selectedSchoolId: mocks.school }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: mocks.authenticated
      ? { platformAccountId: mocks.account, context: mocks.context }
      : null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: mocks.refresh,
  }),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  socialRequest: (...args: unknown[]) => mocks.request(...args),
}));
const board = {
  tenantId: 'school-a',
  tenantName: '甲大學',
  id: 'board-a',
  name: '校際交流',
  description: null,
  canPost: true,
};
const post = {
  id: 'post-a',
  tenantId: 'school-a',
  tenantName: '甲大學',
  communityId: 'board-a',
  communityName: '校際交流',
  text: '來自甲校的公開內容',
  author: { displayName: '陳同學', isSelf: false },
  publishedAt: '2026-10-08T08:00:00.000000Z',
  version: 1,
};
beforeEach(() => {
  mocks.context = 'a'.repeat(43);
  mocks.account = 'account-a';
  mocks.school = null;
  mocks.authenticated = true;
  mocks.refresh.mockReset();
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (path === 'boards') return { items: [board] };
    if (path.startsWith('feed')) return { items: [post], nextCursor: null };
    if (path === 'blocks' || path === 'reports') return { items: [] };
    throw new Error(`Unexpected ${path}`);
  });
});

it('requires the real platform session and shows no invented public feed for guests', () => {
  mocks.authenticated = false;
  render(<SocialWorkspace />);
  expect(screen.getByRole('heading', { name: '登入後參與公開交流' })).toBeTruthy();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('filters by selected school without granting membership or retaining the old feed while a response is pending', async () => {
  const view = render(<SocialWorkspace />);
  await screen.findByText(post.text);
  let resolve: (value: unknown) => void = () => {};
  mocks.request.mockImplementation(async (path: string) =>
    path === 'feed?tenantId=school-b'
      ? new Promise((value) => {
          resolve = value;
        })
      : { items: [board] },
  );
  mocks.school = 'school-b';
  view.rerender(<SocialWorkspace />);
  expect(screen.queryByText(post.text)).toBeNull();
  expect(screen.getByText('選校只會篩選公開看板，不會取得校籍或校務權限。')).toBeTruthy();
  expect(
    screen.getByText('目前範圍還沒有公開看板。可以切換校園，或選擇「不限校園」。'),
  ).toBeTruthy();
  await act(async () => resolve({ items: [], nextCursor: null }));
  expect(await screen.findByRole('heading', { name: '還沒有公開貼文' })).toBeTruthy();
});

it('locks synchronous submit and reuses the idempotency key after an uncertain response without losing the draft', async () => {
  const view = render(<SocialWorkspace />);
  await screen.findByLabelText('發表看板');
  fireEvent.change(screen.getByLabelText('發表看板'), { target: { value: 'school-a/board-a' } });
  fireEvent.change(screen.getByLabelText('貼文內容'), { target: { value: '第一次公開發表' } });
  let reject: (error: unknown) => void = () => {};
  mocks.request.mockImplementation(async (path: string) =>
    path === 'posts'
      ? new Promise((_, fail) => {
          reject = fail;
        })
      : path === 'boards'
        ? { items: [board] }
        : { items: [], nextCursor: null },
  );
  const form = screen.getByLabelText('貼文內容').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.request.mock.calls.filter((call) => call[0] === 'posts')).toHaveLength(1);
  const firstKey = mocks.request.mock.calls.find((call) => call[0] === 'posts')?.[2].idempotencyKey;
  await act(async () => reject(new Error('lost response')));
  expect((screen.getByLabelText('貼文內容') as HTMLTextAreaElement).value).toBe('第一次公開發表');
  expect(screen.queryByText('已公開發表。')).toBeNull();
  mocks.request.mockImplementation(async (path: string) =>
    path === 'posts'
      ? { ...post, text: '第一次公開發表', author: { displayName: '我', isSelf: true } }
      : { items: [], nextCursor: null },
  );
  fireEvent.submit(form);
  await screen.findByText('已公開發表。');
  const calls = mocks.request.mock.calls.filter((call) => call[0] === 'posts');
  expect(calls).toHaveLength(2);
  expect(calls[1]?.[2].idempotencyKey).toBe(firstKey);
  expect((screen.getByLabelText('貼文內容') as HTMLTextAreaElement).value).toBe('');
  view.unmount();
});

it('discards an old account response and draft synchronously when the session changes', async () => {
  let resolve: (value: unknown) => void = () => {};
  mocks.request.mockImplementation(async (path: string) =>
    path === 'boards'
      ? { items: [board] }
      : new Promise((value) => {
          resolve = value;
        }),
  );
  const view = render(<SocialWorkspace />);
  await screen.findByLabelText('貼文內容');
  fireEvent.change(screen.getByLabelText('貼文內容'), { target: { value: '帳號甲的私人草稿' } });
  const oldResolve = resolve;
  mocks.context = 'b'.repeat(43);
  mocks.account = 'account-b';
  mocks.request.mockImplementation(async (path: string) =>
    path === 'boards' ? { items: [board] } : { items: [], nextCursor: null },
  );
  view.rerender(<SocialWorkspace />);
  expect(screen.queryByDisplayValue('帳號甲的私人草稿')).toBeNull();
  await act(async () => oldResolve({ items: [post], nextCursor: null }));
  expect(screen.queryByText(post.text)).toBeNull();
});

it('records a report only after confirmation from the server and shows persistent status', async () => {
  render(<SocialWorkspace />);
  const article = await screen.findByRole('article', { name: '陳同學的公開貼文' });
  fireEvent.click(within(article).getByRole('button', { name: '檢舉' }));
  fireEvent.change(screen.getByLabelText('檢舉原因'), { target: { value: 'privacy' } });
  mocks.request.mockImplementation(async (path: string, _context: string, input?: object) => {
    if (path === 'reports') {
      const report = {
        id: 'report-a',
        tenantId: post.tenantId,
        postId: post.id,
        state: input ? 'open' : 'hidden',
        version: 1,
        reason: 'privacy',
        createdAt: post.publishedAt,
      };
      return input ? report : { items: [report] };
    }
    return { items: [] };
  });
  fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
  await screen.findByText('已記錄你的檢舉。處理狀態可在「封鎖與檢舉」查看。');
  fireEvent.click(screen.getByRole('button', { name: '封鎖與檢舉' }));
  await screen.findByText('洩漏個人資料 · 已隱藏貼文');
});

it('removes public data and draft after the server rejects the session', async () => {
  render(<SocialWorkspace />);
  await screen.findByText(post.text);
  fireEvent.change(screen.getByLabelText('貼文內容'), { target: { value: '未送出的草稿' } });
  mocks.request.mockRejectedValue(new NuniError(401, 'PLATFORM_SESSION_INVALID'));
  fireEvent.click(screen.getByRole('button', { name: '更新動態' }));
  await screen.findByRole('heading', { name: '請重新確認登入' });
  expect(screen.queryByText(post.text)).toBeNull();
  expect(screen.queryByDisplayValue('未送出的草稿')).toBeNull();
  await waitFor(() => expect(screen.queryByRole('button', { name: '公開發表' })).toBeNull());
});
