import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { materialBookmarkStorageKey, type MaterialBookmark } from '@campus/shared/src/materialBookmarks';
import { MATERIAL_READ_KEY_PREFIX } from '@/lib/courseMaterials';
import { CourseMaterials } from './CourseMaterials';
import { MaterialBookmarks } from './MaterialBookmarks';

const state = vi.hoisted(() => ({
  request: vi.fn(), refresh: vi.fn(), push: vi.fn(), account: 0, context: 'session-a', pendingLogout: false,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: { context: state.context, platformAccountId: `bookmark-account-${state.account}` },
    pendingLogout: state.pendingLogout,
    refresh: state.refresh,
  }),
}));

const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111', title: '資料庫', state: 'active', memberRole: 'student',
};
const material: NuniMaterial = {
  id: 'cwm_11111111-1111-4111-8111-111111111111', workspaceId: workspace.id,
  title: '關聯與主鍵', body: '關聯模型閱讀說明', unitId: 'cwu_11111111-1111-4111-8111-111111111111', unitTitle: '第三週',
  createdByPlatformAccountId: 'pa_11111111-1111-4111-8111-111111111111', createdAt: '2026-10-08T08:00:00.000Z',
};
const bookmark: MaterialBookmark = {
  courseId: workspace.id, materialId: material.id, savedAt: '2026-11-01T08:00:00.000Z',
};
const page = (materials = [material]) => ({ materials, nextCursor: null });
const storageKey = () => materialBookmarkStorageKey(`bookmark-account-${state.account}`);
const persist = (items = [bookmark]) => localStorage.setItem(storageKey(), JSON.stringify({ version: 1, items }));

beforeEach(() => {
  state.account += 1;
  state.context = 'session-a';
  state.pendingLogout = false;
  state.push.mockReset();
  state.refresh.mockReset();
  state.request.mockReset().mockResolvedValue(page());
  window.history.replaceState(null, '', '/');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('keeps reading separate, saves only identity and time, and restores the bookmark after reopening', async () => {
  const view = render(<CourseMaterials workspace={workspace} />);
  const save = await screen.findByRole('button', { name: `加入「${material.title}」的此裝置收藏` });
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '閱讀' }));
  expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem(`${MATERIAL_READ_KEY_PREFIX}bookmark-account-${state.account}`)).not.toBeNull();
  fireEvent.click(save);
  expect(screen.getByText('收藏中…')).toBeTruthy();
  expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(await screen.findByText('已加入此裝置收藏，可從收藏清單再開啟。')).toBeTruthy();
  const stored = JSON.parse(localStorage.getItem(storageKey())!);
  expect(stored.items).toEqual([{ courseId: workspace.id, materialId: material.id, savedAt: expect.any(String) }]);
  expect(screen.getByRole('link', { name: '此裝置收藏' }).getAttribute('href')).toBe('/classroom/material-bookmarks');
  view.unmount();
  render(<MaterialBookmarks />);
  const row = await screen.findByRole('article', { name: material.title });
  expect(within(row).getByText('第三週')).toBeTruthy();
  expect(within(row).getByRole('button', { name: `開啟「${material.title}」原教材` })).toBeTruthy();
});

it('does not report success on a storage failure and offers a working retry', async () => {
  render(<CourseMaterials workspace={workspace} />);
  const save = await screen.findByRole('button', { name: `加入「${material.title}」的此裝置收藏` });
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  fireEvent.click(save);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('已加入此裝置收藏，可從收藏清單再開啟。')).toBeNull();
  expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem(storageKey())).toBeNull();
  expect(screen.getByRole('button', { name: '重新讀取收藏' })).toBeTruthy();
  write.mockRestore();
  fireEvent.click(save);
  expect(await screen.findByText('已加入此裝置收藏，可從收藏清單再開啟。')).toBeTruthy();
});

it('isolates card and list state when the account changes without changing the context', async () => {
  persist();
  const view = render(<><CourseMaterials workspace={workspace} /><MaterialBookmarks /></>);
  await screen.findByRole('button', { name: `開啟「${material.title}」原教材` });
  const firstAccount = state.account;
  state.account += 1;
  view.rerender(<><CourseMaterials workspace={workspace} /><MaterialBookmarks /></>);
  expect(await screen.findByRole('heading', { name: '還沒有收藏的教材' })).toBeTruthy();
  const save = await screen.findByRole('button', { name: `加入「${material.title}」的此裝置收藏` });
  expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('button', { name: `開啟「${material.title}」原教材` })).toBeNull();
  expect(JSON.parse(localStorage.getItem(materialBookmarkStorageKey(`bookmark-account-${firstAccount}`))!).items).toEqual([bookmark]);
});

it('shows an empty state with a next step and hides the list while logout is pending', async () => {
  const view = render(<MaterialBookmarks />);
  expect(await screen.findByRole('heading', { name: '還沒有收藏的教材' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '到我的課程找教材' }).getAttribute('href')).toBe('/classroom');
  expect(state.request).not.toHaveBeenCalled();
  state.pendingLogout = true;
  view.rerender(<MaterialBookmarks />);
  expect(screen.queryByRole('heading', { name: '此裝置收藏' })).toBeNull();
});

it('freshly validates before navigation and uses the original material landing URL', async () => {
  persist();
  render(<MaterialBookmarks />);
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  expect(screen.getByText('正在確認權限，確認後會開啟原教材…')).toBeTruthy();
  await waitFor(() => expect(state.push).toHaveBeenCalledWith(`/classroom/course/${workspace.id}?view=materials#material-${material.id}`));
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.request).toHaveBeenLastCalledWith(`class-workspaces/${workspace.id}/materials/page`, 'session-a', undefined);
});

it('keeps course context through the saved list, original material and empty-list return', async () => {
  const context = { campus: 'tw-pu', q: '資料庫', courses: 'studying', task: 'feedback', taskCourse: workspace.id };
  const query = new URLSearchParams({ ...context, view: 'members', returnTo: 'https://example.test' });
  window.history.replaceState({}, '', `/classroom/material-bookmarks?${query}#old-target`);
  persist();
  render(<MaterialBookmarks />);
  const back = new URL(screen.getByRole('link', { name: '回我的課程' }).getAttribute('href')!, window.location.origin);
  expect(back.pathname).toBe('/classroom');
  expect(Object.fromEntries(back.searchParams)).toEqual(context);
  expect(back.hash).toBe('');
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  await waitFor(() => expect(state.push).toHaveBeenCalledTimes(1));
  const destination = new URL(state.push.mock.calls[0][0], window.location.origin);
  expect(destination.pathname).toBe(`/classroom/course/${workspace.id}`);
  expect(Object.fromEntries(destination.searchParams)).toEqual({ ...context, view: 'materials' });
  expect(destination.hash).toBe(`#material-${material.id}`);
  fireEvent.click(screen.getByRole('button', { name: `移除「${material.title}」的此裝置收藏` }));
  await screen.findByRole('heading', { name: '還沒有收藏的教材' });
  expect(screen.getByRole('link', { name: '到我的課程找教材' }).getAttribute('href')).toBe(back.pathname + back.search);
});

it('uses current URL context for return links even when a saved material cannot be read', async () => {
  window.history.replaceState({}, '', '/classroom/material-bookmarks?q=資料庫&courses=studying');
  persist();
  state.request.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  const view = render(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: '暫時無法讀取教材' });
  window.history.replaceState({}, '', '/classroom/material-bookmarks?q=互動&courses=teaching&schoolId=pu');
  view.rerender(<MaterialBookmarks />);
  const back = new URL(screen.getByRole('link', { name: '回我的課程' }).getAttribute('href')!, window.location.origin);
  expect(Object.fromEntries(back.searchParams)).toEqual({ schoolId: 'pu', q: '互動', courses: 'teaching' });
});

it('discards a late open when history replaces the return context, then opens with the new context', async () => {
  window.history.replaceState({}, '', '/classroom/material-bookmarks?q=資料庫&courses=studying');
  persist();
  let finish!: (value: unknown) => void;
  state.request.mockResolvedValueOnce(page()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<MaterialBookmarks />);
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  window.history.replaceState({}, '', '/classroom/material-bookmarks?q=互動&courses=teaching');
  view.rerender(<MaterialBookmarks />);
  await act(async () => finish(page()));
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  await waitFor(() => expect(state.push).toHaveBeenCalledTimes(1));
  const destination = new URL(state.push.mock.calls[0][0], window.location.origin);
  expect(Object.fromEntries(destination.searchParams)).toEqual({ q: '互動', courses: 'teaching', view: 'materials' });
});

it('removes stale metadata and refuses navigation when permission is revoked after listing', async () => {
  persist();
  state.request.mockResolvedValueOnce(page()).mockRejectedValue(new NuniError(403, 'CLASS_WORKSPACE_MEMBER_REQUIRED'));
  render(<MaterialBookmarks />);
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
  await screen.findByRole('heading', { name: '教材目前無法查看' });
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移除這份教材的此裝置收藏' }));
  await screen.findByRole('heading', { name: '還沒有收藏的教材' });
  expect(JSON.parse(localStorage.getItem(storageKey())!).items).toEqual([]);
});

it('revalidates on focus and removes content from revoked access', async () => {
  persist();
  render(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: material.title });
  state.request.mockRejectedValue(new NuniError(403, 'CLASS_WORKSPACE_MEMBER_REQUIRED'));
  fireEvent(window, new Event('focus'));
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
  await screen.findByRole('heading', { name: '教材目前無法查看' });
  expect(state.request).toHaveBeenCalledTimes(2);
});

it('does not navigate after a pending open finishes in the background', async () => {
  persist();
  let finish!: (value: unknown) => void;
  state.request.mockResolvedValueOnce(page()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<MaterialBookmarks />);
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => finish(page()));
  expect(state.push).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByRole('heading', { name: material.title });
  expect(state.push).not.toHaveBeenCalled();
});

it('keeps deleted materials removable and preserves the item when removal cannot be saved', async () => {
  persist();
  state.request.mockResolvedValue(page([]));
  render(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: '教材目前無法查看' });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  fireEvent.click(screen.getByRole('button', { name: '移除這份教材的此裝置收藏' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: '教材目前無法查看' })).toBeTruthy();
  expect(screen.queryByText('已移除此裝置收藏。')).toBeNull();
  expect(JSON.parse(localStorage.getItem(storageKey())!).items).toEqual([bookmark]);
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '移除這份教材的此裝置收藏' }));
  await screen.findByRole('heading', { name: '還沒有收藏的教材' });
  expect(await screen.findByText('已移除此裝置收藏。')).toBeTruthy();
});

it('restarts an interrupted verification if removing the bookmark fails', async () => {
  persist();
  let finish!: (value: unknown) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(page());
  render(<MaterialBookmarks />);
  const remove = await screen.findByRole('button', { name: '移除這份教材的此裝置收藏' });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  fireEvent.click(remove);
  await screen.findByRole('alert');
  expect(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` })).toBeTruthy();
  expect(state.request).toHaveBeenCalledTimes(2);
  await act(async () => finish(page([])));
  expect(screen.getByRole('heading', { name: material.title })).toBeTruthy();
  write.mockRestore();
});

it('offers retry after a network error without treating it as a missing material', async () => {
  persist();
  state.request.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(page());
  render(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: '暫時無法讀取教材' });
  expect(screen.queryByRole('heading', { name: '教材目前無法查看' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認教材權限' }));
  await screen.findByRole('heading', { name: material.title });
  expect(state.push).not.toHaveBeenCalled();
});

it('discards an old account response after an account switch', async () => {
  persist();
  let finish!: (value: unknown) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<MaterialBookmarks />);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  state.account += 1;
  state.context = 'session-b';
  view.rerender(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: '還沒有收藏的教材' });
  await act(async () => finish(page()));
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
  expect(state.push).not.toHaveBeenCalled();
});

it('cancels an old session open and only shows material resolved in the new session', async () => {
  persist();
  let finish!: (value: unknown) => void;
  state.request.mockResolvedValueOnce(page())
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue(page([{ ...material, title: '新版教材' }]));
  const view = render(<MaterialBookmarks />);
  fireEvent.click(await screen.findByRole('button', { name: `開啟「${material.title}」原教材` }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  state.context = 'session-b';
  view.rerender(<MaterialBookmarks />);
  await screen.findByRole('heading', { name: '新版教材' });
  await act(async () => finish(page()));
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
  expect(state.push).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenLastCalledWith(`class-workspaces/${workspace.id}/materials/page`, 'session-b', undefined);
});

it('limits simultaneous validations and skips removed queued bookmarks', async () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ ...bookmark, courseId: `cw_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, materialId: `saved-${index}` }));
  persist(items);
  const finish: Array<(value: unknown) => void> = [];
  state.request.mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
  const view = render(<MaterialBookmarks />);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
  const rows = screen.getAllByRole('article');
  fireEvent.click(within(rows[3]).getByRole('button', { name: '移除這份教材的此裝置收藏' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(6));
  await act(async () => finish[0](page([])));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(4));
  view.unmount();
  await act(async () => { finish.slice(1).forEach((resolve) => resolve(page([]))); });
  expect(state.request).toHaveBeenCalledTimes(4);
});

it.each([50, 100, 500])('同課程 %s 份收藏每頁只讀一次，更新清單重新讀取', async (count) => {
  const materials = Array.from({ length: count }, (_, index) => ({ ...material, id: `cwm_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, title: `教材 ${index}` }));
  persist(materials.map((item) => ({ ...bookmark, materialId: item.id })));
  state.request.mockImplementation(async (_path, _context, _input, _method, query) => {
    const offset = Number(query?.cursor ?? 0);
    return { materials: materials.slice(offset, offset + 50), nextCursor: offset + 50 < count ? String(offset + 50) : null };
  });
  render(<MaterialBookmarks />);
  await screen.findByText(`教材 ${count - 1}`, {}, { timeout: 20000 });
  expect(document.querySelectorAll('button[aria-label^="開啟「教材"]')).toHaveLength(count);
  expect(state.request).toHaveBeenCalledTimes(count / 50);
  fireEvent.click(screen.getByRole('button', { name: '更新收藏' }));
  await screen.findByText(`教材 ${count - 1}`, {}, { timeout: 20000 });
  expect(state.request).toHaveBeenCalledTimes(count / 50 * 2);
}, 60000);
