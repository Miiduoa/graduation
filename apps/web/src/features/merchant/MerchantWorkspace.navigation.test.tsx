import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
import {
  parseMerchantWorkspaceDetail,
  type NuniMerchantWorkspaceDetail,
} from '@campus/shared/src/nuniMerchantOperations';
import { loadFoodPending } from '@/features/food/foodPersistence';
import { future, queueFixture, shiftFixture } from '@/features/food/foodTestFixtures';
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

function detail(
  locationId = 'store-a',
  activated = false,
): NuniMerchantWorkspaceDetail & NuniMerchantWorkspace {
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
  if (path.endsWith('/orders'))
    return Promise.resolve({ orders: [{ ...queueFixture(), locationId: path.split('/').at(-2) }] });
  if (path.endsWith('/shift'))
    return Promise.resolve({ ...shiftFixture(), locationId: path.split('/').at(-2) });
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

it.each([true, false])(
  'waits for the first workspace list before showing account recovery (empty: %s)',
  async (empty) => {
    let finishStores!: (value: { workspaces: NuniMerchantWorkspace[] }) => void;
    const stores = new Promise<{ workspaces: NuniMerchantWorkspace[] }>((resolve) => {
      finishStores = resolve;
    });
    mocks.request.mockImplementation((resource) =>
      resource === 'merchant-workspaces' ? stores : respond(resource),
    );

    render(<MerchantWorkspace view="workspace" />);
    await screen.findByRole('heading', { name: '已授權門市' });
    expect(screen.getByText('正在載入店家資料…')).toBeTruthy();
    expect(screen.queryByText(/這個帳號目前沒有已核准的門市/)).toBeNull();
    expect(screen.queryByRole('button', { name: '登出並切換店家帳號' })).toBeNull();

    await act(async () => finishStores({ workspaces: empty ? [] : [detail()] }));
    if (empty) {
      expect(screen.getByText(/這個帳號目前沒有已核准的門市/)).toBeTruthy();
      expect(screen.getByRole('button', { name: '登出並切換店家帳號' })).toBeTruthy();
    } else {
      expect(screen.getByRole('link', { name: '管理門市：一樓' })).toBeTruthy();
      expect(screen.queryByText(/這個帳號目前沒有已核准的門市/)).toBeNull();
      expect(screen.queryByRole('button', { name: '登出並切換店家帳號' })).toBeNull();
    }
  },
);

it('returns from a directly opened real store to the reloadable real list when demo data exists', async () => {
  mocks.demo = true;
  window.history.replaceState(null, '', href('store-b'));
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  expect(screen.queryByText('本人示範門市')).toBeNull();
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    'merchant-workspaces/campus-one/store-b',
  ]);
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByRole('link', { name: '管理門市：二樓' });
  expect(screen.queryByText('本人示範門市')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([path]) => path === 'merchant-workspaces'),
    ).toHaveLength(2),
  );
});

it('shows a verified direct-entry store when the first list request returns 503', async () => {
  const path = 'merchant-workspaces/campus-one/store-b';
  let revoked = false;
  window.history.replaceState(null, '', href('store-b'));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.reject(new NuniError(503, 'UNAVAILABLE'));
    if (resource === path && revoked) return Promise.reject(new NuniError(403, 'FORBIDDEN'));
    return respond(resource);
  });
  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  expect(mocks.request.mock.calls.map(([resource]) => resource)).toEqual([path]);

  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(screen.getByRole('link', { name: '管理門市：二樓' })).toBeTruthy();
  expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(2);

  revoked = true;
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: '管理門市：二樓' })).toBeNull());
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
  const returnedStore = await screen.findByRole('link', { name: '管理門市：二樓' });
  await waitFor(() => expect(document.activeElement).toBe(returnedStore));
  await act(async () => {
    window.history.forward();
  });
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  await waitFor(() => expect(window.location.search).toBe('?tenant=campus-one&location=store-b'));
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('requires confirmation again after returning to a store with a first-menu draft', async () => {
  render(<MerchantWorkspace view="workspace" />);
  const openStore = async () => {
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
  };
  const fields = [
    ['品項 1 名稱', '蔬菜便當'],
    ['品項 1 售價（元）', '85'],
    ['品項 1 初始庫存', '20'],
    ['品項 1 過敏原', '大豆，芝麻'],
  ];
  const confirmation = () => screen.getByLabelText(/我已確認品項、元售價/) as HTMLInputElement;
  const publish = () =>
    screen.getByRole('button', { name: '確認建立並上架菜單' }) as HTMLButtonElement;

  await openStore();
  for (const [label, value] of fields) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(confirmation());
  expect(confirmation().checked).toBe(true);
  expect(publish().disabled).toBe(false);

  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await openStore();

  for (const [label, value] of fields) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
  }
  expect(confirmation().checked).toBe(false);
  expect(publish().disabled).toBe(true);
  fireEvent.click(confirmation());
  expect(publish().disabled).toBe(false);
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it.each([
  { readMode: 'automatic', returnStatus: 503 },
  { readMode: 'manual', returnStatus: 503 },
  { readMode: 'unavailable', returnStatus: 503 },
  { readMode: 'automatic', returnStatus: 403 },
  { readMode: 'automatic', returnStatus: 404 },
] as const)(
  'keeps the first menu complete on a stale workspace list (post-write read: $readMode, return status: $returnStatus)',
  async ({ readMode, returnStatus }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    let published = false;
    let currentList = false;
    let detailStatus: number | null = readMode === 'automatic' ? null : 503;
    mocks.request.mockImplementation((requestPath) => {
      if (requestPath === `${path}/initial-menu`) {
        published = true;
        return Promise.resolve({
          menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
          createdItems: 1,
        });
      }
      if (requestPath === path && !published)
        return Promise.resolve({ ...detail(), readinessVersion: 2 });
      if (requestPath === path && published) {
        // The return refresh only has the stale list and the last verified detail.
        return detailStatus
          ? Promise.reject(new NuniError(detailStatus, 'DETAIL_UNAVAILABLE'))
          : Promise.resolve({
              ...detail(),
              readinessVersion: 2,
              publishedMenuItems: 1,
              missingRequirements: ['settings'],
            });
      }
      if (requestPath === 'merchant-workspaces' && currentList) {
        return Promise.resolve({
          workspaces: [
            { ...detail(), readinessVersion: 2, missingRequirements: ['settings'] },
            detail('store-b'),
          ],
        });
      }
      return respond(requestPath);
    });
    render(<MerchantWorkspace view="workspace" />);
    const initialLink = await screen.findByRole<HTMLAnchorElement>('link', { name: '管理門市：一樓' });
    const storeHref = initialLink.href;
    fireEvent.click(initialLink);
    fireEvent.change(await screen.findByLabelText('品項 1 名稱'), {
      target: { value: '蔬菜便當' },
    });
    fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
    fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
    if (readMode === 'manual') {
      await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>('button', { name: '重新讀取門市狀態' }).disabled,
        ).toBe(false),
      );
      detailStatus = null;
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
    }
    await screen.findByText(/已建立 1 項首次菜單/);
    if (readMode === 'unavailable')
      await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
    expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();

    detailStatus = returnStatus;
    fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    expect(
      mocks.request.mock.calls.filter(([route]) => route === 'merchant-workspaces'),
    ).toHaveLength(2);
    const locations = screen.getByRole('region', { name: '已授權門市' });
    const storeLink = () => within(locations).queryByRole('link', { name: '管理門市：一樓' });
    if (returnStatus === 403 || returnStatus === 404) {
      expect(storeLink()).toBeNull();
      expect(screen.getByText(/目前無法取得部分門市的管理權限/).getAttribute('role')).toBe('status');

      detailStatus = 503;
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
      await screen.findByText(/目前無法更新部分門市資料/);
      expect(storeLink()).toBeNull();

      currentList = true;
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
      expect(storeLink()).toBeNull();
      await act(async () => {
        window.history.pushState(null, '', storeHref);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
      expect(screen.queryByRole('heading', { name: '餐坊／一樓' })).toBeNull();
      expect(screen.queryByRole('button', { name: '儲存營運設定' })).toBeNull();

      detailStatus = null;
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
      await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
      fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    }

    const storeHeading = await screen.findByRole('heading', { name: '餐坊／一樓', level: 4 });
    const store = storeHeading.closest('li')!;
    expect(!!within(store).queryByRole('link', { name: '管理門市：一樓' })).toBe(returnStatus !== 503);
    expect(await within(store).findByText('待完成：確認營運設定與條款')).toBeTruthy();
    expect(within(store).queryByText(/建立菜單/)).toBeNull();
  },
);

it.each(['success', 403, 404, 503, 'timeout'] as const)(
  'hides previous management details on browser Forward until the return read succeeds (%s)',
  async (result) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });

    await act(async () => window.history.back());
    await screen.findByRole('link', { name: '管理門市：一樓' });

    let finish!: (value: NuniMerchantWorkspaceDetail) => void;
    let fail!: (reason: Error) => void;
    const reread = new Promise<NuniMerchantWorkspaceDetail>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    mocks.request.mockImplementation((requestPath) =>
      requestPath === path ? reread : respond(requestPath),
    );

    await act(async () => window.history.forward());
    await screen.findByText('正在確認門市資料…');
    expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
    expect(screen.queryByLabelText('付款方式')).toBeNull();

    if (result === 'success') {
      await act(async () => finish({ ...detail(), merchantName: '更新後的餐坊' }));
      await screen.findByRole('heading', { name: '更新後的餐坊／一樓', level: 2 });
    } else {
      const failure =
        result === 'timeout'
          ? new DOMException('The read timed out', 'TimeoutError')
          : new NuniError(result, 'READ_FAILED');
      await act(async () => fail(failure));
      await screen.findByText(
        result === 403 || result === 404
          ? /目前無法取得這間門市的管理權限/
          : /無法確認門市目前的資料/,
      );
      expect(screen.queryByLabelText('付款方式')).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
  },
);

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

it.each(['before returning', 'during the return read'])(
  'keeps paused status confirmed %s when the list delivers an older open status',
  async (receiptTiming) => {
    active = true;
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false, readinessVersion: 2 };
    let finishWrite!: (receipt: typeof paused) => void;
    let finishList!: (response: { workspaces: NuniMerchantWorkspaceDetail[] }) => void;
    const write = new Promise<typeof paused>((resolve) => {
      finishWrite = resolve;
    });
    const staleList = new Promise<{ workspaces: NuniMerchantWorkspaceDetail[] }>((resolve) => {
      finishList = resolve;
    });
    mocks.request.mockImplementation((path) =>
      path === 'merchant-workspaces' ? Promise.resolve({ workspaces: [open] }) : respond(path),
    );
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    const pause = await screen.findByRole('button', { name: '暫停接單' });
    mocks.request.mockImplementation((path) => {
      if (path.endsWith('/availability')) return write;
      if (path === 'merchant-workspaces') return staleList;
      if (path === 'merchant-workspaces/campus-one/store-a') return Promise.resolve(paused);
      return respond(path);
    });

    fireEvent.click(pause);
    if (receiptTiming === 'before returning') {
      await act(async () => finishWrite(paused));
      await screen.findByText('門市狀態已更新：暫停接單。');
    }
    await act(async () => window.history.back());
    await screen.findByText('正在載入店家資料…');
    if (receiptTiming === 'during the return read') {
      expect(screen.getByText('營業中')).toBeTruthy();
      await act(async () => finishWrite(paused));
    }
    expect(
      mocks.request.mock.calls.filter(([path]) => path === 'merchant-workspaces'),
    ).toHaveLength(2);
    await screen.findByText('暫停接單');
    await act(async () => finishList({ workspaces: [open, detail('store-b')] }));
    expect(screen.getByRole('link', { name: '管理門市：二樓' })).toBeTruthy();
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();

    const secondStore = detail('store-b');
    mocks.request.mockImplementation((path) =>
      path === 'merchant-workspaces'
        ? Promise.resolve({ workspaces: [secondStore] })
        : respond(path),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull());

    mocks.request.mockImplementation((path) =>
      path === 'merchant-workspaces' ? Promise.resolve({ workspaces: [open] }) : respond(path),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();
  },
);

it.each(['matching', 'stale', 'unavailable'])(
  'rechecks a newer availability receipt in the same overview (GET %s)',
  async (result) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 7 };
    const paused = { ...open, readinessVersion: 8, locationStatus: 'closed', publicAccess: false };
    const confirmation = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const readDetail = vi.fn().mockResolvedValueOnce(open).mockReturnValueOnce(confirmation.promise);
    const availability = vi.fn().mockResolvedValueOnce(paused);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return availability();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await screen.findByText('門市狀態已更新：暫停接單。');
    expect(readDetail).toHaveBeenCalledTimes(2);
    const resume = screen.getByRole<HTMLButtonElement>('button', { name: '恢復接單' });
    expect(resume.disabled).toBe(true);
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();

    await act(async () => {
      if (result === 'unavailable') confirmation.reject(new NuniError(503, 'UNAVAILABLE'));
      else confirmation.resolve(result === 'matching' ? paused : open);
    });
    expect(screen.getByText('門市狀態已更新：暫停接單。')).toBeTruthy();
    if (result === 'matching') {
      expect(resume.disabled).toBe(false);
      fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
      await screen.findByRole('region', { name: '門市訂單工作台' });
    } else {
      expect(resume.disabled).toBe(true);
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('請重新讀取');
    }
    expect(availability).toHaveBeenCalledOnce();
  },
);

it.each(['success', 'failure'] as const)(
  'keeps a confirmed pause on manual reload with a stale detail or a read %s',
  async (result) => {
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false, readinessVersion: 2 };
    let detailRead = () => Promise.resolve(open);
    mocks.request.mockImplementation((path) => {
      if (path === 'merchant-workspaces/campus-one/store-a') return detailRead();
      if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (path.endsWith('/availability')) return Promise.resolve(paused);
      return respond(path);
    });
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    const pause = await screen.findByRole('button', { name: '暫停接單' });
    detailRead = () => Promise.resolve(paused);
    fireEvent.click(pause);
    await screen.findByText('門市狀態已更新：暫停接單。');
    fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    await screen.findByText('暫停接單');
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());

    const readLatest = vi.fn(() =>
      result === 'success' ? Promise.resolve(open) : Promise.reject(new Error('network')),
    );
    detailRead = readLatest;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
    expect(readLatest).toHaveBeenCalledOnce();
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();
  },
);

it.each([2, 3])(
  'lets a later successful store read at version %i replace a pause receipt',
  async (readinessVersion) => {
    active = true;
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false, readinessVersion: 2 };
    mocks.request.mockImplementation((path) =>
      path === 'merchant-workspaces' ? Promise.resolve({ workspaces: [open] }) : respond(path),
    );
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    const pause = await screen.findByRole('button', { name: '暫停接單' });
    mocks.request.mockImplementation((path) => {
      if (path.endsWith('/availability')) return Promise.resolve(paused);
      if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (path === 'merchant-workspaces/campus-one/store-a') return Promise.resolve(paused);
      return respond(path);
    });
    fireEvent.click(pause);
    await screen.findByText('門市狀態已更新：暫停接單。');
    fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    await screen.findByRole('link', { name: '管理門市：一樓' });
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();

    mocks.request.mockImplementation((path) => {
      if (path === 'merchant-workspaces/campus-one/store-a')
        return Promise.resolve({ ...open, readinessVersion });
      if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [paused] });
      return respond(path);
    });
    fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
    await screen.findByText('營業中');
    expect(screen.getByRole('button', { name: '暫停接單' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
    mocks.request.mockImplementation((path) => {
      if (path === 'merchant-workspaces/campus-one/store-a')
        return Promise.reject(new Error('network'));
      if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [paused] });
      return respond(path);
    });
    fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    await screen.findByRole('link', { name: '管理門市：一樓' });
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    const expected = readinessVersion === 2 ? '暫停接單' : '營業中';
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(readinessVersion === 2 ? '營業中' : '暫停接單')).toBeNull();
  },
);

it.each([
  { listVersion: 1, suspended: false, label: '暫停接單', publicAccess: false },
  { listVersion: undefined, suspended: false, label: '營業中', publicAccess: true },
  { listVersion: undefined, suspended: true, label: '已停權，請聯絡場域管理者', publicAccess: false },
])('shows $label on return when the detail refresh fails (list version $listVersion)', async ({
  listVersion,
  suspended,
  label,
  publicAccess,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = detail('store-a', true);
  const initial = suspended
    ? { ...open, readinessVersion: 7, merchantStatus: 'suspended', locationStatus: 'suspended', publicAccess: false }
    : open;
  let listed: NuniMerchantWorkspace = open;
  const readDetail = vi.fn(() => Promise.resolve(initial));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [listed] });
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByText(suspended ? label : '營業中');

  listed = {
    ...open,
    readinessVersion: listVersion,
    locationStatus: suspended ? 'open' : 'closed',
    publicAccess: suspended,
    locationName: '一樓櫃台',
  };
  readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  await act(async () => window.history.back());
  await screen.findByRole('heading', { name: '餐坊／一樓櫃台' });
  expect(screen.queryByRole('link', { name: '管理門市：一樓櫃台' })).toBeNull();
  await screen.findByText('目前無法更新部分門市資料，請重新載入。');
  expect(readDetail).toHaveBeenCalledTimes(2);
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText(publicAccess ? '允許公開瀏覽' : '尚未公開')).toBeTruthy();
  expect(screen.queryByText(publicAccess ? '尚未公開' : '允許公開瀏覽')).toBeNull();
  if (label !== '營業中') expect(screen.queryByText('營業中')).toBeNull();
  if (label !== '暫停接單') expect(screen.queryByText('暫停接單')).toBeNull();
});

it.each([
  { confirmation: 'the detail succeeds', detailFails: false },
  { confirmation: 'only the list succeeds', detailFails: true },
])(
  'keeps the same-version reopening when an older pause receipt arrives and $confirmation',
  async ({ detailFails }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false };
    let finishWrite!: (receipt: typeof paused) => void;
    const write = new Promise<typeof paused>((resolve) => {
      finishWrite = resolve;
    });
    const readDetail = vi.fn(() => Promise.resolve(open));
    let listed = paused;
    mocks.request.mockImplementation((requestPath) => {
      if (requestPath === `${path}/availability`) return write;
      if (requestPath === path) return readDetail();
      if (requestPath === 'merchant-workspaces') return Promise.resolve({ workspaces: [listed] });
      return respond(requestPath);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    expect(mocks.request).toHaveBeenCalledWith(
      `${path}/availability`,
      'context-a',
      { acceptingOrders: false },
      undefined,
    );

    if (detailFails) {
      listed = open;
      readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    }
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    expect(screen.getByText('營業中')).toBeTruthy();

    readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    await act(async () => finishWrite(paused));
    expect(readDetail).toHaveBeenCalledTimes(3);
    expect(screen.getByText('營業中')).toBeTruthy();
    expect(screen.queryByText('暫停接單')).toBeNull();
  },
);

it.each(['receipt', 'unknown', 'unknown while on the list'] as const)(
  'keeps an availability write locked across browser history and handles its %s',
  async (result) => {
    active = true;
    const path = 'merchant-workspaces/campus-one/store-a';
    const paused = {
      ...detail('store-a', true),
      locationStatus: 'closed',
      publicAccess: false,
      readinessVersion: 2,
    };
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
    if (failsOnList) {
      const pause = await screen.findByRole('button', { name: '暫停接單' });
      expect(pause.hasAttribute('disabled')).toBe(true);
      fireEvent.click(pause);
      // The return read still reports "open", but cannot clear the unknown write.
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: '重新讀取門市狀態' }).hasAttribute('disabled'),
        ).toBe(false),
      );
    } else {
      await screen.findByText('正在確認門市資料…');
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(
        screen.getByRole('button', { name: '重新讀取門市狀態' }).hasAttribute('disabled'),
      ).toBe(true);
      // The list and Forward each recheck access while the write stays locked.
      expect(mocks.request.mock.calls.filter(([requestPath]) => requestPath === path)).toHaveLength(
        3,
      );
    }
    expect(
      mocks.request.mock.calls.filter(([requestPath]) => requestPath.endsWith('/availability')),
    ).toHaveLength(1);

    if (result === 'receipt') {
      let finishRead!: (value: typeof paused) => void;
      const reread = new Promise<typeof paused>((resolve) => {
        finishRead = resolve;
      });
      mocks.request.mockImplementation((requestPath) =>
        requestPath === path ? reread : respond(requestPath),
      );
      await act(async () => finish(paused));
      expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
      await act(async () => finishRead(paused));
      expect(
        (await screen.findByRole('button', { name: '恢復接單' })).hasAttribute('disabled'),
      ).toBe(false);
      await screen.findByText('門市狀態已更新：暫停接單。');
    } else {
      if (!failsOnList) await act(async () => fail(new NuniError(0, 'NETWORK_ERROR')));
      await screen.findByText(/尚未確認這次操作的結果/);
      expect(
        (await screen.findByRole('button', { name: '暫停接單' })).hasAttribute('disabled'),
      ).toBe(true);
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

it('restores operations from the confirmed detail after an availability write settles on the list', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 7 };
  const paused = { ...open, locationStatus: 'closed', publicAccess: false, readinessVersion: 8 };
  let finishWrite!: (value: typeof paused) => void;
  const write = new Promise<typeof paused>((resolve) => { finishWrite = resolve; });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(paused)
    .mockResolvedValueOnce(open);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return write;
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  await act(async () => finishWrite(paused));
  expect(readDetail).toHaveBeenCalledTimes(3);
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));

  expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復接單' }).disabled).toBe(false);
  expect(screen.getByRole('link', { name: '處理訂單與收銀' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

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

it('uses the successful detail for same-version availability without a write receipt', async () => {
  const open = detail('store-a', true);
  const paused = { ...open, locationStatus: 'closed', publicAccess: false };
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
    if (resource === 'merchant-workspaces/campus-one/store-a') return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  const resume = await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' });
  expect(resume.disabled).toBe(false);
  expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByText('暫停接單');
});

it('requires a detail matching the winning list version before sending settings', async () => {
  const open: NuniMerchantWorkspaceDetail = { ...detail('store-a', true), paymentMode: 'online-and-counter', readinessVersion: 6 };
  const paused: NuniMerchantWorkspaceDetail = {
    ...open,
    readinessVersion: 7,
    locationStatus: 'closed',
    publicAccess: false,
    serviceModes: ['pickup', 'dine-in'],
  };
  let row = open;
  let detailResponse = open;
  const path = 'merchant-workspaces/campus-one/store-a';
  const writeSettings = vi.fn<(input: unknown) => Promise<never>>()
    .mockRejectedValue(new NuniError(409, 'CONFLICT'));
  mocks.request.mockImplementation((resource, _context, input) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [row] });
    if (resource === path) return Promise.resolve(detailResponse);
    if (resource === `${path}/settings`) return writeSettings(input);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('button', { name: '暫停接單' });
  row = paused;
  await act(async () => window.history.back());
  await screen.findByText('暫停接單');

  await act(async () => window.history.forward());
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  expect(screen.getByText('暫停接單')).toBeTruthy();
  expect(screen.queryByText('營業中')).toBeNull();
  expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
  expect(screen.queryByRole('button', { name: '確認改為櫃檯付款' })).toBeNull();
  expect(writeSettings).not.toHaveBeenCalled();

  detailResponse = paused;
  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  await screen.findByText('自取、內用');
  fireEvent.click(screen.getByRole('button', { name: '確認改為櫃檯付款' }));
  await screen.findByText(/門市資料已變更/);
  expect(writeSettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ serviceModes: ['pickup', 'dine-in'], expectedVersion: 7 }),
  );
});

it.each([403, 404])('does not restore a pause notice after list denial %s and renewed access', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = detail('store-a', true);
  const paused = { ...open, readinessVersion: 2, locationStatus: 'closed', publicAccess: false };
  const reopened = { ...open, readinessVersion: 3 };
  let listDenied = false;
  const readDetail = vi.fn().mockResolvedValue(open);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces')
      return listDenied
        ? Promise.reject(new NuniError(status, 'DENIED'))
        : Promise.resolve({ workspaces: [open] });
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await screen.findByText('門市狀態已更新：暫停接單。');

  listDenied = true;
  readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  await act(async () => window.history.back());
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();

  readDetail.mockResolvedValue(reopened);
  await act(async () => window.history.forward());
  await screen.findByText('營業中');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
});

it.each([
  { versionedList: true, readinessVersion: 8, confirmsNewerPause: false },
  { versionedList: false, readinessVersion: 8, confirmsNewerPause: false },
  { versionedList: true, readinessVersion: 7, confirmsNewerPause: false },
  { versionedList: false, readinessVersion: 7, confirmsNewerPause: false },
  { versionedList: true, readinessVersion: 8, confirmsNewerPause: true },
  { versionedList: false, readinessVersion: 8, confirmsNewerPause: true },
])(
  'discards a displayed pause notice after reopening at version $readinessVersion (versioned list: $versionedList, newer pause confirmed: $confirmsNewerPause)',
  async ({ versionedList, readinessVersion: reopenedVersion, confirmsNewerPause }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 6 };
    const paused = { ...open, readinessVersion: 7, locationStatus: 'closed', publicAccess: false };
    const reopened = { ...open, readinessVersion: reopenedVersion };
    let current = open;
    const readDetail = vi.fn(() => Promise.resolve(current));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') {
        const readinessVersion = versionedList ? current.readinessVersion : undefined;
        return Promise.resolve({ workspaces: [{ ...current, readinessVersion }] });
      }
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return Promise.resolve(paused);
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await screen.findByText('門市狀態已更新：暫停接單。');

    if (confirmsNewerPause) {
      current = { ...paused, readinessVersion: reopenedVersion };
      await act(async () => window.history.back());
      await screen.findByText('暫停接單');
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
      await act(async () => window.history.forward());
      await screen.findByRole('button', { name: '恢復接單' });
      expect(readDetail).toHaveBeenCalledTimes(4);
    }

    current = reopened;
    await act(async () => window.history.back());
    await screen.findByText('營業中');
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(confirmsNewerPause ? 5 : 3));

    await act(async () => window.history.forward());
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    expect(readDetail).toHaveBeenCalledTimes(confirmsNewerPause ? 6 : 4);
    expect(screen.getByText('營業中')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
    expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
  },
);

it.each([
  { backgroundFirst: false },
  { backgroundFirst: true },
])('keeps v8 reopening over a v7 pause receipt (background first: $backgroundFirst)', async ({ backgroundFirst }) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 7 };
  const paused = { ...open, locationStatus: 'closed', publicAccess: false };
  const reopened = { ...open, readinessVersion: 8 };
  let finishBackground!: (value: typeof reopened) => void;
  const background = new Promise<typeof reopened>((resolve) => { finishBackground = resolve; });
  let finishPause!: (value: typeof paused) => void;
  const pause = new Promise<typeof paused>((resolve) => { finishPause = resolve; });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockReturnValueOnce(background)
    .mockResolvedValue(open);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return pause;
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('button', { name: '暫停接單' });
  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  await act(async () => window.history.forward());
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  if (backgroundFirst) {
    await act(async () => finishBackground(reopened));
    expect(screen.getByText('營業中')).toBeTruthy();
    await act(async () => finishPause(paused));
  } else {
    await act(async () => finishPause(paused));
    await screen.findByText('門市狀態已更新：暫停接單。');
    await act(async () => finishBackground(reopened));
  }

  expect(readDetail).toHaveBeenCalledTimes(3);
  expect(screen.getByText('營業中')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();

  fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
  await screen.findByRole('region', { name: '門市訂單工作台' });
  expect(screen.queryByText('正在重新確認門市，確認後會接回訂單工作台。')).toBeNull();
  expect(readDetail).toHaveBeenCalledTimes(3);
});

it.each([200, 403, 404, 503])(
  'rechecks a pause conflict without leaving the store (refresh status: %s)',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 8 };
    const stale = { ...open, readinessVersion: 7, locationStatus: 'closed', publicAccess: false };
    const readDetail = vi.fn().mockResolvedValueOnce(open);
    if (status === 200) readDetail.mockResolvedValueOnce(stale);
    else readDetail.mockRejectedValueOnce(new NuniError(status, 'DETAIL_FAILED'));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) {
        return Promise.reject(new NuniError(409, 'FOOD_MERCHANT_WORKSPACE_CHANGED'));
      }
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await screen.findByRole('alert');
    expect(readDetail).toHaveBeenCalledTimes(2);
    if (status === 200) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
      expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
      fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
      await screen.findByRole('region', { name: '門市訂單工作台' });
      expect(readDetail).toHaveBeenCalledTimes(2);
    } else {
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      expect(screen.queryByRole('link', { name: '訂單與收銀' })).toBeNull();
    }
  },
);

it.each([
  { entryArrival: 'before', refreshStatus: 200 },
  { entryArrival: 'before', refreshStatus: 200, backgroundDenial: 403 },
  { entryArrival: 'before', refreshStatus: 200, backgroundDenial: 404 },
  { entryArrival: 'before', refreshStatus: 200, conflict: true },
  { entryArrival: 'during', refreshStatus: 200, conflict: true },
  { entryArrival: 'before', refreshStatus: 200, listArrival: 'before' },
  { entryArrival: 'before', refreshStatus: 200, listArrival: 'after' },
  { entryArrival: 'during', refreshStatus: 200 },
  { entryArrival: 'before', refreshStatus: 403 },
  { entryArrival: 'before', refreshStatus: 404 },
  { entryArrival: 'before', refreshStatus: 503 },
  { entryArrival: 'during', refreshStatus: 503 },
  { entryArrival: 'after', refreshStatus: 503 },
])(
  'rechecks access after returning during a pause (entry detail arrival: $entryArrival, refresh status: $refreshStatus, conflict: $conflict, list arrival: $listArrival, background denial: $backgroundDenial)',
  async ({ entryArrival, refreshStatus, conflict, listArrival, backgroundDenial }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 6 };
    const paused = { ...open, readinessVersion: 7, locationStatus: 'closed', publicAccess: false };
    const reopened = { ...open, readinessVersion: 8 };
    const latestPause = { ...paused, readinessVersion: 9 };
    const latestReopen = { ...reopened, readinessVersion: 10 };
    let denyBackground!: (error: NuniError) => void;
    const background = new Promise<typeof reopened>((_resolve, reject) => { denyBackground = reject; });
    let finishEntry!: (value: typeof reopened) => void;
    const entry = new Promise<typeof reopened>((resolve) => { finishEntry = resolve; });
    let finishPause!: (value: typeof paused) => void;
    let failPause!: (error: NuniError) => void;
    const pause = new Promise<typeof paused>((resolve, reject) => {
      finishPause = resolve;
      failPause = reject;
    });
    const latestList = { workspaces: [{ ...reopened, readinessVersion: 9 }] };
    let finishList!: (value: typeof latestList) => void;
    const pendingList = new Promise<typeof latestList>((resolve) => { finishList = resolve; });
    const readList = vi.fn().mockResolvedValue({ workspaces: [open] });
    if (listArrival) {
      readList.mockResolvedValueOnce({ workspaces: [open] }).mockReturnValueOnce(pendingList);
    }
    let finishRefresh!: (value: typeof paused) => void;
    let failRefresh!: (error: NuniError) => void;
    const refresh = new Promise<typeof paused>((resolve, reject) => {
      finishRefresh = resolve;
      failRefresh = reject;
    });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(open);
    if (backgroundDenial) readDetail.mockReturnValueOnce(background);
    else if (!listArrival) readDetail.mockResolvedValueOnce(open);
    readDetail.mockReturnValueOnce(entry)
      .mockReturnValueOnce(refresh);
    mocks.request.mockImplementation((resource, _context, input) => {
      if (resource === 'merchant-workspaces') return readList();
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) {
        return input?.acceptingOrders ? Promise.resolve(latestReopen) : pause;
      }
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    expect(mocks.request).toHaveBeenCalledWith(
      `${path}/availability`, 'context-a', { acceptingOrders: false }, undefined,
    );
    await act(async () => window.history.back());
    await screen.findByRole('link', { name: '管理門市：一樓' });
    const entryReadCount = listArrival ? 2 : 3;
    const refreshReadCount = entryReadCount + 1;
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(entryReadCount - 1));
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(entryReadCount));

    if (entryArrival === 'before') await act(async () => finishEntry(reopened));
    await act(async () => {
      if (conflict) failPause(new NuniError(409, 'FOOD_MERCHANT_WORKSPACE_CHANGED'));
      else finishPause(backgroundDenial ? latestPause : paused);
    });
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(refreshReadCount));
    if (entryArrival === 'during') await act(async () => finishEntry(reopened));
    const pendingPause = screen.queryByRole<HTMLButtonElement>('button', { name: '暫停接單' });
    expect(pendingPause?.disabled ?? true).toBe(true);
    if (refreshStatus !== 200) {
      await act(async () => failRefresh(new NuniError(refreshStatus, 'DETAIL_FAILED')));
      if (entryArrival === 'after') await act(async () => finishEntry(reopened));
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      expect(screen.queryByRole('link', { name: '訂單與收銀' })).toBeNull();
      expect(screen.queryByText('正在重新確認門市，確認後會接回訂單工作台。')).toBeNull();
      expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
      if (entryArrival === 'during') {
        await act(async () => {
          window.history.replaceState(window.history.state, '', href('store-a', 'orders'));
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(window.location.search).toContain('section=orders');
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByText('正在重新確認門市，確認後會接回訂單工作台。')).toBeNull();
        expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
        expect(mocks.request.mock.calls.some(([resource]) => resource.endsWith('/orders'))).toBe(false);
        await act(async () => {
          window.history.replaceState(window.history.state, '', href());
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
      }
      if (refreshStatus === 503) {
        expect(readDetail).toHaveBeenCalledTimes(4);
        readDetail.mockResolvedValueOnce(reopened);
        fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
        const pauseButton = await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' });
        expect(pauseButton.disabled).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
        await screen.findByRole('region', { name: '門市訂單工作台' });
        expect(readDetail).toHaveBeenCalledTimes(5);
      }
      return;
    }
    if (backgroundDenial) {
      await act(async () => denyBackground(new NuniError(backgroundDenial, 'DETAIL_FAILED')));
    }
    if (listArrival === 'before') await act(async () => finishList(latestList));
    // The denial is older than the entry GET. The refresh still needs to confirm
    // the receipt's v9 before that version can be used to manage the store.
    await act(async () => finishRefresh(backgroundDenial ? latestPause : paused));
    if (listArrival === 'after') {
      expect(screen.getByRole('link', { name: '處理訂單與收銀' })).toBeTruthy();
      await act(async () => finishList(latestList));
    }
    if (listArrival) {
      expect(screen.getByRole('alert').textContent).toContain('請重新讀取');
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      await act(async () => {
        window.history.replaceState(window.history.state, '', href('store-a', 'orders'));
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(screen.getByRole('alert').textContent).toContain('請重新讀取');
      expect(screen.queryByText('正在重新確認門市，確認後會接回訂單工作台。')).toBeNull();
      expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
      expect(mocks.request.mock.calls.some(([resource]) => resource.endsWith('/orders'))).toBe(false);
      readDetail.mockResolvedValueOnce({ ...reopened, readinessVersion: 9 });
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
      await screen.findByRole('region', { name: '門市訂單工作台' });
      expect(screen.queryByText('無法確認門市目前的資料。草稿已保留，請重新讀取。')).toBeNull();
      return;
    }

    if (backgroundDenial) {
      expect(screen.getByText('門市狀態已更新：暫停接單。')).toBeTruthy();
      const resume = screen.getByRole<HTMLButtonElement>('button', { name: '恢復接單' });
      expect(resume.disabled).toBe(false);
      expect(screen.queryByRole('alert')).toBeNull();
      readDetail.mockResolvedValueOnce(latestReopen);
      fireEvent.click(resume);
      await screen.findByText('營業中');
      await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled)
        .toBe(false));
    }

    expect(screen.getByText('營業中')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
    expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
    if (conflict) expect(screen.getByRole('alert').textContent).toContain('門市資料已變更');
    else expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('region', { name: '門市訂單工作台' });
    expect(readDetail).toHaveBeenCalledTimes(backgroundDenial ? 5 : 4);
  },
);

it.each([
  { status: 403, legacy: false },
  { status: 404, legacy: false },
  { status: 403, legacy: true },
  { status: 404, legacy: true },
])('revokes a confirmed store after detail denial $status (legacy list: $legacy)', async ({ status, legacy }) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 6 };
  const paused = { ...open, readinessVersion: 7, locationStatus: 'closed', publicAccess: false };
  let denyDetail!: (error: NuniError) => void;
  const pendingDetail = new Promise<never>((_, reject) => { denyDetail = reject; });
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [open] })
    .mockResolvedValueOnce({ workspaces: [paused] })
    .mockResolvedValue({
      workspaces: [legacy
        ? { ...open, readinessVersion: undefined, merchantName: '更新名稱的餐坊' }
        : open],
    });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(paused)
    .mockResolvedValueOnce(paused)
    .mockReturnValueOnce(pendingDetail)
    .mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await screen.findByText('門市狀態已更新：暫停接單。');

  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
  await act(async () => window.history.back());
  await screen.findByText('目前無法更新部分門市資料，請重新載入。');
  expect(readList).toHaveBeenCalledTimes(3);
  expect(screen.getByText('暫停接單')).toBeTruthy();

  if (legacy) expect(screen.getByRole('heading', { name: '更新名稱的餐坊／一樓' })).toBeTruthy();

  await act(async () => denyDetail(new NuniError(status, 'DENIED')));
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  expect(screen.queryByText('暫停接單')).toBeNull();
  expect(screen.queryByRole('heading', { name: '更新名稱的餐坊／一樓' })).toBeNull();

  readDetail.mockResolvedValue(paused);
  await act(async () => window.history.forward());
  await screen.findByText('暫停接單');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復接單' }).disabled).toBe(false);
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
});

it('uses a post-write background confirmation across repeated stale re-entries', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 7 };
  const paused = { ...open, readinessVersion: 8, locationStatus: 'closed', publicAccess: false };
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(paused)
    .mockResolvedValue(open);
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [open] })
    .mockResolvedValue({ workspaces: [paused] });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await screen.findByText('門市狀態已更新：暫停接單。');

  for (const backgroundReadCount of [2, 4]) {
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(backgroundReadCount));
    await screen.findByRole('link', { name: '管理門市：一樓' });
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(backgroundReadCount + 1));
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' })).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  }

  fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
  await screen.findByRole('region', { name: '門市訂單工作台' });
});

it.each(['entry GET', 'hidden refresh failure'] as const)(
  'keeps entry locked after a stale post-write GET with an earlier %s',
  async (scenario) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 7 };
    const paused = { ...open, readinessVersion: 8, locationStatus: 'closed', publicAccess: false };
    const hiddenFailure = scenario === 'hidden refresh failure';
    let finishPause!: (value: typeof paused) => void;
    const pause = new Promise<typeof paused>((resolve) => { finishPause = resolve; });
    let finishBackground!: (value: typeof paused) => void;
    const background = new Promise<typeof paused>((resolve) => { finishBackground = resolve; });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(open)
      .mockImplementationOnce(() => hiddenFailure ? background : Promise.resolve(open))
      .mockImplementationOnce(() => hiddenFailure
        ? Promise.reject(new NuniError(503, 'UNAVAILABLE'))
        : Promise.resolve(open))
      .mockResolvedValueOnce(open);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return pause;
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));

    if (hiddenFailure) {
      await act(async () => finishPause(paused));
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
      await act(async () => finishBackground(paused));
      await act(async () => window.history.forward());
    } else {
      await act(async () => window.history.forward());
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
      await act(async () => finishPause(paused));
    }
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));

    expect(screen.getByRole('alert').textContent).toContain('請重新讀取');
    expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
    expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();

    readDetail.mockResolvedValueOnce(paused);
    fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' })).disabled).toBe(false);
  },
);

it.each([403, 404])('revokes access and the pause notice after stale detail precedes list denial %s', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 6 };
  const paused = { ...open, readinessVersion: 7, locationStatus: 'closed', publicAccess: false };
  let denyList!: (error: NuniError) => void;
  const pendingList = new Promise<never>((_, reject) => {
    denyList = reject;
  });
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [open] })
    .mockReturnValueOnce(pendingList);
  const reopened = { ...open, readinessVersion: 7 };
  let finishRetry!: (value: typeof reopened) => void;
  const retry = new Promise<typeof reopened>((resolve) => { finishRetry = resolve; });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(open)
    .mockReturnValueOnce(retry);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await screen.findByText('門市狀態已更新：暫停接單。');

  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
  expect(screen.queryByRole('link', { name: '訂單與收銀' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '門市工作台' })).toBeNull();

  await act(async () => denyList(new NuniError(status, 'DENIED')));
  expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  await act(async () => finishRetry(reopened));
  await screen.findByText('營業中');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
});

it.each([
  { status: 403, beforeReceipt: true },
  { status: 404, beforeReceipt: true },
  { status: 403, beforeReceipt: false },
  { status: 404, beforeReceipt: false },
])(
  'hides a store when detail returns $status (denied while pending: $beforeReceipt)',
  async ({ status, beforeReceipt }) => {
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false };
    const path = 'merchant-workspaces/campus-one/store-a';
    let finish!: (value: typeof paused) => void;
    const write = new Promise<typeof paused>((resolve) => {
      finish = resolve;
    });
    let denied = false;
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (resource === path)
        return denied ? Promise.reject(new NuniError(status, 'DENIED')) : Promise.resolve(open);
      if (resource === `${path}/availability`) return write;
      return respond(resource);
    });
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    denied = beforeReceipt;
    await act(async () => window.history.back());
    if (beforeReceipt) {
      await screen.findByText(/目前無法取得部分門市的管理權限/);
      expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    } else {
      await screen.findByRole('link', { name: '管理門市：一樓' });
      await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    }
    expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(2);
    denied = true;
    await act(async () => finish(paused));
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(3);
  },
);

it.each([403, 404])(
  'automatically checks an uncertain write and keeps a denied store off the list (%s)',
  async (status) => {
    const open = detail('store-a', true);
    const path = 'merchant-workspaces/campus-one/store-a';
    let lostAccess = false;
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [open] });
      if (resource === path)
        return lostAccess ? Promise.reject(new NuniError(status, 'DENIED')) : Promise.resolve(open);
      if (resource === `${path}/availability`) {
        lostAccess = true;
        return Promise.reject(new NuniError(503, 'UNAVAILABLE'));
      }
      return respond(resource);
    });
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await screen.findByText(/目前無法取得這間門市的管理權限/);
    expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(2);
    await act(async () => window.history.back());
    await screen.findByText(/目前無法取得部分門市的管理權限/);
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(3);
  },
);

it.each([403, 404])(
  'hides previously authorized stores when the list returns %s and the detail is unavailable',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    let listDenied = false;
    let failDetail!: (error: NuniError) => void;
    const unavailable = new Promise<never>((_, reject) => {
      failDetail = reject;
    });
    const readDetail = vi.fn(() => (listDenied ? unavailable : Promise.resolve(open)));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces')
        return listDenied
          ? Promise.reject(new NuniError(status, 'DENIED'))
          : Promise.resolve({ workspaces: [open, detail('store-b')] });
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    await screen.findByRole('link', { name: '管理門市：一樓' });
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    expect(screen.getByRole('link', { name: '管理門市：二樓' })).toBeTruthy();

    listDenied = true;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
    expect(readDetail).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    await act(async () => failDetail(new NuniError(503, 'UNAVAILABLE')));
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    expect(screen.queryByRole('link', { name: '管理門市：二樓' })).toBeNull();
  },
);


it.each([403, 404])(
  'hides cached operations on browser forward after the list returns %s',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    let listDenied = false;
    const readDetail = vi.fn(() => Promise.resolve(open));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces')
        return listDenied
          ? Promise.reject(new NuniError(status, 'DENIED'))
          : Promise.resolve({ workspaces: [open] });
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    expect(screen.getByText('服務方式')).toBeTruthy();

    listDenied = true;
    readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    await act(async () => window.history.back());
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
    expect(readDetail).toHaveBeenCalledTimes(2);

    await act(async () => window.history.forward());
    await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
    expect(readDetail).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('heading', { name: '餐坊／一樓' })).toBeNull();
    expect(screen.queryByText('營業中')).toBeNull();
    expect(screen.queryByText('服務方式')).toBeNull();
  },
);

it.each([
  { receiptTiming: 'on the list', listAfterForward: false },
  { receiptTiming: 'after browser Forward', listAfterForward: false },
  { receiptTiming: 'after the list responds after browser Forward', listAfterForward: true },
])(
  'keeps a later list confirmation while applications are pending and a pause receipt arrives $receiptTiming',
  async ({ receiptTiming, listAfterForward }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    const paused = { ...open, locationStatus: 'closed', publicAccess: false };
    let finishWrite!: (receipt: typeof paused) => void;
    const write = new Promise<typeof paused>((resolve) => {
      finishWrite = resolve;
    });
    let finishApplications!: (value: { applications: [] }) => void;
    const applications = new Promise<{ applications: [] }>((resolve) => {
      finishApplications = resolve;
    });
    let returning = false;
    const readDetail = vi.fn(() => Promise.resolve(open));
    const confirmedList = { workspaces: [{ ...open, merchantName: '重新確認的餐坊' }] };
    let finishList!: (value: typeof confirmedList) => void;
    const list = new Promise<typeof confirmedList>((resolve) => {
      finishList = resolve;
    });
    const loadStores = vi.fn(() => {
      if (!returning) return Promise.resolve({ workspaces: [open] });
      return listAfterForward ? list : Promise.resolve(confirmedList);
    });
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return loadStores();
      if (resource === 'merchant-applications' && returning) return applications;
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return write;
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    expect(mocks.request).toHaveBeenCalledWith(
      `${path}/availability`,
      'context-a',
      { acceptingOrders: false },
      undefined,
    );

    returning = true;
    readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    await act(async () => window.history.back());
    await waitFor(() => expect(loadStores).toHaveBeenCalledTimes(2));
    if (!listAfterForward) await screen.findByRole('heading', { name: '重新確認的餐坊／一樓' });
    expect(screen.getByText('正在載入店家資料…')).toBeTruthy();
    if (receiptTiming === 'on the list') {
      await act(async () => finishWrite(paused));
      expect(screen.getByText('營業中')).toBeTruthy();
      expect(screen.queryByText('暫停接單')).toBeNull();
    }

    await act(async () => window.history.forward());
    if (listAfterForward) await act(async () => finishList(confirmedList));
    if (receiptTiming !== 'on the list') {
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
      await act(async () => finishWrite(paused));
    }
    await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
    expect(screen.getByText('營業中')).toBeTruthy();
    expect(screen.queryByText('暫停接單')).toBeNull();
    expect(screen.queryByText('服務方式')).toBeNull();

    await act(async () => finishApplications({ applications: [] }));
    expect(screen.getByText('營業中')).toBeTruthy();
  },
);

it.each([403, 404])(
  'reopens with only the newly verified current detail after list denial %s',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const previous = {
      ...detail('store-a', true),
      readinessVersion: 7,
      merchantName: '先前的餐坊',
      paymentMode: 'online-and-counter' as const,
    };
    const current: NuniMerchantWorkspaceDetail = {
      ...detail('store-a', true),
      readinessVersion: 7,
      merchantName: '重新授權的餐坊',
      locationStatus: 'closed',
      publicAccess: false,
      serviceModes: ['pickup', 'dine-in'],
    };
    let listDenied = false;
    const readDetail = vi.fn<() => Promise<NuniMerchantWorkspaceDetail>>(() => Promise.resolve(previous));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces')
        return listDenied
          ? Promise.reject(new NuniError(status, 'DENIED'))
          : Promise.resolve({ workspaces: [previous] });
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '先前的餐坊／一樓' });
    expect(screen.getByText('營業中')).toBeTruthy();

    listDenied = true;
    readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    await act(async () => window.history.back());
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();

    readDetail.mockResolvedValueOnce({ ...current, readinessVersion: 6 });
    await act(async () => window.history.forward());
    const reload = await screen.findByRole<HTMLButtonElement>('button', {
      name: '重新讀取門市狀態',
    });
    await waitFor(() => expect(reload.disabled).toBe(false));
    expect(readDetail).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('heading', { name: '重新授權的餐坊／一樓' })).toBeNull();
    expect(screen.queryByText('暫停接單')).toBeNull();

    readDetail.mockResolvedValue(current);
    fireEvent.click(reload);
    await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
    expect(readDetail).toHaveBeenCalledTimes(4);
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();
    expect(screen.queryByText('先前的餐坊／一樓')).toBeNull();
    const operations = screen.getByRole('region', { name: '接單狀態' });
    expect(within(operations).getByText('自取、內用')).toBeTruthy();
    expect(within(operations).getByText('現場櫃檯付款')).toBeTruthy();
    expect(within(operations).queryByText('線上及櫃檯付款')).toBeNull();
  },
);

it.each([403, 404])(
  'keeps the newer list and detail after a retired list returns %s',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    const current = { ...open, readinessVersion: 7, merchantName: '新確認的餐坊' };
    let denyOld!: (error: NuniError) => void;
    const oldList = new Promise<never>((_, reject) => { denyOld = reject; });
    const readList = vi.fn()
      .mockResolvedValueOnce({ workspaces: [open] })
      .mockReturnValueOnce(oldList)
      .mockResolvedValue({ workspaces: [current] });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(current)
      .mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readList();
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    await act(async () => window.history.back());
    await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
    await act(async () => window.history.forward());
    await screen.findByRole('heading', { name: '新確認的餐坊／一樓', level: 2 });
    await act(async () => window.history.back());
    await waitFor(() => expect(readList).toHaveBeenCalledTimes(3));
    await screen.findByRole('heading', { name: '新確認的餐坊／一樓' });
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));

    await act(async () => denyOld(new NuniError(status, 'DENIED')));
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    expect(screen.getByRole('heading', { name: '新確認的餐坊／一樓' })).toBeTruthy();
    expect(readDetail).toHaveBeenCalledTimes(3);
  },
);

it.each([403, 404])(
  'keeps the newer verified store and revokes other stores when the list returns %s',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    const current = { ...open, readinessVersion: 7, merchantName: '新確認的餐坊' };
    let denyList!: (error: NuniError) => void;
    const list = new Promise<never>((_, reject) => { denyList = reject; });
    const readList = vi.fn()
      .mockResolvedValueOnce({ workspaces: [open, detail('store-b')] })
      .mockReturnValueOnce(list)
      .mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    const readDetail = vi.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(current)
      .mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readList();
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    await act(async () => window.history.back());
    await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
    await act(async () => window.history.forward());
    await screen.findByRole('heading', { name: '新確認的餐坊／一樓', level: 2 });

    await act(async () => denyList(new NuniError(status, 'DENIED')));
    expect(screen.getByRole('heading', { name: '新確認的餐坊／一樓', level: 2 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '暫停接單' })).toBeTruthy();
    expect(readDetail).toHaveBeenCalledTimes(2);

    await act(async () => window.history.back());
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    expect(screen.getByRole('heading', { name: '新確認的餐坊／一樓' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
    expect(screen.queryByRole('link', { name: '管理門市：二樓' })).toBeNull();
  },
);

it.each([
  { status: 403, background: true },
  { status: 404, background: true },
  { status: 403, background: false },
  { status: 404, background: false },
])('keeps the Forward detail after older detail denial $status (background: $background)', async ({
  status,
  background,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = { ...detail('store-a', true), readinessVersion: 7 };
  const current = { ...previous, readinessVersion: 8, merchantName: '新確認的餐坊' };
  let denyOld!: (error: NuniError) => void;
  const oldRead = new Promise<never>((_, reject) => { denyOld = reject; });
  const readDetail = vi.fn()
    .mockImplementationOnce(() => background ? Promise.resolve(previous) : oldRead)
    .mockImplementationOnce(() => background ? oldRead : Promise.resolve(current));
  if (background) readDetail.mockResolvedValueOnce(current);
  readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  mocks.request.mockImplementation((resource) => {
    if (resource === path) return readDetail();
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [previous] });
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  if (background) await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  else await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(1));
  await act(async () => window.history.back());
  await screen.findByRole('link', { name: '管理門市：一樓' });
  const readsBeforeForward = background ? 2 : 1;
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(readsBeforeForward));
  await act(async () => window.history.forward());
  await screen.findByRole('heading', { name: '新確認的餐坊／一樓', level: 2 });

  await act(async () => denyOld(new NuniError(status, 'DENIED')));
  expect(readDetail).toHaveBeenCalledTimes(readsBeforeForward + 1);
  expect(screen.getByRole('heading', { name: '新確認的餐坊／一樓', level: 2 })).toBeTruthy();
  expect(screen.getByRole('button', { name: '暫停接單' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => window.history.back());
  await screen.findByText('目前無法更新部分門市資料，請重新載入。');
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  expect(screen.getByRole('heading', { name: '新確認的餐坊／一樓' })).toBeTruthy();
});

it.each([403, 404])(
  'rechecks the visible store after an accepted list denial %s and a pending read fails',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const previous = { ...detail('store-a', true), readinessVersion: 7 };
    const current = { ...previous, readinessVersion: 7, merchantName: '重新授權的餐坊' };
    let denyList!: (error: NuniError) => void;
    let failForward!: (error: NuniError) => void;
    const list = new Promise<never>((_, reject) => { denyList = reject; });
    const forwardRead = new Promise<never>((_, reject) => { failForward = reject; });
    const readList = vi.fn()
      .mockResolvedValueOnce({ workspaces: [previous] })
      .mockReturnValueOnce(list);
    const readDetail = vi.fn()
      .mockResolvedValueOnce(previous)
      .mockReturnValueOnce(forwardRead)
      .mockResolvedValueOnce(current);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readList();
      if (resource === path) return readDetail();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    await act(async () => window.history.back());
    await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));

    await act(async () => denyList(new NuniError(status, 'DENIED')));
    expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
    await act(async () => failForward(new NuniError(503, 'UNAVAILABLE')));
    await screen.findByRole('heading', { name: '重新授權的餐坊／一樓', level: 2 });
    expect(screen.getByRole('button', { name: '暫停接單' })).toBeTruthy();
    expect(readDetail).toHaveBeenCalledTimes(3);
  },
);

it.each([403, 404])('recovers with a current detail after a stale retry following a %s denial', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = {
    ...detail('store-a', true),
    readinessVersion: 7,
    merchantName: '撤銷前的餐坊',
    paymentMode: 'online-and-counter',
  };
  const recovered = {
    ...detail('store-a', true),
    readinessVersion: 7,
    merchantName: '重新授權的餐坊',
    locationStatus: 'closed',
    publicAccess: false,
    serviceModes: ['pickup', 'dine-in'],
  };
  const readDetail = vi.fn()
    .mockResolvedValueOnce(previous)
    .mockRejectedValueOnce(new NuniError(status, 'DENIED'))
    .mockResolvedValueOnce({
      ...recovered,
      readinessVersion: 6,
      merchantName: '過期的門市',
      missingRequirements: ['menu'],
    })
    .mockResolvedValueOnce(recovered);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [previous] });
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '撤銷前的餐坊／一樓' });

  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  await screen.findByText(/目前無法取得這間門市的管理權限/);
  expect(screen.queryByText('服務方式')).toBeNull();
  expect(screen.queryByText('撤銷前的餐坊／一樓')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  const reload = screen.getByRole<HTMLButtonElement>('button', { name: '重新讀取門市狀態' });
  await waitFor(() => expect(reload.disabled).toBe(false));
  expect(readDetail).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole('heading', { name: '過期的門市／一樓' })).toBeNull();
  expect(screen.queryByText(/建立有庫存的首次菜單/)).toBeNull();
  expect(screen.queryByText('服務方式')).toBeNull();

  fireEvent.click(reload);
  await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
  expect(readDetail).toHaveBeenCalledTimes(4);
  expect(screen.getByText('暫停接單')).toBeTruthy();
  expect(screen.queryByText('營業中')).toBeNull();
  expect(screen.getByText('自取、內用')).toBeTruthy();
  expect(screen.getByText('現場櫃檯付款')).toBeTruthy();
});

it.each([
  { status: 403, pending: true },
  { status: 404, pending: false },
])('revokes a detail read denied with $status after Back (background pending: $pending)', async ({
  status,
  pending,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = { ...detail('store-a', true), readinessVersion: 7, merchantName: '撤銷前的餐坊' };
  const recovered = {
    ...detail('store-a', true),
    readinessVersion: 7,
    merchantName: '重新授權的餐坊',
    locationStatus: 'closed',
    publicAccess: false,
  };
  let denyRead!: (error: NuniError) => void;
  const manual = new Promise<never>((_, reject) => {
    denyRead = reject;
  });
  let failBackground!: (error: NuniError) => void;
  const background = new Promise<never>((_, reject) => {
    failBackground = reject;
  });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(previous)
    .mockReturnValueOnce(manual)
    .mockReturnValueOnce(background)
    .mockResolvedValueOnce(recovered);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces')
      return readDetail.mock.calls.length > 0
        ? Promise.reject(new NuniError(503, 'UNAVAILABLE'))
        : Promise.resolve({ workspaces: [previous] });
    if (resource === path) return readDetail();
    if (resource === 'merchant-applications')
      return Promise.resolve({
        applications: [
          {
            tenantId: previous.tenantId,
            applicationId: previous.applicationId,
            brandName: '核准申請',
            locationName: '一樓',
            state: 'approved',
            reviewerNote: '',
            submittedAt: '2026-10-09T02:00:00.000Z',
          },
        ],
      });
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '撤銷前的餐坊／一樓' });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));

  await act(async () => denyRead(new NuniError(status, 'DENIED')));
  if (!pending) await act(async () => failBackground(new NuniError(503, 'UNAVAILABLE')));
  expect(screen.getByRole('heading', { name: '核准申請／一樓' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  expect(screen.queryByRole('link', { name: '前往管理門市：一樓' })).toBeNull();
  expect(screen.queryByText(/這個帳號目前沒有已核准的門市/)).toBeNull();
  expect(screen.queryByRole('button', { name: '登出並切換店家帳號' })).toBeNull();
  expect(screen.queryByText(/目前還沒有可管理的門市/)).toBeNull();
  expect(screen.queryByText(/這個場域的門市尚未出現在清單/)).toBeNull();

  await act(async () => window.history.forward());
  await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
  if (pending) await act(async () => failBackground(new NuniError(503, 'UNAVAILABLE')));
  expect(screen.getByText('暫停接單')).toBeTruthy();
  expect(screen.queryByText('撤銷前的餐坊／一樓')).toBeNull();
});

it.each([
  { source: 'list', status: 403 },
  { source: 'list', status: 404 },
  { source: 'detail', status: 403 },
  { source: 'detail', status: 404 },
])('discards the initial menu receipt after $source denial $status', async ({ source, status }) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = { ...detail(), readinessVersion: 7 };
  const recovered = { ...detail(), readinessVersion: 7, missingRequirements: ['menu'] };
  let listDenied = false;
  const readDetail = vi.fn()
    .mockResolvedValueOnce(previous)
    .mockResolvedValue({ ...previous, missingRequirements: ['settings'], publishedMenuItems: 1 });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces')
      return listDenied
        ? Promise.reject(new NuniError(status, 'DENIED'))
        : Promise.resolve({ workspaces: [previous] });
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`)
      return Promise.resolve({
        menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
        createdItems: 1,
      });
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.change(await screen.findByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
  fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
  fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(screen.queryByText(/建立有庫存的首次菜單/)).toBeNull();

  const reload = () => fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  if (source === 'list') {
    listDenied = true;
    readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
    await act(async () => window.history.back());
    await screen.findByText('目前無法確認店家資料，請重新載入。');
    readDetail.mockResolvedValue({ ...recovered, readinessVersion: 6 });
    await act(async () => window.history.forward());
  } else {
    readDetail.mockRejectedValueOnce(new NuniError(status, 'DENIED'));
    reload();
    await screen.findByText(/目前無法取得這間門市的管理權限/);
    readDetail.mockResolvedValue({ ...recovered, readinessVersion: 6 });
    reload();
  }

  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新讀取門市狀態' }).disabled)
      .toBe(false),
  );
  expect(screen.queryByText('待完成：建立有庫存的首次菜單')).toBeNull();
  expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();

  readDetail.mockResolvedValue(recovered);
  reload();
  await screen.findByText('待完成：建立有庫存的首次菜單');
  expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();
  expect(screen.queryByText(/目前有 0 項有庫存的上架品項/)).toBeNull();
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '確認建立並上架菜單' }).disabled)
    .toBe(true);
});

it.each([
  { receiptFirst: true, listVersion: 6, detailVersion: 6, publishedMenuItems: 0 },
  { receiptFirst: false, listVersion: 6, detailVersion: 6, publishedMenuItems: 0 },
  { receiptFirst: true, listVersion: 7, detailVersion: 6, publishedMenuItems: 0 },
  { receiptFirst: true, listVersion: 7, detailVersion: 6, publishedMenuItems: 3 },
  { receiptFirst: true, listVersion: undefined, detailVersion: 6, publishedMenuItems: 0 },
])(
  'uses the winning list requirements in the detail (list: $listVersion, detail: $detailVersion, receipt first: $receiptFirst, published items: $publishedMenuItems)',
  async ({ receiptFirst, listVersion, detailVersion, publishedMenuItems }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial = { ...detail(), readinessVersion: detailVersion };
    const missingMenu = { ...initial, readinessVersion: listVersion, missingRequirements: ['menu'] };
    const refreshedDetail = {
      ...initial,
      readinessVersion: listVersion === undefined ? detailVersion - 1 : detailVersion,
      missingRequirements: listVersion === detailVersion ? ['menu'] : [],
      publishedMenuItems,
    };
    type MenuReceipt = { menuVersionId: string; createdItems: number };
    let finishMenu!: (receipt: MenuReceipt) => void;
    const receipt = new Promise<MenuReceipt>((resolve) => {
      finishMenu = resolve;
    });
    let finishApplications!: (value: { applications: [] }) => void;
    const applications = new Promise<{ applications: [] }>((resolve) => {
      finishApplications = resolve;
    });
    const readApplications = vi.fn()
      .mockResolvedValueOnce({ applications: [] })
      .mockReturnValue(applications);
    const readStores = vi.fn()
      .mockResolvedValueOnce({ workspaces: [initial] })
      .mockResolvedValue({ workspaces: [missingMenu] });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(refreshedDetail);
    const writeMenu = vi.fn(() => receipt);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readStores();
      if (resource === 'merchant-applications') return readApplications();
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return writeMenu();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.change(await screen.findByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
    fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
    fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
    expect(writeMenu).toHaveBeenCalledTimes(1);

    const resolveReceipt = () =>
      act(async () =>
        finishMenu({
          menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
          createdItems: 1,
        }),
      );
    if (receiptFirst) {
      readDetail.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
      await resolveReceipt();
      await screen.findByText(/已建立 1 項首次菜單/);
      expect(screen.queryByText(/建立有庫存的首次菜單/)).toBeNull();
    }

    await act(async () => window.history.back());
    await waitFor(() => expect(readApplications).toHaveBeenCalledTimes(2));
    const storeHeading = await screen.findByRole('heading', { name: '餐坊／一樓' });
    expect(!!screen.queryByRole('link', { name: '管理門市：一樓' })).toBe(!receiptFirst);
    const row = within(storeHeading.closest('li')!);
    if (!receiptFirst) {
      expect(row.getByText('待完成：建立菜單')).toBeTruthy();
      await resolveReceipt();
    }
    if (listVersion === undefined || listVersion === detailVersion) {
      if (listVersion === undefined) expect(row.getByText('待完成：確認營運設定與條款')).toBeTruthy();
      expect(row.queryByText(/建立菜單/)).toBeNull();
      const detailReadsBeforeForward = readDetail.mock.calls.length;
      await act(async () => window.history.forward());
      await waitFor(() => expect(readDetail.mock.calls.length).toBeGreaterThan(detailReadsBeforeForward));
      await act(async () => finishApplications({ applications: [] }));
      readDetail.mockResolvedValue({ ...initial, missingRequirements: ['settings'], publishedMenuItems: 1 });
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
      await screen.findByText(/已建立 1 項首次菜單/);
      expect(screen.queryByText(/建立有庫存的首次菜單/)).toBeNull();
      return;
    }
    expect(row.queryByText(/確認營運設定與條款/)).toBeNull();
    expect(row.getByText('待完成：建立菜單')).toBeTruthy();
    const detailReadsBeforeForward = readDetail.mock.calls.length;
    await act(async () => window.history.forward());
    await screen.findByText('待完成：建立有庫存的首次菜單');
    expect(readDetail.mock.calls.length).toBeGreaterThan(detailReadsBeforeForward);
    expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();
    await act(async () => finishApplications({ applications: [] }));
    expect(screen.queryByText(/目前有 \d+ 項有庫存的上架品項/)).toBeNull();
    if (listVersion !== detailVersion) {
      expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
      readDetail.mockResolvedValue({
        ...initial,
        ...missingMenu,
        readinessVersion: listVersion,
      });
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
    }
    const menuName = await screen.findByLabelText<HTMLInputElement>('品項 1 名稱');
    expect(menuName.value).toBe('蔬菜便當');
    expect(screen.queryByText(/目前有 \d+ 項有庫存的上架品項/)).toBeNull();
  },
);

function submitFirstMenu() {
  fireEvent.change(screen.getByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
  fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
  fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
}

it.each([6, 7])('keeps a winning initial menu receipt through write and re-entry GETs at v%s', async (version) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const beforeMenu = { ...detail(), readinessVersion: 7 };
  const stale = { ...beforeMenu, readinessVersion: version };
  const readDetail = vi.fn()
    .mockResolvedValueOnce(beforeMenu)
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce({ ...beforeMenu, missingRequirements: ['settings'], publishedMenuItems: 1 })
    .mockResolvedValue(stale);
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [beforeMenu] })
    .mockResolvedValue({ workspaces: [{ ...beforeMenu, missingRequirements: ['settings'] }] });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`) return Promise.resolve(firstMenuReceipt);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByLabelText('品項 1 名稱');
  submitFirstMenu();
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();

  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
});

const firstMenuReceipt = {
  menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
  createdItems: 1,
};

it.each(['entry GET', 'list background GET'])(
  'restores operations after a confirmed menu receipt and a stale post-write read with v8 from the %s',
  async (confirmationSource) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial = { ...detail(), readinessVersion: 7 };
    const operating = { ...detail('store-a', true), readinessVersion: 8 };
    let finishMenu!: (value: typeof firstMenuReceipt) => void;
    const writeMenu = vi.fn(() => new Promise<typeof firstMenuReceipt>((resolve) => {
      finishMenu = resolve;
    }));
    let finishRefresh!: (value: typeof initial) => void;
    const refresh = new Promise<typeof initial>((resolve) => { finishRefresh = resolve; });
    const confirmedOnList = confirmationSource === 'list background GET';
    const readStores = vi.fn()
      .mockResolvedValueOnce({ workspaces: [initial] })
      .mockResolvedValue({ workspaces: [confirmedOnList ? operating : initial] });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(confirmedOnList ? operating : initial)
      .mockResolvedValueOnce(confirmedOnList ? initial : operating)
      .mockReturnValueOnce(refresh);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readStores();
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return writeMenu();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    submitFirstMenu();
    expect(writeMenu).toHaveBeenCalledTimes(1);
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    if (confirmedOnList) await screen.findByText('營業中');
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
    await act(async () => finishMenu(firstMenuReceipt));
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
    await act(async () => finishRefresh(initial));

    expect(screen.getByText('營業中')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
    expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('region', { name: '門市訂單工作台' });
    expect(readDetail).toHaveBeenCalledTimes(4);
  },
);

it.each([200, 403, 404, 503])(
  'reconciles a confirmed menu write that settles on the list before history forward (GET %s)',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial = { ...detail(), readinessVersion: 7 };
    const operating = { ...detail('store-a', true), readinessVersion: 8 };
    let finishMenu!: (value: typeof firstMenuReceipt) => void;
    const writeMenu = vi.fn(() => new Promise<typeof firstMenuReceipt>((resolve) => {
      finishMenu = resolve;
    }));
    const readStores = vi.fn()
      .mockResolvedValueOnce({ workspaces: [initial] })
      .mockResolvedValue({ workspaces: [operating] });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(operating)
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => status === 200
        ? Promise.resolve(initial)
        : Promise.reject(new NuniError(status, 'UNAVAILABLE')));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readStores();
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return writeMenu();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    submitFirstMenu();
    expect(writeMenu).toHaveBeenCalledTimes(1);
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    await screen.findByText('營業中');

    await act(async () => finishMenu(firstMenuReceipt));
    expect(readDetail).toHaveBeenCalledTimes(3);
    await act(async () => window.history.forward());

    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
    if (status !== 200) {
      await screen.findByRole('button', { name: '重新讀取門市狀態' });
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      return;
    }

    await screen.findByRole('button', { name: '暫停接單' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' }).disabled).toBe(false);
    expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('region', { name: '門市訂單工作台' });
  },
);

it.each([200, 403, 404, 503])(
  'reconciles a winning menu write that settles on the list before history forward (GET %s)',
  async (status) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial = { ...detail(), readinessVersion: 7 };
    const operating = { ...detail('store-a', true), readinessVersion: 8 };
    let finishMenu!: (value: typeof firstMenuReceipt) => void;
    const writeMenu = vi.fn(() => new Promise<typeof firstMenuReceipt>((resolve) => {
      finishMenu = resolve;
    }));
    let finishStores!: (value: { workspaces: (typeof initial)[] }) => void;
    const stores = new Promise<{ workspaces: (typeof initial)[] }>((resolve) => {
      finishStores = resolve;
    });
    const readStores = vi.fn()
      .mockResolvedValueOnce({ workspaces: [initial] })
      .mockReturnValue(stores);
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(operating)
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => status === 200
        ? Promise.resolve(initial)
        : Promise.reject(new NuniError(status, 'UNAVAILABLE')));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readStores();
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return writeMenu();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    submitFirstMenu();
    expect(writeMenu).toHaveBeenCalledTimes(1);
    await act(async () => window.history.back());
    await waitFor(() => expect(readStores).toHaveBeenCalledTimes(2));
    expect(readDetail).toHaveBeenCalledTimes(1);

    // The receipt wins while the list is pending and its hidden refresh confirms v8.
    await act(async () => finishMenu(firstMenuReceipt));
    expect(readDetail).toHaveBeenCalledTimes(2);
    await act(async () => finishStores({ workspaces: [initial] }));
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
    await screen.findByText('營業中');
    await act(async () => window.history.forward());

    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
    if (status !== 200) {
      await screen.findByRole('button', { name: '重新讀取門市狀態' });
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      return;
    }

    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' })).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('region', { name: '門市訂單工作台' });
  },
);

it.each([
  { conflict: false, status: 200 },
  { conflict: false, status: 403 },
  { conflict: false, status: 404 },
  { conflict: false, status: 503 },
  { conflict: true, status: 200 },
  { conflict: true, status: 503 },
])(
  'reconciles a post-write read that finishes on the list (conflict: $conflict, return GET: $status)',
  async ({ conflict, status }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const operating = { ...detail('store-a', true), readinessVersion: 8 };
    const initial = { ...(conflict ? operating : detail()), readinessVersion: 7 };
    const write = Promise.withResolvers<typeof firstMenuReceipt>();
    const refresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const list = Promise.withResolvers<{ workspaces: NuniMerchantWorkspaceDetail[] }>();
    const readStores = vi.fn()
      .mockResolvedValueOnce({ workspaces: [initial] })
      .mockReturnValue(list.promise);
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => status === 200
        ? Promise.resolve(initial)
        : Promise.reject(new NuniError(status, 'UNAVAILABLE')));
    const writePath = conflict ? `${path}/availability` : `${path}/initial-menu`;
    const writeRequest = vi.fn(() => write.promise);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readStores();
      if (resource === path) return readDetail();
      if (resource === writePath) return writeRequest();
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    if (conflict) {
      fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    } else {
      await screen.findByLabelText('品項 1 名稱');
      submitFirstMenu();
      await act(async () => write.resolve(firstMenuReceipt));
      await screen.findByText(/已建立 1 項首次菜單/);
      expect(readDetail).toHaveBeenCalledTimes(2);
    }
    expect(writeRequest).toHaveBeenCalledTimes(1);

    await act(async () => window.history.back());
    await waitFor(() => expect(readStores).toHaveBeenCalledTimes(2));
    if (conflict) {
      await act(async () => write.reject(new NuniError(409, 'FOOD_MERCHANT_WORKSPACE_CHANGED')));
      expect(readDetail).toHaveBeenCalledTimes(2);
    }
    await act(async () => refresh.resolve(operating));
    await act(async () => list.resolve({ workspaces: [initial] }));
    await screen.findByText('營業中');
    expect(readDetail).toHaveBeenCalledTimes(3);

    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
    if (status !== 200) {
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
      expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
      return;
    }

    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' })).disabled).toBe(false);
    expect(screen.queryByText(/無法確認門市目前的資料/)).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('region', { name: '門市訂單工作台' });
  },
);

it('preserves deferred reconciliation when the first menu refresh finishes after history forward', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const initial = { ...detail(), readinessVersion: 7 };
  const operating = { ...detail('store-a', true), readinessVersion: 8 };
  const refresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readDetail = vi.fn()
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValueOnce(operating)
    .mockResolvedValue(initial);
  const writeMenu = vi.fn().mockResolvedValue(firstMenuReceipt);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [initial] });
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`) return writeMenu();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByLabelText('品項 1 名稱');
  submitFirstMenu();
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(writeMenu).toHaveBeenCalledTimes(1);
  expect(readDetail).toHaveBeenCalledTimes(2);

  await act(async () => window.history.back());
  await screen.findByText('營業中');
  expect(readDetail).toHaveBeenCalledTimes(3);
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
  expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();

  await act(async () => refresh.resolve(initial));
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(5));
  expect((await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' })).disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: '處理訂單與收銀' }));
  await screen.findByRole('region', { name: '門市訂單工作台' });
});

it.each([undefined, 7, 8])('keeps a v7 menu receipt confirmed at v8 through list version %s and a stale detail', async (version) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const initial = { ...detail(), readinessVersion: 7 };
  const published = {
    ...initial, readinessVersion: 8, missingRequirements: ['settings'], publishedMenuItems: 1,
  };
  const preWrite = { ...initial, readinessVersion: version, missingRequirements: ['menu'] };
  const readStores = vi.fn()
    .mockResolvedValueOnce({ workspaces: [initial] })
    .mockResolvedValue({ workspaces: [preWrite] });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(published)
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'))
    .mockResolvedValue({ ...published, missingRequirements: ['menu'] });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readStores();
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`) return Promise.resolve(firstMenuReceipt);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByLabelText('品項 1 名稱');
  submitFirstMenu();
  await screen.findByText('目前有 1 項有庫存的上架品項。首次菜單只能建立一次。');
  expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();

  await act(async () => window.history.back());
  await screen.findByText('目前無法更新部分門市資料，請重新載入。');
  const storeHeading = screen.getByRole('heading', { name: '餐坊／一樓' });
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  const row = within(storeHeading.closest('li')!);
  if (version !== 8) expect(row.getByText('待完成：確認營運設定與條款')).toBeTruthy();
  expect(row.queryByText(/建立菜單/)).toBeNull();
  expect(readDetail).toHaveBeenCalledTimes(3);

  await act(async () => window.history.forward());
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(screen.queryByText(/建立有庫存的首次菜單/)).toBeNull();
});

it.each(['missing', 'present'])(
  'shows a v7 first-menu receipt after a pre-receipt v8 detail with menu %s',
  async (menuState) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial = { ...detail(), readinessVersion: 7 };
    const published = {
      ...initial, readinessVersion: 8, missingRequirements: ['settings'], publishedMenuItems: 1,
    };
    const intermediate = menuState === 'present'
      ? published
      : { ...published, missingRequirements: ['menu'], publishedMenuItems: 0 };
    const receipt = Promise.withResolvers<typeof firstMenuReceipt>();
    const snapshot = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(snapshot.promise)
      .mockResolvedValueOnce(intermediate)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(published);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [initial] });
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return receipt.promise;
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    submitFirstMenu();

    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    await act(async () => snapshot.resolve(intermediate));
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
    await act(async () => receipt.resolve(firstMenuReceipt));
    expect(readDetail).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();
    expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
    await screen.findByText(/目前有 1 項有庫存的上架品項/);
    expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();
  },
);

it('keeps the first menu receipt when the v8 list arrives first and two entries return v7', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const initial = { ...detail(), readinessVersion: 7 };
  const published = { ...detail('store-a', true), readinessVersion: 8 };
  const staleList = { ...published, missingRequirements: ['menu'] };
  const confirmation = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readStores = vi.fn()
    .mockResolvedValueOnce({ workspaces: [initial] })
    .mockResolvedValue({ workspaces: [staleList] });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(confirmation.promise)
    .mockResolvedValue(initial);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readStores();
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`) return Promise.resolve(firstMenuReceipt);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByLabelText('品項 1 名稱');
  submitFirstMenu();
  await screen.findByText(/已建立 1 項首次菜單/);

  await act(async () => window.history.back());
  await screen.findByText('待完成：建立菜單');
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  await act(async () => confirmation.resolve(published));
  expect(screen.queryByText('待完成：建立菜單')).toBeNull();

  for (const expectedReads of [4, 6]) {
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(expectedReads));
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' })).disabled).toBe(false);
    expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    if (expectedReads === 4) {
      await act(async () => window.history.back());
      await screen.findByRole('link', { name: '管理門市：一樓' });
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(5));
    }
  }
});

it('closes both management entries after list and detail failures until a detail confirms access', async () => {
  const store = detail('store-a', true);
  const path = 'merchant-workspaces/campus-one/store-a';
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  const recovery = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [store] })
    .mockRejectedValueOnce(unavailable)
    .mockResolvedValue({ workspaces: [store] });
  const readDetail = vi.fn()
    .mockRejectedValueOnce(unavailable)
    .mockReturnValueOnce(recovery.promise);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === 'merchant-applications') {
      return Promise.resolve({ applications: [{
        tenantId: store.tenantId,
        applicationId: store.applicationId,
        brandName: '核准申請',
        locationName: store.locationName,
        state: 'approved',
        reviewerNote: '',
        submittedAt: '2026-10-09T02:00:00.000Z',
      }] });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const storeLink = () => screen.queryByRole('link', { name: '管理門市：一樓' });
  const applicationLink = () => screen.queryByRole('link', { name: '前往管理門市：一樓' });
  await waitFor(() => expect(applicationLink()).toBeTruthy());
  expect(storeLink()).toBeTruthy();
  const reload = screen.getByRole<HTMLButtonElement>('button', { name: '重新載入' });
  await waitFor(() => expect(reload.disabled).toBe(false));
  fireEvent.click(reload);
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(readDetail).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: '餐坊／一樓' })).toBeTruthy();
  expect(storeLink()).toBeNull();
  expect(applicationLink()).toBeNull();

  fireEvent.click(reload);
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  expect(storeLink()).toBeNull();
  expect(applicationLink()).toBeNull();
  await act(async () => recovery.resolve(store));
  expect(storeLink()).toBeTruthy();
  expect(applicationLink()).toBeTruthy();
});

it('keeps a confirmed empty store list when both the list and detail refresh fail', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [detail()] })
    .mockResolvedValueOnce({ workspaces: [] })
    .mockRejectedValue(unavailable);
  const readDetail = vi.fn().mockResolvedValueOnce(detail()).mockRejectedValue(unavailable);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByText(/這個帳號目前沒有已核准的門市/);

  await screen.findByText(/目前無法更新部分門市資料/);
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(screen.getByRole('button', { name: '登出並切換店家帳號' })).toBeTruthy();
  expect(readList).toHaveBeenCalledTimes(3);
  expect(readDetail).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('餐坊／一樓')).toBeNull();
  expect(screen.queryByRole('link', { name: /管理門市：一樓/ })).toBeNull();
});

it.each([403, 404])('keeps a confirmed empty list through denial %s and a later 503', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const store = detail();
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [store] })
    .mockResolvedValueOnce({ workspaces: [] })
    .mockRejectedValueOnce(new NuniError(status, 'DENIED'))
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'))
    .mockResolvedValue({ workspaces: [store] });
  const readDetail = vi.fn().mockResolvedValue(store);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByText(/目前沒有已核准的門市/);
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));

  const reload = async (expectedDetailReads: number) => {
    fireEvent.click(await screen.findByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(expectedDetailReads));
    await screen.findByText('目前無法確認店家資料，請重新載入。');
  };
  await reload(3);
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  await reload(4);
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  expect(screen.getByText(/目前沒有已核准的門市/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByRole('link', { name: '管理門市：一樓' });
});

it('adopts a pending empty list after a newer list and detail refresh return 503', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  let finishList!: (value: { workspaces: [] }) => void;
  const pendingList = new Promise<{ workspaces: [] }>((resolve) => {
    finishList = resolve;
  });
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [detail()] })
    .mockReturnValueOnce(pendingList)
    .mockRejectedValueOnce(unavailable);
  const readDetail = vi.fn().mockResolvedValueOnce(detail()).mockRejectedValue(unavailable);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const manage = await screen.findByRole('link', { name: '管理門市：一樓' });
  fireEvent.click(manage);
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });

  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  await act(async () => window.history.forward());
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  const readsBeforeBack = readDetail.mock.calls.length;
  await act(async () => window.history.back());
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(readDetail).toHaveBeenCalledTimes(readsBeforeBack + 1);
  expect(readList).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('heading', { name: '餐坊／一樓' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();

  await act(async () => finishList({ workspaces: [] }));
  await screen.findByRole('button', { name: '登出並切換店家帳號' });
  expect(screen.queryByRole('heading', { name: '餐坊／一樓' })).toBeNull();
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
});

it('keeps the newer initial menu receipt after an earlier empty list removes the store', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const initial = detail();
  const published = { ...initial, missingRequirements: ['settings'], publishedMenuItems: 1 };
  let finishList!: (value: { workspaces: NuniMerchantWorkspace[] }) => void;
  const pendingList = new Promise<{ workspaces: NuniMerchantWorkspace[] }>((resolve) => {
    finishList = resolve;
  });
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [initial] })
    .mockReturnValueOnce(pendingList)
    .mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  let menuCreated = false;
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return Promise.resolve(menuCreated ? published : initial);
    if (resource === `${path}/initial-menu`) {
      menuCreated = true;
      return Promise.resolve({
        menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
        createdItems: 1,
      });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
  fireEvent.change(await screen.findByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
  fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
  fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
  await screen.findByText(/已建立 1 項首次菜單/);

  await act(async () => finishList({ workspaces: [] }));
  expect(screen.getByText(/已建立 1 項首次菜單/)).toBeTruthy();

  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
  await act(async () => window.history.forward());
  await screen.findByText(/已建立 1 項首次菜單/);
  expect(screen.queryByText('待完成：建立有庫存的首次菜單')).toBeNull();
});

it('discards the initial menu receipt when a confirmed empty list removes the store', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const initial = detail();
  const published = { ...initial, missingRequirements: ['settings'], publishedMenuItems: 1 };
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [initial] })
    .mockResolvedValue({ workspaces: [] });
  const readDetail = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(published);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/initial-menu`)
      return Promise.resolve({
        menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
        createdItems: 1,
      });
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.change(await screen.findByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
  fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
  fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
  await screen.findByText(/已建立 1 項首次菜單/);

  readDetail.mockRejectedValue(unavailable);
  await act(async () => window.history.back());
  await screen.findByText(/這個帳號目前沒有已核准的門市/);
  await screen.findByText(/目前無法更新部分門市資料/);
  const readsBeforeForward = readDetail.mock.calls.length;
  await act(async () => window.history.forward());
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  expect(readDetail).toHaveBeenCalledTimes(readsBeforeForward + 1);
  expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();
  expect(screen.queryByRole('heading', { name: '餐坊／一樓' })).toBeNull();
  expect(screen.queryByRole('button', { name: '儲存營運設定' })).toBeNull();

  readDetail.mockResolvedValue(published);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();
});

it.each([403, 404])('ignores a retired application list denial (%s) after a newer success', async (status) => {
  let rejectFirst!: (error: NuniError) => void;
  const first = new Promise<never>((_, reject) => {
    rejectFirst = reject;
  });
  const readApplications = vi.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue({
      applications: [
        {
          tenantId: 'campus-one',
          applicationId: 'application-1',
          brandName: '測試餐坊',
          locationName: '餐廳櫃位',
          state: 'under-review',
          reviewerNote: '已開始審核',
          submittedAt: '2026-10-09T02:00:00.000Z',
        },
      ],
    });
  mocks.request.mockImplementation((resource) =>
    resource === 'merchant-applications' ? readApplications() : respond(resource),
  );

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  await act(async () => window.history.back());
  await screen.findByText('審核說明：已開始審核');
  expect(readApplications).toHaveBeenCalledTimes(2);

  await act(async () => rejectFirst(new NuniError(status, 'DENIED')));
  expect(screen.getByRole('heading', { name: '測試餐坊／餐廳櫃位' })).toBeTruthy();
  expect(screen.getByText('審核說明：已開始審核')).toBeTruthy();
});

it.each([
  { status: 403, denialFirst: false },
  { status: 404, denialFirst: false },
  { status: 403, denialFirst: true },
  { status: 404, denialFirst: true },
])('revokes the first detail denied with $status with a newer legacy list and background 503 (denial first: $denialFirst)', async ({
  status,
  denialFirst,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  const legacy = { ...detail(), readinessVersion: undefined };
  let denyFirst!: (error: NuniError) => void;
  const first = new Promise<never>((_, reject) => {
    denyFirst = reject;
  });
  const readDetail = vi.fn().mockReturnValueOnce(first).mockRejectedValue(unavailable);
  const readApplications = vi.fn()
    .mockResolvedValueOnce({ applications: [] })
    .mockRejectedValue(unavailable);
  const updatedList = { workspaces: [{ ...legacy, merchantName: '更新店名' }] };
  let resolveReturnList!: (value: typeof updatedList) => void;
  const returnList = new Promise<typeof updatedList>((resolve) => {
    resolveReturnList = resolve;
  });
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [legacy] })
    .mockReturnValue(returnList);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === 'merchant-applications') return readApplications();
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(1));
  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  if (denialFirst) {
    await act(async () => denyFirst(new NuniError(status, 'DENIED')));
  }
  await act(async () => resolveReturnList(updatedList));
  await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(readDetail).toHaveBeenCalledTimes(2);

  if (!denialFirst) {
    await screen.findByRole('heading', { name: '更新店名／一樓' });
    await act(async () => denyFirst(new NuniError(status, 'DENIED')));
  }
  expect(screen.queryByRole('heading', { name: `${legacy.merchantName}／一樓` })).toBeNull();
  expect(screen.queryByRole('heading', { name: '更新店名／一樓' })).toBeNull();
  expect(screen.queryByRole('link', { name: /管理門市：一樓/ })).toBeNull();
});

it.each(['before', 'after'])(
  'requires a new detail when a newer background read fails %s stale re-entry',
  async (failureArrival) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = { ...detail('store-a', true), readinessVersion: 7 };
    const paused = { ...open, readinessVersion: 8, locationStatus: 'closed', publicAccess: false };
    const olderRefresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const newerRefresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const readDetail = vi.fn()
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(open)
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(newerRefresh.promise)
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(paused);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') {
        return Promise.resolve({ workspaces: [open, detail('store-b')] });
      }
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return Promise.resolve(paused);
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await screen.findByText('門市狀態已更新：暫停接單。');
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));

    // Reenter the list through another store while the first background read is pending.
    fireEvent.click(screen.getByRole('link', { name: '管理門市：二樓' }));
    await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
    const failNewerRefresh = () => act(async () => newerRefresh.reject(new NuniError(503, 'UNAVAILABLE')));
    if (failureArrival === 'before') {
      await failNewerRefresh();
      await screen.findByText('目前無法更新部分門市資料，請重新載入。');
    }

    await act(async () => olderRefresh.resolve(paused));
    if (failureArrival === 'before') {
      expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
      await act(async () => {
        window.history.pushState(null, '', href());
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    } else {
      fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
    }
    if (failureArrival === 'after') {
      expect((await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' })).disabled).toBe(false);
      expect(screen.getByRole('link', { name: '處理訂單與收銀' })).toBeTruthy();
      await failNewerRefresh();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復接單' }).disabled).toBe(true);
    } else {
      await waitFor(() => expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull());
    }
    await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
    const retry = screen.getByRole('button', { name: '重新讀取門市狀態' });
    expect(readDetail).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();

    fireEvent.click(retry);
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' })).disabled).toBe(false);
  },
);

it.each(['availability', 'orders', 'orders-retry', 'orders-in-flight', 'orders-in-flight-overview', 'stale-entry', 'orders-then-queue-failure', 'orders-then-shift-failure'])('blocks %s immediately when a retired list GET returns 503', async (section) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const orders = section.startsWith('orders');
  const inFlight = section.startsWith('orders-in-flight');
  const switchToOverview = section === 'orders-in-flight-overview';
  const staleEntry = section === 'stale-entry';
  const pollResource = section === 'orders-then-queue-failure' ? 'orders'
    : section === 'orders-then-shift-failure' ? 'shift' : null;
  const retry = section === 'orders-retry' || pollResource !== null;
  const unavailable = new NuniError(503, 'UNAVAILABLE');
  const initial = {
    ...detail('store-a', true),
    readinessVersion: 7,
    locationStatus: orders ? 'closed' : 'open',
    publicAccess: !orders,
  };
  const updated = {
    ...initial, readinessVersion: 8, locationStatus: orders ? 'open' : 'closed', publicAccess: orders,
  };
  const olderDetail = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const failedList = Promise.withResolvers<{ workspaces: NuniMerchantWorkspaceDetail[] }>();
  const list = { workspaces: [initial, detail('store-b')] };
  const readList = vi.fn().mockResolvedValueOnce(list).mockResolvedValueOnce(list).mockReturnValue(failedList.promise);
  const readDetail = vi.fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(olderDetail.promise)
    .mockResolvedValueOnce(initial)
    .mockResolvedValue(updated);
  const changeAvailability = vi.fn().mockResolvedValue(updated);
  const orderReceipt = {
    orderId: 'order-1', state: 'accepted', updatedAt: future, replayed: false, kitchenTicketId: 'ticket-1',
  };
  const pendingOrder = Promise.withResolvers<typeof orderReceipt>();
  const acceptOrder = vi.fn().mockResolvedValue(orderReceipt);
  const failedPoll = Promise.withResolvers<never>();
  const orderReads = vi.fn((resource: string) => Promise.resolve(resource === 'orders'
    ? { orders: [{ ...queueFixture(), locationId: 'store-a', state: 'paid', allowedActions: ['accept'] }] }
    : { ...shiftFixture(), locationId: 'store-a' }));
  if (inFlight) acceptOrder.mockReturnValueOnce(pendingOrder.promise);
  if (retry) acceptOrder.mockRejectedValueOnce(unavailable);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return changeAvailability();
    if (resource.endsWith('/orders')) return orderReads('orders');
    if (resource.endsWith('/shift')) return orderReads('shift');
    if (resource.endsWith('/accept')) return acceptOrder();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const storeLink = await screen.findByRole<HTMLAnchorElement>('link', { name: '管理門市：一樓' });
  const storeHref = storeLink.href;
  fireEvent.click(storeLink);
  fireEvent.click(await screen.findByRole('button', { name: orders ? '恢復接單' : '暫停接單' }));
  await screen.findByText(orders ? '門市狀態已更新：營業中。' : '門市狀態已更新：暫停接單。');
  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));

  fireEvent.click(screen.getByRole('link', { name: '管理門市：二樓' }));
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(3));
  if (staleEntry) {
    // Retire the list before its failure so no follow-up detail can account for the lock.
    fireEvent.click(screen.getByRole('link', { name: '管理門市：二樓' }));
    await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
    await act(async () => failedList.reject(unavailable));
    await act(async () => olderDetail.resolve(updated));
    await act(async () => {
      window.history.pushState(null, '', storeHref);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
    expect(readDetail).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
    return;
  }
  await act(async () => olderDetail.resolve(updated));
  fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
  const orderLink = await screen.findByRole('link', { name: '處理訂單與收銀' });
  if (orders) {
    fireEvent.click(orderLink);
    fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
    fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  }
  if (retry) {
    fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
    await screen.findByRole('button', { name: '重試同一份操作' });
  }
  const submit = screen.getByRole<HTMLButtonElement>('button', {
    name: retry ? '重試同一份操作' : orders ? '確認：接單' : '恢復接單',
  });
  expect(submit.disabled).toBe(false);

  const pendingIntent = () => loadFoodPending('account-a', 'merchant-food:campus-one:store-a');
  if (inFlight) {
    fireEvent.click(submit);
    expect(acceptOrder).toHaveBeenCalledTimes(1);
    expect(pendingIntent()).toMatchObject({ action: 'accept', orderId: 'order-1' });
    if (switchToOverview) {
      fireEvent.click(screen.getByRole('link', { name: '門市概況' }));
      expect(screen.getByRole('link', { name: '門市概況' }).getAttribute('aria-current')).toBe('page');
      expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
    }
  }
  if (pollResource) {
    const originalRead = orderReads.getMockImplementation()!;
    orderReads.mockImplementation((resource) => resource === pollResource
      ? failedPoll.promise : originalRead(resource));
    const previousReads = orderReads.mock.calls.length;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(orderReads.mock.calls.slice(previousReads)).toContainEqual([pollResource]);
    orderReads.mockImplementation(originalRead);
  }
  await act(async () => {
    failedList.reject(unavailable);
    await failedList.promise.catch(() => undefined);
    await Promise.resolve();
    // Without an in-flight operation or poll, the list failure must block even
    // before React updates the previously enabled control.
    expect(submit.disabled).toBe(inFlight || !!pollResource);
    submit.click();
    expect(acceptOrder).toHaveBeenCalledTimes(retry || inFlight ? 1 : 0);
    expect(changeAvailability).toHaveBeenCalledTimes(1);
  });
  if (pollResource) {
    await act(async () => failedPoll.reject(unavailable));
    const previousReads = orderReads.mock.calls.length;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(orderReads).toHaveBeenCalledTimes(previousReads);
    expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '門市概況' }));
    const pause = screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' });
    expect(pause.disabled).toBe(true);
    fireEvent.click(pause);
    expect(changeAvailability).toHaveBeenCalledTimes(1);
    await act(async () => window.history.back());
  }
  if (orders) {
    expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
  } else {
    expect(submit.disabled).toBe(true);
  }
  expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
  expect(readDetail).toHaveBeenCalledTimes(4);

  if (inFlight) {
    await act(async () => pendingOrder.resolve(orderReceipt));
    expect(pendingIntent()).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  if (inFlight) {
    if (switchToOverview) fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
    await screen.findByRole('button', { name: '接單：A101' });
    expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
    expect(acceptOrder).toHaveBeenCalledTimes(1);
  } else if (retry) {
    const restored = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
    await waitFor(() => expect(restored.disabled).toBe(false));
    fireEvent.click(restored);
    expect(acceptOrder).toHaveBeenCalledTimes(2);
  } else if (orders) {
    fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
    fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
    fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
    expect(acceptOrder).toHaveBeenCalledTimes(1);
  } else {
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(screen.getByRole('link', { name: '處理訂單與收銀' })).toBeTruthy();
  }
});

it.each([403, 404])('revokes a background detail denial %s despite a newer same-version list', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = { ...detail('store-a', true), readinessVersion: 7 };
  const paused = { ...open, readinessVersion: 8, locationStatus: 'closed', publicAccess: false };
  const listed = { ...paused, merchantName: '清單更新的餐坊' };
  const deniedRefresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const newerRefresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readList = vi.fn()
    .mockResolvedValue({ workspaces: [listed, detail('store-b')] })
    .mockResolvedValueOnce({ workspaces: [open, detail('store-b')] })
    .mockResolvedValueOnce({ workspaces: [paused, detail('store-b')] });
  const readDetail = vi.fn()
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(paused)
    .mockResolvedValueOnce(paused)
    .mockReturnValueOnce(deniedRefresh.promise)
    .mockReturnValueOnce(newerRefresh.promise)
    .mockResolvedValue(open);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return Promise.resolve(paused);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const storeLink = await screen.findByRole<HTMLAnchorElement>('link', { name: '管理門市：一樓' });
  const storeHref = storeLink.href;
  fireEvent.click(storeLink);
  fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
  await screen.findByText('門市狀態已更新：暫停接單。');

  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole('link', { name: '管理門市：二樓' }));
  await screen.findByRole('heading', { name: '餐坊／二樓', level: 2 });
  await act(async () => window.history.back());
  await screen.findByRole('heading', { name: '清單更新的餐坊／一樓' });
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(5));

  await act(async () => deniedRefresh.reject(new NuniError(status, 'DENIED')));
  expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();

  await act(async () => {
    window.history.pushState(null, '', storeHref);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
  expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
  await act(async () => newerRefresh.resolve(paused));
});

it.each([
  { requirements: undefined, listedRequirements: undefined, showsForm: true },
  { requirements: undefined, listedRequirements: [], showsForm: true },
  { requirements: undefined, listedRequirements: ['settings'], showsForm: true },
  { requirements: undefined, listedRequirements: ['settings'], showsForm: false, stock: 1 },
  { requirements: [], listedRequirements: [], showsForm: true },
])('distinguishes legacy detail requirements $requirements from list requirements $listedRequirements', async ({
  requirements,
  listedRequirements,
  showsForm,
  stock = 0,
}) => {
  const legacy: NuniMerchantWorkspaceDetail = {
    ...detail(), readinessVersion: 8, managerConfirmed: stock > 0, publishedMenuItems: stock,
  };
  if (requirements === undefined) delete legacy.missingRequirements;
  else {
    legacy.missingRequirements = requirements;
    expect(parseMerchantWorkspaceDetail(legacy).missingRequirements).toEqual(requirements);
  }
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') {
      return Promise.resolve({ workspaces: [{ ...legacy, missingRequirements: listedRequirements }] });
    }
    if (resource === 'merchant-workspaces/campus-one/store-a') return Promise.resolve(legacy);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  if (showsForm) {
    expect(screen.getByLabelText('品項 1 名稱')).toBeTruthy();
  } else {
    expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
    expect(screen.getByText(`目前有 ${stock} 項有庫存的上架品項。首次菜單只能建立一次。`)).toBeTruthy();
  }
  expect(screen.getByLabelText<HTMLInputElement>(/我已確認門市、營運方式及菜單/).disabled).toBe(true);
});

it.each([
  { requirements: [] },
  { requirements: ['settings'] },
  { requirements: ['settings', 'menu'] },
])('keeps an omitted detail requirement through a same-version GET reporting $requirements',
  async ({ requirements }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const initial: NuniMerchantWorkspaceDetail = { ...detail(), readinessVersion: 8 };
    delete initial.missingRequirements;
    const readDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, missingRequirements: requirements });
    mocks.request.mockImplementation((resource) => {
      if (resource === path) return readDetail();
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [initial] });
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' })));
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('品項 1 名稱')).toBeTruthy();
  },
);

it('keeps both management entries closed for a store revealed by a retired list after a newer 503', async () => {
  const known = detail('store-a', true);
  const late = detail('store-b', true);
  const latePath = 'merchant-workspaces/campus-one/store-b';
  const pendingList = Promise.withResolvers<{ workspaces: NuniMerchantWorkspaceDetail[] }>();
  const recovery = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readLate = vi.fn(() => recovery.promise);
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [known] })
    .mockReturnValueOnce(pendingList.promise)
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'))
    .mockResolvedValue({ workspaces: [known, late] });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === latePath) return readLate();
    if (resource === 'merchant-applications') {
      return Promise.resolve({ applications: [{
        tenantId: late.tenantId,
        applicationId: late.applicationId,
        brandName: '核准申請',
        locationName: late.locationName,
        state: 'approved',
        reviewerNote: '',
        submittedAt: '2026-10-09T02:00:00.000Z',
      }] });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  await act(async () => window.history.forward());
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  await act(async () => window.history.back());
  await screen.findByText('目前無法確認店家資料，請重新載入。');

  await act(async () => pendingList.resolve({ workspaces: [known, late] }));
  await screen.findByRole('heading', { name: '餐坊／二樓' });
  const storeLink = () => screen.queryByRole('link', { name: '管理門市：二樓' });
  const applicationLink = () => screen.queryByRole('link', { name: '前往管理門市：二樓' });
  expect(storeLink()).toBeNull();
  expect(applicationLink()).toBeNull();
  expect(readLate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() => expect(readLate).toHaveBeenCalledOnce());
  expect(storeLink()).toBeNull();
  expect(applicationLink()).toBeNull();
  await act(async () => recovery.resolve(late));
  expect(storeLink()).toBeTruthy();
  expect(applicationLink()).toBeTruthy();
});

it.each([
  { status: 401, code: 'UNAUTHORIZED' },
  { status: 409, code: 'SESSION_CHANGED' },
])('allows both management entries after the list itself expires with $code', async ({ status, code }) => {
  const store = detail('store-b', true);
  const readList = vi.fn()
    .mockRejectedValueOnce(new NuniError(status, code))
    .mockResolvedValue({ workspaces: [store] });
  const storeRead = vi.fn().mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === 'merchant-workspaces/campus-one/store-b') return storeRead();
    if (resource === 'merchant-applications') {
      return Promise.resolve({ applications: [{
        tenantId: store.tenantId,
        applicationId: store.applicationId,
        brandName: '核准申請',
        locationName: store.locationName,
        state: 'approved',
        reviewerNote: '',
        submittedAt: '2026-10-09T02:00:00.000Z',
      }] });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  fireEvent.click(screen.getByRole('button', { name: '重新載入店家資料' }));
  expect(await screen.findByRole('link', { name: '管理門市：二樓' })).toBeTruthy();
  expect(await screen.findByRole('link', { name: '前往管理門市：二樓' })).toBeTruthy();
  expect(storeRead).not.toHaveBeenCalled();
});

it.each([
  { status: 401, code: 'UNAUTHORIZED' },
  { status: 409, code: 'SESSION_CHANGED' },
])('ignores an old list outage after reloading the workspace following $code', async ({ status, code }) => {
  const oldStore = detail('store-a', true);
  const newStore = detail('store-b', true);
  const oldList = Promise.withResolvers<never>();
  const newList = Promise.withResolvers<{ workspaces: NuniMerchantWorkspaceDetail[] }>();
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [oldStore] })
    .mockReturnValueOnce(oldList.promise)
    .mockReturnValue(newList.promise);
  const readOldStore = vi.fn()
    .mockResolvedValueOnce(oldStore)
    .mockRejectedValueOnce(new NuniError(status, code))
    .mockResolvedValue(oldStore);
  const readNewStore = vi.fn(() => Promise.resolve(newStore));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === 'merchant-workspaces/campus-one/store-a') return readOldStore();
    if (resource === 'merchant-workspaces/campus-one/store-b') return readNewStore();
    if (resource === 'merchant-applications') {
      return Promise.resolve({ applications: [{
        tenantId: newStore.tenantId,
        applicationId: newStore.applicationId,
        brandName: '核准申請',
        locationName: newStore.locationName,
        state: 'approved',
        reviewerNote: '',
        submittedAt: '2026-10-09T02:00:00.000Z',
      }] });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  await act(async () => window.history.back());
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  await act(async () => window.history.forward());
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  expect(mocks.auth.refresh).toHaveBeenCalledOnce();
  await act(async () => window.history.back());
  await waitFor(() => expect(window.location.search).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '重新載入店家資料' }));
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(3));

  await act(async () => oldList.reject(new NuniError(503, 'UNAVAILABLE')));
  await act(async () => newList.resolve({ workspaces: [newStore] }));
  expect(screen.getByRole('link', { name: '管理門市：二樓' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往管理門市：二樓' })).toBeTruthy();
  expect(readNewStore).not.toHaveBeenCalled();
});

it.each([
  { source: 'detail', status: 401, code: 'UNAUTHORIZED' },
  { source: 'detail', status: 409, code: 'SESSION_CHANGED' },
  { source: 'orders', status: 401, code: 'UNAUTHORIZED' },
  { source: 'shift', status: 409, code: 'SESSION_CHANGED' },
])('ignores a stale $source outage in the same batch as a background $code', async ({
  source, status, code,
}) => {
  const store = detail('store-a', true);
  const path = 'merchant-workspaces/campus-one/store-a';
  const background = Promise.withResolvers<never>();
  const outage = Promise.withResolvers<never>();
  const recovery = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readBackground = vi.fn(() => recovery.promise).mockReturnValueOnce(background.promise);
  const readForeground = vi.fn()
    .mockResolvedValueOnce(store)
    .mockReturnValue(source === 'detail' ? outage.promise : Promise.resolve(store));
  const readOrders = vi.fn(() => source === 'orders' ? outage.promise : respond(`${path}/orders`));
  const readShift = vi.fn(() => source === 'shift' ? outage.promise : respond(`${path}/shift`));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [store] });
    if (resource === path) return window.location.search ? readForeground() : readBackground();
    if (resource === `${path}/orders`) return readOrders();
    if (resource === `${path}/shift`) return readShift();
    if (resource === 'merchant-applications') {
      return Promise.resolve({ applications: [{
        tenantId: store.tenantId,
        applicationId: store.applicationId,
        brandName: '核准申請',
        locationName: store.locationName,
        state: 'approved',
        reviewerNote: '',
        submittedAt: '2026-10-09T02:00:00.000Z',
      }] });
    }
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('link', { name: '處理訂單與收銀' });
  await act(async () => window.history.back());
  await waitFor(() => expect(readBackground).toHaveBeenCalledOnce());
  await act(async () => window.history.forward());
  await waitFor(() => expect(readForeground).toHaveBeenCalledTimes(2));
  if (source !== 'detail') {
    fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
    await waitFor(() => expect(readOrders).toHaveBeenCalledOnce());
    expect(readShift).toHaveBeenCalledOnce();
  }

  // Keep both rejection handlers in the act batch before React commits
  // the invalid-session screen.
  await act(async () => {
    background.reject(new NuniError(status, code));
    outage.reject(new NuniError(503, 'UNAVAILABLE'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  expect(mocks.auth.refresh).toHaveBeenCalledOnce();

  await act(async () => window.history.go(source === 'detail' ? -1 : -2));
  await waitFor(() => expect(window.location.search).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '重新載入店家資料' }));
  expect(await screen.findByRole('link', { name: '管理門市：一樓' })).toBeTruthy();
  expect(await screen.findByRole('link', { name: '前往管理門市：一樓' })).toBeTruthy();
  expect(readBackground).toHaveBeenCalledOnce();
});

it.each(['list', 'background detail'] as const)(
  'keeps a first-menu receipt arriving after a same-version %s observed the pre-write state',
  async (source) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const before = { ...detail(), readinessVersion: 7 };
    const published = { ...before, readinessVersion: 8, missingRequirements: ['settings'], publishedMenuItems: 1 };
    const write = Promise.withResolvers<typeof firstMenuReceipt>();
    const background = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const refresh = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
    const readDetail = vi.fn()
      .mockResolvedValueOnce(before)
      .mockReturnValueOnce(background.promise)
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValue(before);
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [before] });
      if (resource === path) return readDetail();
      if (resource === `${path}/initial-menu`) return write.promise;
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    await screen.findByLabelText('品項 1 名稱');
    submitFirstMenu();
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    if (source === 'background detail') await act(async () => background.resolve(before));

    await act(async () => write.resolve(firstMenuReceipt));
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
    await act(async () => refresh.resolve(published));
    if (source === 'list') await act(async () => background.resolve(before));
    await act(async () => window.history.forward());
    await screen.findByText(/已建立 1 項首次菜單/);
    expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
  },
);

it('reuses a current detail without a write through two stale re-entries and rejects it after a newer list version', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const current = { ...detail('store-a', true), readinessVersion: 8 };
  const stale = { ...current, readinessVersion: 7 };
  const readDetail = vi.fn().mockResolvedValueOnce(current).mockResolvedValue(stale);
  const readList = vi.fn()
    .mockResolvedValueOnce({ workspaces: [current] })
    .mockResolvedValueOnce({ workspaces: [current] })
    .mockResolvedValueOnce({ workspaces: [current] })
    .mockResolvedValueOnce({ workspaces: [{ ...current, readinessVersion: 9 }] });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  const pause = () => screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' });
  expect((await pause()).disabled).toBe(false);

  for (const expectedReads of [3, 5]) {
    await act(async () => window.history.back());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(expectedReads - 1));
    await act(async () => window.history.forward());
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(expectedReads));
    expect((await pause()).disabled).toBe(false);
  }

  await act(async () => window.history.back());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(6));
  await act(async () => window.history.forward());
  await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
  expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
});

it('keeps settings locked when a v9 list invalidates the v8 GET before a v9 write receipt', async () => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const v8 = { ...detail(), readinessVersion: 8 };
  const v9: NuniMerchantWorkspaceDetail = {
    ...v8, readinessVersion: 9, managerConfirmed: true,
    termsVersion: 'merchant-terms-v1', missingRequirements: ['menu'],
  };
  const list = Promise.withResolvers<{ workspaces: NuniMerchantWorkspaceDetail[] }>();
  const receipt = Promise.withResolvers<NuniMerchantWorkspaceDetail>();
  const readList = vi.fn().mockResolvedValueOnce({ workspaces: [v8] }).mockReturnValue(list.promise);
  const readDetail = vi.fn().mockResolvedValue(v8);
  const write = vi.fn(() => receipt.promise);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return readList();
    if (resource === path) return readDetail();
    if (resource === `${path}/settings`) return write();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  await screen.findByRole('link', { name: '管理門市：一樓' });
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByLabelText(/我確認營運資訊正確/));
  fireEvent.click(screen.getByRole('button', { name: '儲存營運設定' }));
  expect(write).toHaveBeenCalledOnce();

  await act(async () => list.resolve({ workspaces: [v9] }));
  await act(async () => receipt.resolve(v9));
  await screen.findByText('營運設定已儲存。');
  expect(screen.getByRole('alert').textContent).toContain('請重新讀取');
  expect(screen.getByRole('checkbox', { name: /我確認營運資訊正確/ }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('textbox', { name: '品項 1 名稱' }).matches(':disabled')).toBe(true);

  readDetail.mockResolvedValue(v9);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '品項 1 名稱' }).matches(':disabled'))
    .toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([
  { resourceName: 'orders', recovery: 'order poll' },
  { resourceName: 'shift', recovery: 'order poll' },
  { resourceName: 'orders', recovery: 'overview reload' },
  { resourceName: 'shift', recovery: 'overview reload' },
])('locks both workspaces on a $resourceName GET failure until $recovery obtains both reads', async ({
  resourceName, recovery,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const store = detail('store-a', true);
  const queue = {
    orders: [{ ...queueFixture(), locationId: 'store-a', state: 'paid', allowedActions: ['accept'] }],
  };
  const shift = { ...shiftFixture(), locationId: 'store-a' };
  const outage = Promise.withResolvers<never>();
  const pendingRecovery = Promise.withResolvers<unknown>();
  const reads = vi.fn()
    .mockResolvedValueOnce(resourceName === 'orders' ? queue : shift)
    .mockReturnValueOnce(outage.promise)
    .mockReturnValueOnce(pendingRecovery.promise)
    .mockResolvedValue(resourceName === 'orders' ? queue : shift);
  const accept = vi.fn()
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'))
    .mockResolvedValue({ orderId: 'order-1', state: 'accepted', updatedAt: future, replayed: true, kitchenTicketId: 'ticket-1' });
  const availability = vi.fn().mockResolvedValue({ ...store, locationStatus: 'closed' });
  const readDetail = vi.fn().mockResolvedValue(store);
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [store] });
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return availability();
    if (resource.endsWith('/accept')) return accept();
    if (resource.endsWith(`/${resourceName}`)) return reads();
    if (resource.endsWith('/orders')) return Promise.resolve(queue);
    if (resource.endsWith('/shift')) return Promise.resolve(shift);
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
  fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
  const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
  expect(retry.disabled).toBe(false);
  expect(accept).toHaveBeenCalledOnce();

  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(reads).toHaveBeenCalledTimes(2);
  await act(async () => outage.reject(new NuniError(503, 'UNAVAILABLE')));
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(accept).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('link', { name: '門市概況' }));
  const pause = screen.getByRole<HTMLButtonElement>('button', { name: '暫停接單' });
  expect(pause.disabled).toBe(true);
  fireEvent.click(pause);
  expect(availability).not.toHaveBeenCalled();

  if (recovery === 'overview reload') {
    fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(3));
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(pause.disabled).toBe(true);
    fireEvent.click(pause);
    expect(availability).not.toHaveBeenCalled();
    await act(async () => pendingRecovery.resolve(resourceName === 'orders' ? queue : shift));
    await waitFor(() => expect(pause.disabled).toBe(false));
    fireEvent.click(pause);
    expect(availability).toHaveBeenCalledOnce();
    return;
  }

  await act(async () => window.history.back());
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(3));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '重試同一份操作' }).disabled).toBe(true);
  await act(async () => pendingRecovery.reject(new NuniError(503, 'UNAVAILABLE')));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(reads).toHaveBeenCalledTimes(4);
  expect(readDetail).toHaveBeenCalledOnce();
  expect(screen.queryByText('無法確認門市目前的資料。草稿已保留，請重新讀取。')).toBeNull();
  const restored = screen.getByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
  expect(restored.disabled).toBe(false);
  fireEvent.click(restored);
  expect(accept).toHaveBeenCalledTimes(2);
});

it.each([
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'poll' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'poll' },
  { firstResult: 'failure', first: 'shift', second: 'orders', status: 401, code: 'UNAUTHORIZED', navigation: 'poll' },
  { firstResult: 'failure', first: 'shift', second: 'orders', status: 409, code: 'SESSION_CHANGED', navigation: 'poll' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'next page' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'next page' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'remount' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'remount' },
  { firstResult: 'failure', first: 'orders', second: 'shift', status: 200, code: 'OK', navigation: 'remount' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'remount' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'remount' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 200, code: 'OK', navigation: 'remount' },
  { firstResult: 'success', first: 'shift', second: 'orders', status: 200, code: 'OK', navigation: 'remount' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 200, code: 'OK', navigation: 'overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 401, code: 'UNAUTHORIZED', navigation: 'direct overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 409, code: 'SESSION_CHANGED', navigation: 'direct overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 200, code: 'OK', navigation: 'direct overview' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 403, code: 'FORBIDDEN', navigation: 'overview reload' },
  { firstResult: 'success', first: 'orders', second: 'shift', status: 404, code: 'NOT_FOUND', navigation: 'overview reload' },
  { firstResult: 'success', first: 'shift', second: 'orders', status: 403, code: 'FORBIDDEN', navigation: 'overview reload' },
  { firstResult: 'success', first: 'shift', second: 'orders', status: 404, code: 'NOT_FOUND', navigation: 'overview reload' },
] as const)('settles the order round when $second reports $code after $first returns $firstResult ($navigation)', async ({
  firstResult, first, second, status, code, navigation,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const store = { ...detail('store-a', true), readinessVersion: 8 };
  const queue = {
    orders: [{ ...queueFixture(), locationId: 'store-a', state: 'paid', allowedActions: ['accept'] }],
    nextCursor: 'page-2',
  };
  const firstRead = Promise.withResolvers<unknown>();
  const sibling = Promise.withResolvers<unknown>();
  const readDetail = vi.fn().mockResolvedValue(store);
  const recovery = Promise.withResolvers<void>();
  const shift = { ...shiftFixture(), locationId: 'store-a' };
  const reads = {
    orders: vi.fn().mockResolvedValue(queue),
    shift: vi.fn().mockResolvedValue(shift),
  };
  const responses = { orders: queue, shift };
  const accept = vi.fn().mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  const availability = vi.fn().mockResolvedValue({ ...store, locationStatus: 'closed' });
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [store] });
    if (resource === path) return readDetail();
    if (resource === `${path}/availability`) return availability();
    if (resource === `${path}/orders`) return reads.orders();
    if (resource === `${path}/shift`) return reads.shift();
    if (resource.endsWith('/accept')) return accept();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
  fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
  let retry = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
  expect(retry.disabled).toBe(false);

  reads[first].mockReturnValueOnce(firstRead.promise);
  reads[second].mockReturnValueOnce(sibling.promise);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(reads.orders).toHaveBeenCalledTimes(2);
  expect(reads.shift).toHaveBeenCalledTimes(2);
  if (firstResult === 'failure') {
    await act(async () => firstRead.reject(new NuniError(503, 'UNAVAILABLE')));
  } else {
    await act(async () => firstRead.resolve(responses[first]));
  }
  expect(retry.disabled).toBe(true);
  expect(mocks.auth.refresh).not.toHaveBeenCalled();

  reads.orders.mockResolvedValueOnce(queue);
  reads.shift.mockReturnValueOnce(recovery.promise.then(() => shift));
  if (navigation === 'remount' || navigation === 'overview') {
    await act(async () => window.history.go(-2));
    await screen.findByRole('heading', { name: '已授權門市' });
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
    if (navigation === 'overview') {
      fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
    } else {
      await act(async () => window.history.go(2));
      retry = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
    }
    await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('button', { name: '接單：A101' })).toBeNull();
  } else if (navigation === 'direct overview' || navigation === 'overview reload') {
    fireEvent.click(screen.getByRole('link', { name: '門市概況' }));
    if (navigation === 'overview reload') {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' })));
      expect(readDetail).toHaveBeenCalledTimes(2);
    }
  } else if (navigation === 'next page') {
    fireEvent.click(screen.getByRole('button', { name: '下一頁待處理訂單' }));
  } else {
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  }
  const overview = navigation === 'overview' || navigation === 'direct overview' || navigation === 'overview reload';
  const writeButton = overview
    ? await screen.findByRole<HTMLButtonElement>('button', { name: '暫停接單' })
    : retry;
  const write = overview ? availability : accept;
  const initialWrites = overview ? 0 : 1;
  const expectWriteBlocked = () => {
    expect(writeButton.disabled).toBe(true);
    fireEvent.click(writeButton);
    expect(write).toHaveBeenCalledTimes(initialWrites);
  };
  if (status !== 200) await act(async () => recovery.resolve());
  expectWriteBlocked();
  expect(reads.orders).toHaveBeenCalledTimes(2);
  expect(reads.shift).toHaveBeenCalledTimes(2);

  if (status === 200) {
    await act(async () => sibling.resolve(responses[second]));
    if (navigation !== 'direct overview') {
      // The new queue has resolved, but its shift is still pending.
      expectWriteBlocked();
      expect(reads.orders).toHaveBeenCalledTimes(3);
      expect(reads.shift).toHaveBeenCalledTimes(3);
      await act(async () => recovery.resolve());
    }
    await waitFor(() => expect(writeButton.disabled).toBe(false));
    fireEvent.click(writeButton);
    expect(write).toHaveBeenCalledTimes(initialWrites + 1);
    if (!overview) {
      const writes = mocks.request.mock.calls.filter(([resource]) => resource.endsWith('/accept'));
      expect(writes[1]?.[2]).toEqual(writes[0]?.[2]);
    }
    expect(mocks.auth.refresh).not.toHaveBeenCalled();
    return;
  }

  await act(async () => sibling.reject(new NuniError(status, code)));
  if (status === 403 || status === 404) {
    await screen.findByText(/目前無法取得這間門市的管理權限/);
    expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
    expect(screen.queryByRole('link', { name: '處理訂單與收銀' })).toBeNull();
    expect(availability).not.toHaveBeenCalled();
    expect(mocks.auth.refresh).not.toHaveBeenCalled();
    return;
  }
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  expect(mocks.auth.refresh).toHaveBeenCalledOnce();
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(reads.orders).toHaveBeenCalledTimes(2);
  expect(reads.shift).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
  expect(accept).toHaveBeenCalledOnce();
  expect(availability).not.toHaveBeenCalled();
});

it.each([false, true])('settles an order receipt after browser Back to the list (remount first: %s)', async (reenterFirst) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const store = detail('store-a', true);
  const receipt = Promise.withResolvers<unknown>();
  const accept = vi.fn(() => receipt.promise);
  const pendingIntent = () => loadFoodPending('account-a', 'merchant-food:campus-one:store-a');
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [store] });
    if (resource === path) return Promise.resolve(store);
    if (resource.endsWith('/orders')) return Promise.resolve({
      orders: [{ ...queueFixture(), locationId: 'store-a', state: 'paid', allowedActions: ['accept'] }],
    });
    if (resource.endsWith('/accept')) return accept();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const enter = async () => {
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
  };
  await enter();
  fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
  expect(accept).toHaveBeenCalledOnce();
  expect(pendingIntent()).toMatchObject({ action: 'accept', orderId: 'order-1' });

  await act(async () => window.history.go(-2));
  await screen.findByRole('link', { name: '管理門市：一樓' });
  expect(screen.queryByRole('region', { name: '門市訂單工作台' })).toBeNull();
  if (reenterFirst) {
    await enter();
    const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(accept).toHaveBeenCalledOnce();
  }
  await act(async () => receipt.resolve({
    orderId: 'order-1', state: 'accepted', updatedAt: future, replayed: false, kitchenTicketId: 'ticket-1',
  }));
  expect(pendingIntent()).toBeNull();
  if (!reenterFirst) await enter();
  await screen.findByRole('button', { name: '接單：A101' });
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(accept).toHaveBeenCalledOnce();
});

it.each([
  { status: 401, code: 'UNAUTHORIZED' },
  { status: 409, code: 'SESSION_CHANGED' },
])('ignores an order receipt after the same account reloads following $code', async ({ status, code }) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const store = detail('store-a', true);
  const queue = {
    orders: [{ ...queueFixture(), locationId: 'store-a', state: 'paid', allowedActions: ['accept'] }],
  };
  const readOrders = vi.fn().mockResolvedValue(queue);
  const receipt = Promise.withResolvers<unknown>();
  const accept = vi.fn(() => receipt.promise);
  const pendingIntent = () => loadFoodPending('account-a', 'merchant-food:campus-one:store-a');
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [store] });
    if (resource === path) return Promise.resolve(store);
    if (resource === `${path}/orders`) return readOrders();
    if (resource.endsWith('/accept')) return accept();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  const enter = async () => {
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('link', { name: '處理訂單與收銀' }));
  };
  await enter();
  fireEvent.click(await screen.findByRole('button', { name: '接單：A101' }));
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  fireEvent.click(screen.getByRole('button', { name: '確認：接單' }));
  expect(accept).toHaveBeenCalledOnce();
  const intent = pendingIntent();
  expect(intent).toMatchObject({ action: 'accept', orderId: 'order-1' });

  readOrders.mockRejectedValueOnce(new NuniError(status, code));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  await act(async () => window.history.go(-2));
  await waitFor(() => expect(window.location.search).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '重新載入店家資料' }));
  await enter();
  const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '重試同一份操作' });
  await waitFor(() => expect(retry.disabled).toBe(false));
  const readsBeforeReceipt = readOrders.mock.calls.length;

  await act(async () => receipt.resolve({
    orderId: 'order-1', state: 'accepted', updatedAt: future, replayed: false, kitchenTicketId: 'ticket-1',
  }));
  expect(readOrders).toHaveBeenCalledTimes(readsBeforeReceipt);
  expect(pendingIntent()).toEqual(intent);
  expect(retry.disabled).toBe(false);
  expect(accept).toHaveBeenCalledOnce();
});
