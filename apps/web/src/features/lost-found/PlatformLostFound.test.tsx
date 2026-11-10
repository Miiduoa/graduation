import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniLostFoundItem } from '@campus/shared/src/nuniLostFound';
import { PlatformLostFound } from './PlatformLostFound';
import {
  platformLostFoundPendingKey,
  savePlatformLostFoundPending,
} from './platformLostFoundPending';
import RootLostFoundPage from '@/app/lost-found/page';
import { browserRequest } from '@/features/nuni/Session';
import { listLostFoundItems } from '@/lib/lostFound';

const state = vi.hoisted(() => ({
  auth: {
    session: {
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      context: 'context-a',
    } as { platformAccountId: string; context: string } | null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  },
  schoolReady: true,
  firebaseUser: null as { uid: string } | null,
  firebaseLoading: false,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => state.auth,
  browserRequest: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.firebaseUser, loading: state.firebaseLoading }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>請選擇校園</p>,
}));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: (search?: Record<string, unknown>) => ({
    ready: state.schoolReady,
    schoolId: typeof search?.schoolId === 'string' ? search.schoolId : 'pu',
    schoolName: search?.schoolId === 'ncu' ? '中央大學' : '靜宜大學',
  }),
}));
vi.mock('@/lib/lostFound', async () => ({
  ...(await vi.importActual<typeof import('@/lib/lostFound')>('@/lib/lostFound')),
  listLostFoundItems: vi.fn(async () => []),
}));

const account = 'pa_11111111-1111-4111-8111-111111111111';
const otherAccount = 'pa_22222222-2222-4222-8222-222222222222';
const id = 'plf_11111111-1111-4111-8111-111111111111';
const secondId = 'plf_22222222-2222-4222-8222-222222222222';
const fields = {
  type: 'lost' as const,
  title: '黑色雨傘',
  description: '傘柄有貼紙',
  category: 'other',
  location: '圖書館',
  date: '2026-11-07',
  contactInfo: '服務台分機123',
};
const item: NuniLostFoundItem = {
  ...fields,
  id,
  schoolId: 'pu',
  status: 'open',
  version: 1,
  createdAt: '2026-11-07T01:00:00.000Z',
  updatedAt: '2026-11-07T01:00:00.000Z',
  resolvedAt: null,
  isOwner: true,
};
function summary(value = item) {
  const result = { ...value };
  delete result.contactInfo;
  return result;
}
function page(items: NuniLostFoundItem[] = [], schoolId = 'pu', nextCursor: string | null = null) {
  return { schoolId, items, nextCursor };
}
function fill() {
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: fields.title } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: fields.description } });
  fireEvent.change(screen.getByLabelText('地點'), { target: { value: fields.location } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: fields.date } });
  fireEvent.change(screen.getByLabelText('聯絡方式（選填）'), {
    target: { value: fields.contactInfo },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browserRequest).mockReset();
  sessionStorage.clear();
  state.auth.session = { platformAccountId: account, context: 'context-a' };
  state.auth.loading = false;
  state.auth.error = '';
  state.auth.pendingLogout = false;
  state.firebaseUser = null;
  state.firebaseLoading = false;
  state.schoolReady = true;
  vi.mocked(browserRequest).mockImplementation(async (path, _context, input) => {
    if (path === 'lost-found/list') return page([], String(input?.schoolId));
    if (path === 'lost-found/get') return { item };
    if (path === 'lost-found/create')
      return {
        item: { ...item, ...(input?.fields as object), id: input?.id, schoolId: input?.schoolId },
      };
    if (path === 'lost-found/update')
      return {
        item: {
          ...item,
          ...(input?.fields as object),
          version: Number(input?.expectedVersion) + 1,
        },
      };
    if (path === 'lost-found/resolve')
      return {
        item: {
          ...item,
          status: 'resolved',
          version: Number(input?.expectedVersion) + 1,
          contactInfo: '',
          resolvedAt: '2026-11-07T02:00:00.000Z',
        },
      };
    if (path === 'lost-found/remove')
      return { removed: true, id: input?.id, schoolId: input?.schoolId };
    if (path === 'lost-found/export') return page([item]);
    throw new Error('Unexpected endpoint: ' + path);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Google platform lost-found entry and identity', () => {
  it('offers Google login with the original detail/campus and makes no anonymous read', () => {
    state.auth.session = null;
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'ncu' }} />);
    const link = screen.getByRole('link', { name: '使用 Google 帳號繼續' });
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain(
      '/lost-found/platform/' + id + '?schoolId=ncu',
    );
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it('lets a Google-only user enter from the main service even while school auth loads', async () => {
    state.firebaseLoading = true;
    await act(async () => {
      render(
        <Suspense>
          <RootLostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
        </Suspense>,
      );
    });
    expect(await screen.findByText('目前沒有符合條件的刊登。')).toBeTruthy();
    expect(browserRequest).toHaveBeenCalledWith(
      'lost-found/list',
      'context-a',
      expect.objectContaining({ schoolId: 'pu' }),
    );
    expect(listLostFoundItems).not.toHaveBeenCalled();
    expect(screen.queryByText('查看失物招領需要學校帳號。')).toBeNull();
  });

  it.each([{ source: 'school' }, { source: ['platform', 'school'] }])(
    'preserves an explicit legacy source $source without querying the platform',
    async ({ source }) => {
      await act(async () => {
        render(
          <Suspense>
            <RootLostFoundPage searchParams={Promise.resolve({ schoolId: 'pu', source })} />
          </Suspense>,
        );
      });
      expect(await screen.findByText('查看失物招領需要學校帳號。')).toBeTruthy();
      expect(browserRequest).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: '連線學校帳號' }).getAttribute('href')).toContain(
        'source%3Dschool',
      );
    },
  );

  it('keeps legacy school data available and provides an explicit Google listing entry', async () => {
    state.firebaseUser = { uid: 'school-alice' };
    await act(async () => {
      render(
        <Suspense>
          <RootLostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
        </Suspense>,
      );
    });
    expect(await screen.findByRole('link', { name: 'Google 帳號刊登' })).toBeTruthy();
    expect(listLostFoundItems).toHaveBeenCalledWith('pu');
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it('honors an explicit platform source when both accounts are available', async () => {
    state.firebaseUser = { uid: 'school-alice' };
    await act(async () => {
      render(
        <Suspense>
          <RootLostFoundPage
            searchParams={Promise.resolve({ schoolId: 'pu', source: 'platform' })}
          />
        </Suspense>,
      );
    });
    expect(await screen.findByText('目前沒有符合條件的刊登。')).toBeTruthy();
    expect(listLostFoundItems).not.toHaveBeenCalled();
    expect(browserRequest).toHaveBeenCalledWith('lost-found/list', 'context-a', expect.any(Object));
  });

  it.each(['loading', 'pendingLogout', 'error'] as const)(
    'hides contact and pending forms immediately on %s',
    async (flag) => {
      const view = render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
      expect(await screen.findByText(fields.contactInfo)).toBeTruthy();
      if (flag === 'error') state.auth.error = '確認失敗';
      else state.auth[flag] = true;
      view.rerender(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
      expect(screen.queryByText(fields.contactInfo)).toBeNull();
      expect(screen.queryByRole('button', { name: '編輯刊登' })).toBeNull();
    },
  );

  it('drops late list replies across account/context and campus changes', async () => {
    const first = deferred<unknown>();
    vi.mocked(browserRequest).mockReturnValueOnce(first.promise);
    const view = render(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    await waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    state.auth.session = { platformAccountId: otherAccount, context: 'context-b' };
    view.rerender(<PlatformLostFound search={{ schoolId: 'ncu' }} />);
    expect(await screen.findByText('目前沒有符合條件的刊登。')).toBeTruthy();
    await act(async () => {
      first.resolve(page([summary()]));
    });
    expect(screen.queryByRole('link', { name: fields.title })).toBeNull();
    expect(browserRequest).toHaveBeenLastCalledWith(
      'lost-found/list',
      'context-b',
      expect.objectContaining({ schoolId: 'ncu' }),
    );
  });

  it('requires an explicit valid campus before any API request', () => {
    state.schoolReady = false;
    render(<PlatformLostFound />);
    expect(screen.getByText('請選擇校園')).toBeTruthy();
    expect(browserRequest).not.toHaveBeenCalled();
  });
});

describe('platform listing and recoverable writes', () => {
  it('loads actual pages and preserves the selected filters/campus in detail links', async () => {
    vi.mocked(browserRequest)
      .mockResolvedValueOnce(page([summary()], 'pu', 'next-page'))
      .mockResolvedValueOnce(page([summary({ ...item, id: secondId, title: '第二頁鑰匙' })]));
    render(<PlatformLostFound search={{ schoolId: 'pu', mine: '1', q: '圖書館' }} />);
    expect(await screen.findByRole('link', { name: fields.title })).toBeTruthy();
    expect(screen.queryByText(fields.contactInfo)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
    expect(await screen.findByRole('link', { name: '第二頁鑰匙' })).toBeTruthy();
    expect(browserRequest).toHaveBeenLastCalledWith(
      'lost-found/list',
      'context-a',
      expect.objectContaining({ schoolId: 'pu', mine: true, q: '圖書館', cursor: 'next-page' }),
    );
    expect(
      decodeURIComponent(screen.getByRole('link', { name: fields.title }).getAttribute('href')!),
    ).toContain('q=圖書館');
  });

  it('does not represent a missing backend or malformed response as an empty list', async () => {
    vi.mocked(browserRequest).mockRejectedValueOnce(new NuniError(404, 'NOT_FOUND'));
    render(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    expect((await screen.findByRole('alert')).textContent).toContain('尚未開通');
    expect(screen.queryByText('目前沒有符合條件的刊登。')).toBeNull();
    vi.mocked(browserRequest).mockResolvedValueOnce(page([item]));
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    await waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(fields.contactInfo)).toBeNull();
    expect(screen.queryByText('目前沒有符合條件的刊登。')).toBeNull();
  });

  it('creates a real owned item, clears confirmed intent and returns to its exact detail', async () => {
    render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    await screen.findByLabelText('標題');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '確認刊登' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledOnce());
    const call = vi
      .mocked(browserRequest)
      .mock.calls.find(([path]) => path === 'lost-found/create')!;
    expect(call[1]).toBe('context-a');
    expect(call[2]).toMatchObject({ schoolId: 'pu', fields });
    expect(state.replace.mock.calls[0][0]).toContain(String(call[2]!.id));
    expect(sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))).toBeNull();
  });

  it('restores an uncertain submission after remount and retries the identical item/operation', async () => {
    const base = vi.mocked(browserRequest).getMockImplementation()!;
    vi.mocked(browserRequest).mockRejectedValueOnce(new TypeError('offline'));
    const view = render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    await screen.findByLabelText('標題');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '確認刊登' }));
    await screen.findByRole('button', { name: '重試並確認結果' });
    expect(state.replace).not.toHaveBeenCalled();
    const original = vi.mocked(browserRequest).mock.calls[0];
    view.unmount();
    vi.mocked(browserRequest).mockImplementation(base);
    render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    expect(((await screen.findByLabelText('標題')) as HTMLInputElement).value).toBe(fields.title);
    expect((screen.getByLabelText('標題') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重試並確認結果' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledOnce());
    expect(vi.mocked(browserRequest).mock.calls[1]).toEqual(original);
  });

  it('does not send a write when the pending record cannot be safely stored', async () => {
    render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    await screen.findByLabelText('標題');
    fill();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    fireEvent.click(screen.getByRole('button', { name: '確認刊登' }));
    expect((await screen.findByRole('alert')).textContent).toContain('尚未送出新的操作');
    expect(browserRequest).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText('標題') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '已核對，清除本機紀錄' })).toBeTruthy();
  });

  it('locks the form and exposes recovery if a stored intent cannot be read back', async () => {
    render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    await screen.findByLabelText('標題');
    fill();
    const original = Storage.prototype.getItem;
    let saved = false;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      originalSet.call(this, key, value);
      saved = true;
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      return saved ? null : original.call(this, key);
    });
    fireEvent.click(screen.getByRole('button', { name: '確認刊登' }));
    await screen.findByRole('alert');
    expect(browserRequest).not.toHaveBeenCalled();
    expect((screen.getByLabelText('標題') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '已核對，清除本機紀錄' })).toBeTruthy();
    expect(
      original.call(sessionStorage, platformLostFoundPendingKey(account, 'pu')),
    ).not.toBeNull();
  });

  it('cannot commit an old account receipt or clear its recovery record after account switch', async () => {
    const pending = deferred<unknown>();
    vi.mocked(browserRequest).mockReturnValueOnce(pending.promise);
    const view = render(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    await screen.findByLabelText('標題');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '確認刊登' }));
    await waitFor(() => expect(browserRequest).toHaveBeenCalledOnce());
    const input = vi.mocked(browserRequest).mock.calls[0][2]!;
    state.auth.session = { platformAccountId: otherAccount, context: 'context-b' };
    view.rerender(<PlatformLostFound mode="create" search={{ schoolId: 'pu' }} />);
    expect(((await screen.findByLabelText('標題')) as HTMLInputElement).value).toBe('');
    await act(async () => {
      pending.resolve({ item: { ...item, id: input.id } });
    });
    expect(state.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))).not.toBeNull();
    expect(sessionStorage.getItem(platformLostFoundPendingKey(otherAccount, 'pu'))).toBeNull();
  });

  it('does not show owner controls for somebody else’s listing', async () => {
    vi.mocked(browserRequest).mockResolvedValueOnce({ item: { ...item, isOwner: false } });
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    expect(await screen.findByText(fields.contactInfo)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '編輯刊登' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下架刊登' })).toBeNull();
  });

  it('edits with the original version and permits explicitly clearing contact', async () => {
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '編輯刊登' }));
    fireEvent.change(screen.getByLabelText('聯絡方式（選填）'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect(await screen.findByText('已儲存變更。')).toBeTruthy();
    expect(browserRequest).toHaveBeenLastCalledWith(
      'lost-found/update',
      'context-a',
      expect.objectContaining({
        id,
        schoolId: 'pu',
        expectedVersion: 1,
        fields: { ...fields, contactInfo: '' },
      }),
    );
    expect(screen.queryByText(fields.contactInfo)).toBeNull();
  });

  it('requires confirmation before resolving and only shows completion after contact erasure', async () => {
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '標記結案' }));
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/結案後會清除聯絡方式/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認結案並清除聯絡方式' }));
    await waitFor(() => expect(screen.queryByText(fields.contactInfo)).toBeNull());
    expect(screen.getAllByText('已結案，聯絡方式已清除。').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '編輯刊登' })).toBeNull();
    expect(browserRequest).toHaveBeenLastCalledWith(
      'lost-found/resolve',
      'context-a',
      expect.objectContaining({ id, expectedVersion: 1 }),
    );
  });

  it('requires explicit removal confirmation and verifies the receipt before leaving', async () => {
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '下架刊登' }));
    expect(browserRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '確認下架' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledOnce());
    expect(browserRequest).toHaveBeenLastCalledWith(
      'lost-found/remove',
      'context-a',
      expect.objectContaining({ id, expectedVersion: 1 }),
    );
    expect(screen.queryByText(fields.contactInfo)).toBeNull();
  });

  it.each(['resolve', 'remove'] as const)(
    'applies confirmed %s before a local cleanup failure',
    async (action) => {
      render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
      fireEvent.click(
        await screen.findByRole('button', { name: action === 'resolve' ? '標記結案' : '下架刊登' }),
      );
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'resolve' ? '確認結案並清除聯絡方式' : '確認下架',
        }),
      );
      expect((await screen.findByRole('alert')).textContent).toContain('伺服器已確認完成');
      expect(screen.queryByText(fields.contactInfo)).toBeNull();
      expect(screen.queryByRole('button', { name: '編輯刊登' })).toBeNull();
      expect(sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))).not.toBeNull();
      if (action === 'remove') expect(state.replace).toHaveBeenCalledOnce();
    },
  );

  it('exports all owned pages only after the complete export is verified', async () => {
    const createUrl = vi.fn(() => 'blob:verified-export');
    const click = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    const base = vi.mocked(browserRequest).getMockImplementation()!;
    let exportPage = 0;
    vi.mocked(browserRequest).mockImplementation(async (...args) => {
      if (args[0] !== 'lost-found/export') return base(...args);
      return ++exportPage === 1
        ? page([item], 'pu', 'next-export')
        : page([{ ...item, id: secondId }]);
    });
    render(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '匯出本校我的刊登' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createUrl).toHaveBeenCalledOnce();
    expect(browserRequest).toHaveBeenLastCalledWith('lost-found/export', 'context-a', {
      schoolId: 'pu',
      limit: 50,
      cursor: 'next-export',
    });
    vi.unstubAllGlobals();
  });

  it('does not download an export completed after an account switch', async () => {
    const createUrl = vi.fn(() => 'blob:should-not-exist');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = vi.fn();
      },
    );
    const pending = deferred<unknown>();
    const base = vi.mocked(browserRequest).getMockImplementation()!;
    vi.mocked(browserRequest).mockImplementation((...args) =>
      args[0] === 'lost-found/export' ? pending.promise : base(...args),
    );
    const view = render(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '匯出本校我的刊登' }));
    state.auth.session = { platformAccountId: otherAccount, context: 'context-b' };
    view.rerender(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    await act(async () => {
      pending.resolve(page([item]));
    });
    expect(createUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not download a partial export when a later page fails', async () => {
    const createUrl = vi.fn(() => 'blob:should-not-exist');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = vi.fn();
      },
    );
    const base = vi.mocked(browserRequest).getMockImplementation()!;
    let pages = 0;
    vi.mocked(browserRequest).mockImplementation(async (...args) => {
      if (args[0] !== 'lost-found/export') return base(...args);
      if (++pages === 1) return page([item], 'pu', 'second-export-page');
      throw new Error('export connection lost');
    });
    render(<PlatformLostFound search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '匯出本校我的刊登' }));
    expect((await screen.findByRole('alert')).textContent).toContain('沒有下載部分資料');
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('does not let a delayed detail read restore contact after a recovered resolve succeeds', async () => {
    savePlatformLostFoundPending(account, 'pu', {
      action: 'resolve',
      input: {
        schoolId: 'pu',
        id,
        expectedVersion: 1,
        mutationId: 'resolve-pending-1',
      },
    });
    const oldRead = deferred<unknown>();
    vi.mocked(browserRequest).mockReturnValueOnce(oldRead.promise);
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '重試並確認結果' }));
    await waitFor(() =>
      expect(screen.getAllByText('已結案，聯絡方式已清除。').length).toBeGreaterThan(0),
    );
    await act(async () => {
      oldRead.resolve({ item });
    });
    expect(screen.queryByText(fields.contactInfo)).toBeNull();
    expect(screen.queryByRole('button', { name: '編輯刊登' })).toBeNull();
    expect(screen.getAllByText('已結案，聯絡方式已清除。').length).toBeGreaterThan(0);
  });

  it('retains a conflicting edit without adopting a new server version behind the user’s back', async () => {
    render(<PlatformLostFound mode="detail" id={id} search={{ schoolId: 'pu' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '編輯刊登' }));
    fireEvent.change(screen.getByLabelText('標題'), { target: { value: '更新雨傘特徵' } });
    vi.mocked(browserRequest).mockRejectedValueOnce(
      new NuniError(409, 'LOST_FOUND_VERSION_CONFLICT'),
    );
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect((await screen.findByRole('alert')).textContent).toContain('刊登內容已經變更');
    expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('更新雨傘特徵');
    expect((screen.getByLabelText('標題') as HTMLInputElement).disabled).toBe(true);
    const saved = JSON.parse(sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))!);
    expect(saved.operation.input.expectedVersion).toBe(1);
    expect(screen.queryByText('已儲存變更。')).toBeNull();
  });
});
