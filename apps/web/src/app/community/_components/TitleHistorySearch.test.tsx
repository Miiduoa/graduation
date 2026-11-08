import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TitleSearchPage } from '@/lib/community/titleSearch';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false },
  search: vi.fn(), confirm: vi.fn(), navigate: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.navigate }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('@/lib/community/titleSearch', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/community/titleSearch')>(),
  searchCampusPostTitles: mocks.search,
  confirmCampusPostTitleOpen: mocks.confirm,
}));
import { TitleHistorySearch } from './TitleHistorySearch';

function page(ids = ['old-1001'], hasMore = false): TitleSearchPage {
  return {
    posts: ids.map((id) => ({ id, schoolId: 'pu', title: '二手書 ' + id, excerpt: '同學的舊課本', anonymous: true })),
    nextCursor: hasMore ? { schoolId: 'pu', prefix: '二手書', document: { id: ids.at(-1) } } as TitleSearchPage['nextCursor'] : null,
    hasMore,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function submit(prefix = '二手書') {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: prefix } });
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth = { user: { uid: 'alice' }, loading: false };
  mocks.search.mockResolvedValue(page());
  mocks.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

it('does not read until submitted and opens an old post in the same school', async () => {
  render(<TitleHistorySearch schoolId="pu" />);
  expect(mocks.search).not.toHaveBeenCalled();
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  expect(link.getAttribute('href')).toBe('/community/post/old-1001?schoolId=pu');
  expect(mocks.search).toHaveBeenCalledExactlyOnceWith('pu', '二手書', null);
  expect(screen.getByText('匿名貼文')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/只比對標題開頭，不搜尋內文/)).toBeTruthy();
});
it('validates empty input without a request and focuses the input', async () => {
  render(<TitleHistorySearch schoolId="pu" />);
  submit(' ');
  expect(screen.getByRole('alert').textContent).toContain('1 至 80');
  expect(mocks.search).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
});
it('distinguishes an empty successful query from a network failure', async () => {
  mocks.search.mockResolvedValueOnce(page([]));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  expect(await screen.findByText(/目前沒有標題以/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  mocks.search.mockRejectedValueOnce(Object.assign(new Error(), { code: 'unavailable' }));
  submit('租屋');
  await screen.findByRole('button', { name: '重試搜尋' });
  expect(screen.queryByText(/目前沒有標題以/)).toBeNull();
});
it('retries the same cursor after failure, keeps cards and deduplicates repeated results', async () => {
  const first = page(['old-1'], true);
  mocks.search.mockResolvedValueOnce(first)
    .mockRejectedValueOnce(Object.assign(new Error(), { code: 'unavailable' }))
    .mockResolvedValueOnce(page(['old-1', 'old-2']));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '載入更多符合的標題' }));
  fireEvent.click(await screen.findByRole('button', { name: '重試下一頁' }));
  await screen.findByRole('link', { name: '二手書 old-2' });
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(mocks.search.mock.calls[1][2]).toBe(first.nextCursor);
  expect(mocks.search.mock.calls[2][2]).toBe(first.nextCursor);
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '二手書');
});
it('ignores repeated submits while a request is pending', async () => {
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockReturnValueOnce(pending.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
  expect(mocks.search).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '搜尋歷史標題' }).getAttribute('aria-busy')).toBe('true');
  await act(async () => pending.resolve(page()));
});
it.each(['success', 'denied'])('editing isolates an older %s response', async (outcome) => {
  const old = deferred<TitleSearchPage>();
  mocks.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(['new-result']));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  submit('新的開頭');
  await screen.findByRole('link', { name: '二手書 new-result' });
  await act(async () => {
    if (outcome === 'success') old.resolve(page(['stale']));
    else old.reject(Object.assign(new Error(), { code: 'permission-denied' }));
  });
  expect(screen.queryByText('二手書 stale')).toBeNull();
  expect(screen.getByRole('link', { name: '二手書 new-result' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['school', 'account'])('clears old results and fences pending requests after %s changes', async (scope) => {
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockResolvedValueOnce(page(['old'], true)).mockReturnValueOnce(pending.promise);
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '載入更多符合的標題' }));
  if (scope === 'account') mocks.auth.user = { uid: 'bob' };
  view.rerender(<TitleHistorySearch schoolId={scope === 'school' ? 'other' : 'pu'} />);
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
  await act(async () => pending.resolve(page(['stale'])));
  expect(screen.queryByRole('article')).toBeNull();
});
it('clears old cards on denied continuation and permits an explicitly retried first page', async () => {
  mocks.search.mockResolvedValueOnce(page(['old'], true))
    .mockRejectedValueOnce(Object.assign(new Error(), { code: 'permission-denied' }))
    .mockResolvedValueOnce(page(['restored']));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const button = await screen.findByRole('button', { name: '載入更多符合的標題' });
  button.focus();
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', { name: '重新驗證並搜尋' }));
  await screen.findByText('二手書 restored');
  expect(screen.queryByText('二手書 old')).toBeNull();
  expect(mocks.search.mock.calls[2][2]).toBeNull();
});
it('moves final-page focus to the result status even for a quickly resolved response', async () => {
  mocks.search.mockResolvedValueOnce(page(['old'], true)).mockResolvedValueOnce(page(['last']));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const button = await screen.findByRole('button', { name: '載入更多符合的標題' });
  button.focus(); fireEvent.click(button);
  await screen.findByText('二手書 last');
  expect(document.activeElement).toBe(screen.getByRole('status'));
});
it('does not steal focus from search input when the last page arrives', async () => {
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockResolvedValueOnce(page(['old'], true)).mockReturnValueOnce(pending.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '載入更多符合的標題' }));
  screen.getByRole('searchbox').focus();
  await act(async () => pending.resolve(page(['last'])));
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
});
it('clears both results and pending delivery and restores input focus', async () => {
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockReturnValueOnce(pending.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(screen.getByRole('button', { name: '清除' }));
  await act(async () => pending.resolve(page()));
  expect(screen.queryByRole('article')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
});
it('waits for authentication and never searches as a signed-out student', async () => {
  mocks.auth.loading = true;
  const view = render(<TitleHistorySearch schoolId="pu" />);
  expect(screen.queryByRole('searchbox')).toBeNull();
  mocks.auth = { user: null, loading: false };
  view.rerender(<TitleHistorySearch schoolId="pu" />);
  await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
  expect(mocks.search).not.toHaveBeenCalled();
});

it('prevents opening a deleted result and does not navigate to an invalid old post', async () => {
  mocks.confirm.mockResolvedValueOnce(false);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  fireEvent.click(link);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith('pu', 'old-1001'));
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: '二手書 old-1001' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('已刪除');
});
it('verifies permission before navigation; revoked membership clears the old list', async () => {
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('權限');
});
it('does not navigate offline, keeps the result for a fresh on-demand retry', async () => {
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  fireEvent.click(link);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '二手書 old-1001' })).toBeTruthy();
  fireEvent.click(link);
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/community/post/old-1001?schoolId=pu'));
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
});
