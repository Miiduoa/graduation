import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';
import { queueFixture, shiftFixture } from '@/features/food/foodTestFixtures';
import { merchantApplicationsHref, merchantWorkspaceHref } from '@/lib/merchantWorkspaceNavigation';
import { MerchantWorkspace } from './MerchantWorkspace';

const mocks = vi.hoisted(() => ({
  auth: {
    session: { platformAccountId: 'account-a', context: 'context-a' } as null | {
      platformAccountId: string;
      context: string;
    },
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  request: vi.fn(),
  demo: false,
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => mocks.auth,
  useOptionalNuniSession: () => mocks.auth,
  browserRequest: mocks.request,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: ({ returnUrl }: { returnUrl: string }) => (
    <a href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>登入</a>
  ),
}));
vi.mock('@/features/food/AccountDemoDiningPanel', () => ({
  AccountDemoDiningPanel: ({ fallback }: { fallback: React.ReactNode }) =>
    mocks.demo ? <p>本人示範門市</p> : fallback,
}));

function detail(locationId = 'store-a', activated = false): NuniMerchantWorkspaceDetail {
  return {
    tenantId: 'campus-one',
    tenantName: '第一校園',
    merchantName: '餐坊',
    locationId,
    locationName: locationId === 'store-a' ? '一樓' : '二樓',
    campusName: '主校區',
    merchantStatus: activated ? 'active' : 'suspended',
    locationStatus: activated ? 'open' : 'suspended',
    activated,
    publicAccess: activated,
    missingRequirements: activated ? [] : ['settings', 'menu'],
    applicationId: 'application-1',
    merchantId: 'merchant-1',
    campusId: 'main-campus',
    serviceModes: ['pickup'],
    paymentMode: 'counter-only',
    onlinePaymentAvailable: false,
    paymentCapabilityState: 'not-requested',
    managerConfirmed: activated,
    termsVersion: activated ? 'merchant-terms-v1' : null,
    readinessVersion: 1,
    publishedMenuItems: activated ? 1 : 0,
    merchantMode: activated ? 'full' : 'info_only',
    merchantModeLabel: activated ? '接單服務' : '資訊展示',
    sourceLabel: '',
    sourceUpdatedAt: null,
    sourceLine: null,
  };
}
let active = false;
function respond(path: string) {
  if (path === 'merchant-workspaces')
    return Promise.resolve({ workspaces: [detail(), detail('store-b')] });
  if (path === 'merchant-applications') return Promise.resolve({ applications: [] });
  if (path === 'merchant-workspaces/campus-one/store-a')
    return Promise.resolve(detail('store-a', active));
  if (path === 'merchant-workspaces/campus-one/store-b') return Promise.resolve(detail('store-b'));
  if (path.endsWith('/orders')) return Promise.resolve({ orders: [queueFixture()] });
  if (path.endsWith('/shift')) return Promise.resolve(shiftFixture());
  return Promise.reject(new NuniError(403, 'FORBIDDEN'));
}
const href = (locationId = 'store-a', section: 'overview' | 'orders' = 'overview') =>
  merchantWorkspaceHref({ tenantId: 'campus-one', locationId, section });
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({ framework: 'preserve-me' }, '', '/merchant/workspace');
  sessionStorage.clear();
  mocks.auth.session = { platformAccountId: 'account-a', context: 'context-a' };
  mocks.auth.loading = false;
  mocks.auth.pendingLogout = false;
  mocks.auth.error = '';
  mocks.demo = false;
  active = false;
  mocks.request.mockImplementation(respond);
});

it('preserves the verified workspace and queue through sign-in without forwarding other parameters', () => {
  mocks.auth.session = null;
  window.history.replaceState(
    null,
    '',
    `${href('store-a', 'orders')}&queue=active&role=admin&pickupToken=secret`,
  );
  render(<MerchantWorkspace view="workspace" />);
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    `/login?returnUrl=${encodeURIComponent(`${href('store-a', 'orders')}&queue=active`)}`,
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it('opens a specific real store directly even when this account has demonstration data', async () => {
  mocks.demo = true;
  window.history.replaceState(null, '', href('store-b'));
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  expect(screen.queryByText('本人示範門市')).toBeNull();
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    'merchant-workspaces/campus-one/store-b',
  ]);
});

it.each([
  '?tenant=campus-one',
  '?tenant=campus-one&location=store-a&location=store-b',
  '?tenant=campus-one&location=..%2Fstore-a',
])('recovers from an invalid target without reading a different store: %s', async (search) => {
  window.history.replaceState(null, '', `/merchant/workspace${search}`);
  render(<MerchantWorkspace view="workspace" />);
  expect(screen.getByRole('heading', { name: '無法開啟這個門市連結' })).toBeTruthy();
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '查看我的門市' }));
  await screen.findByRole('link', { name: '管理門市：一樓' });
  expect(window.location.search).toBe('');
});

it('shows a recoverable authorization error without falling back to an unrelated store', async () => {
  window.history.replaceState(null, '', href('unknown-store'));
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByText(/目前無法取得這間門市的管理權限/);
  expect(screen.queryByText('餐坊／一樓')).toBeNull();
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    'merchant-workspaces/campus-one/unknown-store',
  ]);
  expect(screen.getByRole('link', { name: '返回我的門市' }).getAttribute('href')).toBe(
    '/merchant/workspace',
  );
});

it('uses browser Back and Forward for store navigation while preserving framework history state', async () => {
  render(<MerchantWorkspace view="workspace" />);
  const store = await screen.findByRole('link', { name: '管理門市：二樓' });
  expect(store.getAttribute('href')).toBe(href('store-b'));
  fireEvent.click(store);
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  expect(window.history.state).toEqual({ framework: 'preserve-me' });
  await act(async () => {
    window.history.back();
  });
  await screen.findByRole('link', { name: '管理門市：二樓' });
  await act(async () => {
    window.history.forward();
  });
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  await waitFor(() => expect(window.location.search).toBe('?tenant=campus-one&location=store-b'));
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('lets Next synchronize the URL instead of marking a manual transition as an internal router write', async () => {
  window.history.replaceState(
    {
      framework: 'preserve-me',
      __NA: true,
      _N: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: { old: true },
    },
    '',
    '/merchant/workspace',
  );
  const push = vi.spyOn(window.history, 'pushState');
  try {
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    expect(push).toHaveBeenCalledWith({ framework: 'preserve-me' }, '', href());
  } finally {
    push.mockRestore();
  }
});

it.each([{ metaKey: true }, { ctrlKey: true }])(
  'keeps the current workspace when opening another tab: %s',
  async (modifier) => {
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }), modifier);
    expect(window.location.search).toBe('');
    expect(
      mocks.request.mock.calls.some(([path]) => path === 'merchant-workspaces/campus-one/store-a'),
    ).toBe(false);
  },
);

it('restores the exact orders view and queue after a remount without making a mutation', async () => {
  active = true;
  const target = `${href('store-a', 'orders')}&queue=incoming`;
  window.history.replaceState(null, '', target);
  const view = render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('region', { name: '門市訂單工作台' });
  const navigation = screen.getByRole('navigation', { name: '門市工作' });
  expect(
    within(navigation).getByRole('link', { name: '訂單與收銀' }).getAttribute('aria-current'),
  ).toBe('page');
  expect(screen.queryByRole('heading', { name: '接單狀態' })).toBeNull();
  view.unmount();
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('region', { name: '門市訂單工作台' });
  expect(window.location.pathname + window.location.search).toBe(target);
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('explains unavailable ordering for an authorized store and offers its own overview', async () => {
  window.history.replaceState(null, '', href('store-b', 'orders'));
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('heading', { name: '這間門市尚未開放訂單工作台' });
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/orders'))).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: '查看門市概況' }));
  await screen.findByLabelText('品項 1 名稱');
  expect(window.location.pathname + window.location.search).toBe(href('store-b'));
});

it('keeps unsaved store drafts separate when returning through the list and clears them for another account', async () => {
  const view = render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.change(await screen.findByLabelText('品項 1 名稱'), { target: { value: '一樓草稿' } });
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  const previous = await screen.findByRole('link', { name: '管理門市：一樓' });
  await waitFor(() => expect(document.activeElement).toBe(previous));
  fireEvent.click(screen.getByRole('link', { name: '管理門市：二樓' }));
  expect(((await screen.findByLabelText('品項 1 名稱')) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  expect(((await screen.findByLabelText('品項 1 名稱')) as HTMLInputElement).value).toBe(
    '一樓草稿',
  );
  mocks.auth.session = { platformAccountId: 'account-b', context: 'context-b' };
  view.rerender(<MerchantWorkspace view="workspace" />);
  expect(((await screen.findByLabelText('品項 1 名稱')) as HTMLInputElement).value).toBe('');
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('ignores a delayed old-store response after moving to a different store', async () => {
  let complete!: (value: unknown) => void;
  mocks.request.mockImplementation((path) =>
    path === 'merchant-workspaces/campus-one/store-a'
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : respond(path),
  );
  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByText('正在確認門市資料…');
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：二樓' }));
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  await act(async () => complete(detail()));
  expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
});

it.each(['receipt', 'unknown', 'unknown while on the list'] as const)(
  'keeps an availability write locked across browser history and handles its %s',
  async (result) => {
    active = true;
    const path = 'merchant-workspaces/campus-one/store-a';
    const paused = { ...detail('store-a', true), locationStatus: 'closed', publicAccess: false };
    let finish!: (receipt: typeof paused) => void;
    let fail!: (failure: Error) => void;
    const write = new Promise<typeof paused>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    mocks.request.mockImplementation((requestPath) =>
      requestPath === `${path}/availability` ? write : respond(requestPath),
    );
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    expect(mocks.request).toHaveBeenCalledWith(
      `${path}/availability`,
      'context-a',
      { acceptingOrders: false },
      undefined,
    );

    await act(async () => window.history.back());
    await screen.findByRole('link', { name: '管理門市：一樓' });
    const failsOnList = result === 'unknown while on the list';
    if (failsOnList) await act(async () => fail(new NuniError(0, 'NETWORK_ERROR')));
    await act(async () => window.history.forward());
    const pause = await screen.findByRole('button', { name: '暫停接單' });
    expect(pause.hasAttribute('disabled')).toBe(true);
    if (failsOnList) {
      // The return read still reports "open", but cannot clear the unknown write.
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: '重新讀取門市狀態' }).hasAttribute('disabled'),
        ).toBe(false),
      );
    } else {
      expect(
        screen.getByRole('button', { name: '重新讀取門市狀態' }).hasAttribute('disabled'),
      ).toBe(true);
      // Every GET would still report "open". Defer the return read until the pending write settles.
      expect(mocks.request.mock.calls.filter(([requestPath]) => requestPath === path)).toHaveLength(
        1,
      );
    }
    fireEvent.click(pause);
    expect(
      mocks.request.mock.calls.filter(([requestPath]) => requestPath.endsWith('/availability')),
    ).toHaveLength(1);

    if (result === 'receipt') {
      await act(async () => finish(paused));
      expect(
        (await screen.findByRole('button', { name: '恢復接單' })).hasAttribute('disabled'),
      ).toBe(false);
      await screen.findByText('門市狀態已更新：暫停接單。');
    } else {
      if (!failsOnList) await act(async () => fail(new NuniError(0, 'NETWORK_ERROR')));
      await screen.findByText(/尚未確認這次操作的結果/);
      expect(screen.getByRole('button', { name: '暫停接單' }).hasAttribute('disabled')).toBe(true);
      mocks.request.mockImplementation((requestPath) =>
        requestPath === path ? Promise.resolve(paused) : respond(requestPath),
      );
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
      expect(
        (await screen.findByRole('button', { name: '恢復接單' })).hasAttribute('disabled'),
      ).toBe(false);
    }
  },
);

it.each(['browser Back', 'return link from application progress'])(
  'retains loaded locations and applications after %s when refreshing the list fails',
  async (returnVia) => {
    if (returnVia === 'return link from application progress') {
      mocks.demo = true;
      window.history.replaceState(null, '', merchantApplicationsHref);
    }
    const application = {
      tenantId: 'campus-one',
      applicationId: 'application-1',
      brandName: '測試餐坊',
      locationName: '餐廳櫃位',
      state: 'under-review',
      reviewerNote: '',
      submittedAt: '2026-10-09T02:00:00.000Z',
    };
    let unavailable = false;
    mocks.request.mockImplementation((path) => {
      if (unavailable && ['merchant-workspaces', 'merchant-applications'].includes(path))
        return Promise.reject(new Error('offline'));
      if (path === 'merchant-applications') return Promise.resolve({ applications: [application] });
      return respond(path);
    });
    render(<MerchantWorkspace view="workspace" />);
    await screen.findByRole('heading', { name: '測試餐坊／餐廳櫃位' });
    fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });

    unavailable = true;
    if (returnVia === 'browser Back') {
      await act(async () => window.history.back());
    } else {
      fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
      expect(window.location.search).toBe('?view=applications');
    }
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    expect(screen.getByRole('link', { name: '管理門市：一樓' })).toBeTruthy();
    const applications = screen.getByRole('region', { name: '申請進度' });
    expect(within(applications).getByRole('heading', { name: '測試餐坊／餐廳櫃位' })).toBeTruthy();
    expect(within(applications).getByText(/審核中/)).toBeTruthy();
  },
);
