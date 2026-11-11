import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TitleSearchPage } from '@/lib/community/titleSearch';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false },
  search: vi.fn(), resume: vi.fn(), confirm: vi.fn(), navigate: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.navigate }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('@/lib/community/titleSearch', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/community/titleSearch')>(),
  searchCampusPostTitles: mocks.search,
  resumeCampusPostTitles: mocks.resume,
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
  window.sessionStorage.clear();
  mocks.resume.mockResolvedValue(page());
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
it('opens an already visible post while its next page is pending', async () => {
  const nextPage = deferred<TitleSearchPage>();
  const confirmation = deferred<boolean>();
  mocks.search.mockResolvedValueOnce(page(['old-1001'], true))
    .mockReturnValueOnce(nextPage.promise);
  mocks.confirm.mockReturnValueOnce(confirmation.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '載入更多符合的標題' }));
  fireEvent.click(screen.getByRole('link', { name: '二手書 old-1001' }));
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith('pu', 'old-1001');
  await act(async () => nextPage.resolve(page(['stale-delivery'])));
  expect(screen.queryByRole('link', { name: '二手書 stale-delivery' })).toBeNull();
  await act(async () => confirmation.resolve(true));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/community/post/old-1001?schoolId=pu');
});
it('can retry the interrupted cursor after an offline post confirmation', async () => {
  const nextPage = deferred<TitleSearchPage>();
  const first = page(['old-1001'], true);
  mocks.search.mockResolvedValueOnce(first)
    .mockReturnValueOnce(nextPage.promise)
    .mockResolvedValueOnce(page(['old-1002']));
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '載入更多符合的標題' }));
  fireEvent.click(screen.getByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith('pu', 'old-1001'));
  fireEvent.click(screen.getByRole('button', { name: '載入更多符合的標題' }));
  await screen.findByRole('link', { name: '二手書 old-1002' });
  expect(mocks.search.mock.calls[2][2]).toBe(first.nextCursor);
  await act(async () => nextPage.resolve(page(['stale-delivery'])));
  expect(screen.queryByRole('link', { name: '二手書 stale-delivery' })).toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
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

it('recovers when an authorized article cannot be opened by the client router', async () => {
  mocks.navigate.mockImplementationOnce(() => { throw new Error('navigation transition failed'); });
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  fireEvent.click(link);
  await screen.findByText(/貼文已通過伺服器確認，但頁面開啟失敗/);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem('nuni:community-history-reading-position:v1')).toBeNull();

  // The same student can retry the same link after the router refuses it.
  fireEvent.click(link);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.navigate).toHaveBeenCalledTimes(2);
  expect(mocks.navigate).toHaveBeenLastCalledWith('/community/post/old-1001?schoolId=pu');
  const saved = JSON.parse(window.sessionStorage.getItem('nuni:community-history-reading-position:v1')!);
  expect(saved).toMatchObject({ uid: 'alice', schoolId: 'pu', query: '二手書', postId: 'old-1001' });
});


it('does not tell screen readers that an authorized post was unverified when only navigation failed', async () => {
  mocks.navigate.mockImplementationOnce(() => { throw new Error('router rejected transition'); });
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('貼文已通過伺服器確認');
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith('pu', 'old-1001');
  expect(screen.getByRole('status').textContent).toContain('伺服器已確認貼文可閱讀');
  expect(screen.getByRole('status').textContent).not.toContain('尚未通過伺服器確認');
});


it('confirms at most once during two rapid clicks and navigates only after success', async () => {
  const pending = deferred<boolean>();
  mocks.confirm.mockReturnValueOnce(pending.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  fireEvent.click(link);
  fireEvent.click(link);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).not.toHaveBeenCalled();
  await act(async () => pending.resolve(true));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/community/post/old-1001?schoolId=pu');
  fireEvent.click(link);
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
});
it.each(['query', 'school', 'account'])('ignores a stale open result after %s changes', async (scope) => {
  const pending = deferred<boolean>();
  mocks.confirm.mockReturnValueOnce(pending.promise);
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  if (scope === 'query') fireEvent.change(screen.getByRole('searchbox'), { target: { value: '租屋' } });
  if (scope === 'school') view.rerender(<TitleHistorySearch schoolId="other" />);
  if (scope === 'account') {
    mocks.auth.user = { uid: 'bob' };
    view.rerender(<TitleHistorySearch schoolId="pu" />);
  }
  await act(async () => pending.resolve(true));
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('article')).toBeNull();
});

it('restores keyboard focus to the status when a deleted result disappears', async () => {
  mocks.confirm.mockResolvedValueOnce(false);
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  link.focus();
  fireEvent.click(link);
  await waitFor(() => expect(screen.queryByRole('link', { name: '二手書 old-1001' })).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('status'));
});
it('moves keyboard focus to permission recovery after losing school access', async () => {
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'permission-denied' }));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const link = await screen.findByRole('link', { name: '二手書 old-1001' });
  link.focus();
  fireEvent.click(link);
  await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('alert'));
});


it('returns from a confirmed old post with only a scoped query and a fresh-position option', async () => {
  const first = page(['old-1001'], true);
  mocks.search.mockResolvedValueOnce(first);
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  render(<TitleHistorySearch schoolId="pu" />);
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveProperty('value', '二手書'));
  expect(screen.queryByRole('article')).toBeNull();
  expect(mocks.search).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '回到上次閱讀位置' })).toBeTruthy();
});

it('revalidates remembered position instead of replaying results and continues from a fresh cursor', async () => {
  const first = page(['old-1001'], true);
  mocks.search.mockResolvedValueOnce(first);
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  const resumed = page(['old-1001', 'old-1002'], true);
  mocks.resume.mockResolvedValueOnce(resumed);
  mocks.search.mockResolvedValueOnce(page(['old-1003']));
  render(<TitleHistorySearch schoolId="pu" />);
  await screen.findByRole('button', { name: '回到上次閱讀位置' });
  expect(screen.queryByRole('article')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到上次閱讀位置' }));
  expect(mocks.resume).toHaveBeenCalledExactlyOnceWith('pu', '二手書', 'old-1001');
  await screen.findByRole('link', { name: '二手書 old-1002' });
  fireEvent.click(screen.getByRole('button', { name: '載入更多符合的標題' }));
  await screen.findByRole('link', { name: '二手書 old-1003' });
  expect(mocks.search).toHaveBeenLastCalledWith('pu', '二手書', resumed.nextCursor);
  expect(screen.queryByRole('button', { name: '回到上次閱讀位置' })).toBeNull();
});

it.each(['account', 'school', 'signed-out', 'edit'])(
  'does not reuse remembered Web history on %s scope change', async (change) => {
    const view = render(<TitleHistorySearch schoolId="pu" />);
    submit();
    fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    view.unmount();
    if (change === 'account') mocks.auth.user = { uid: 'bob' };
    if (change === 'signed-out') mocks.auth.user = null;
    render(<TitleHistorySearch schoolId={change === 'school' ? 'other' : 'pu'} />);
    if (change === 'edit') {
      await screen.findByRole('button', { name: '回到上次閱讀位置' });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '租屋' } });
    } else if (change !== 'signed-out') {
      await waitFor(() => expect(screen.getByRole('searchbox')).toHaveProperty('value', ''));
    }
    expect(screen.queryByRole('button', { name: '回到上次閱讀位置' })).toBeNull();
    expect(mocks.resume).not.toHaveBeenCalled();
  },
);

it('retains only the ID on offline resume and retries that exact ID once connected', async () => {
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  mocks.resume.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
    .mockResolvedValueOnce(page(['old-1001']));
  render(<TitleHistorySearch schoolId="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '回到上次閱讀位置' }));
  expect(await screen.findByRole('button', { name: '重試上次閱讀位置' })).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試上次閱讀位置' }));
  await screen.findByRole('link', { name: '二手書 old-1001' });
  expect(mocks.resume).toHaveBeenCalledTimes(2);
  expect(mocks.resume.mock.calls[0]).toEqual(mocks.resume.mock.calls[1]);
});

it.each(['history-position-unavailable', 'permission-denied'])(
  'does not replay private results after a %s on reading-position verification', async (code) => {
    const view = render(<TitleHistorySearch schoolId="pu" />);
    submit();
    fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    view.unmount();
    mocks.resume.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    render(<TitleHistorySearch schoolId="pu" />);
    fireEvent.click(await screen.findByRole('button', { name: '回到上次閱讀位置' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: '回到上次閱讀位置' })).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  },
);

it('returns keyboard focus to the result announcement after the resume button disappears', async () => {
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  render(<TitleHistorySearch schoolId="pu" />);
  const resume = await screen.findByRole('button', { name: '回到上次閱讀位置' });
  resume.focus();
  fireEvent.click(resume);
  await screen.findByRole('link', { name: '二手書 old-1001' });
  expect(screen.queryByRole('button', { name: '回到上次閱讀位置' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
});

it('returns keyboard focus to recovery when the remembered article is no longer available', async () => {
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  mocks.resume.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'history-position-unavailable' }));
  render(<TitleHistorySearch schoolId="pu" />);
  const resume = await screen.findByRole('button', { name: '回到上次閱讀位置' });
  resume.focus();
  fireEvent.click(resume);
  const error = await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '回到上次閱讀位置' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(error));
});

it('keeps input focus if a student selects it while the remembered article is rechecked', async () => {
  const view = render(<TitleHistorySearch schoolId="pu" />);
  submit();
  fireEvent.click(await screen.findByRole('link', { name: '二手書 old-1001' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  const pending = deferred<TitleSearchPage>();
  mocks.resume.mockReturnValueOnce(pending.promise);
  render(<TitleHistorySearch schoolId="pu" />);
  const resume = await screen.findByRole('button', { name: '回到上次閱讀位置' });
  resume.focus();
  fireEvent.click(resume);
  const field = screen.getByRole('searchbox');
  field.focus();
  await act(async () => pending.resolve(page(['old-1001'])));
  expect(screen.getByRole('link', { name: '二手書 old-1001' })).toBeTruthy();
  expect(document.activeElement).toBe(field);
});


it('recovers a stalled first server search, then ignores the late old result', async () => {
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['fresh']));
  render(<TitleHistorySearch schoolId="pu" />);
  vi.useFakeTimers();
  try {
    submit();
    expect(screen.getByRole('button', { name: '搜尋歷史標題' }).getAttribute('aria-busy')).toBe('true');
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '重試搜尋' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '搜尋歷史標題' }).getAttribute('aria-busy')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '重試搜尋' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('link', { name: '二手書 fresh' })).toBeTruthy();
    await act(async () => { pending.resolve(page(['stale'])); await Promise.resolve(); });
    expect(screen.queryByRole('link', { name: '二手書 stale' })).toBeNull();
    expect(mocks.search).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('keeps the confirmed page and exact cursor when the next server page stalls', async () => {
  const first = page(['old-1001'], true);
  const pending = deferred<TitleSearchPage>();
  mocks.search.mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(page(['old-1002']));
  render(<TitleHistorySearch schoolId="pu" />);
  submit();
  const more = await screen.findByRole('button', { name: '載入更多符合的標題' });
  vi.useFakeTimers();
  try {
    fireEvent.click(more);
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(screen.getByRole('link', { name: '二手書 old-1001' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重試下一頁' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('link', { name: '二手書 old-1002' })).toBeTruthy();
    expect(mocks.search.mock.calls[1][2]).toBe(first.nextCursor);
    expect(mocks.search.mock.calls[2][2]).toBe(first.nextCursor);
    await act(async () => { pending.resolve(page(['stale'])); await Promise.resolve(); });
    expect(screen.queryByRole('link', { name: '二手書 stale' })).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('times out reading-position lookup without replaying a cached article or losing its ID', async () => {
  window.sessionStorage.setItem('nuni:community-history-reading-position:v1',
    JSON.stringify({ uid: 'alice', schoolId: 'pu', query: '二手書', postId: 'old-1001', savedAt: Date.now() }));
  const pending = deferred<TitleSearchPage>();
  mocks.resume.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['old-1001']));
  render(<TitleHistorySearch schoolId="pu" />);
  const resume = await screen.findByRole('button', { name: '回到上次閱讀位置' });
  vi.useFakeTimers();
  try {
    fireEvent.click(resume);
    expect(screen.queryByRole('article')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '重試上次閱讀位置' })).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重試上次閱讀位置' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('link', { name: '二手書 old-1001' })).toBeTruthy();
    expect(mocks.resume.mock.calls[0]).toEqual(mocks.resume.mock.calls[1]);
    await act(async () => { pending.reject(Object.assign(new Error('late denied'), { code: 'permission-denied' })); await Promise.resolve(); });
    expect(screen.getByRole('link', { name: '二手書 old-1001' })).toBeTruthy();
  } finally { vi.useRealTimers(); }
});


it('warns immediately about an overlong Web title but accepts 80 Unicode code points', async () => {
  render(<TitleHistorySearch schoolId="pu" />);
  const field = screen.getByRole('searchbox');
  fireEvent.change(field, { target: { value: 'a'.repeat(81) } });
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('標題開頭最多 80 字，請刪減後搜尋。')).toBeTruthy();
  expect(mocks.search).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '😀'.repeat(80) } });
  expect(field.getAttribute('aria-invalid')).toBe('false');
  expect(screen.queryByText('標題開頭最多 80 字，請刪減後搜尋。')).toBeNull();
  fireEvent.submit(field.closest('form')!);
  await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('pu', '😀'.repeat(80), null));
});
