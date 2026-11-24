import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
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
      return respond(requestPath);
    });
    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
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
      fireEvent.click(await within(locations).findByRole('link', { name: '管理門市：一樓' }));
      await screen.findByText('無法確認門市目前的資料。草稿已保留，請重新讀取。');
      expect(screen.queryByRole('heading', { name: '餐坊／一樓' })).toBeNull();
      expect(screen.queryByRole('button', { name: '儲存營運設定' })).toBeNull();

      detailStatus = null;
      fireEvent.click(screen.getByRole('button', { name: '重新讀取門市狀態' }));
      await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
      fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
    }

    const link = await screen.findByRole('link', { name: '管理門市：一樓' });
    const store = link.closest('li')!;
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

it.each([1, undefined])('uses the later list (version %s) when the detail refresh fails', async (readinessVersion) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const open = detail('store-a', true);
  const paused = { ...open, readinessVersion, locationStatus: 'closed', publicAccess: false };
  let listed: NuniMerchantWorkspace = open;
  const readDetail = vi.fn(() => Promise.resolve(open));
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [listed] });
    if (resource === path) return readDetail();
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByText('營業中');

  listed = paused;
  readDetail.mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
  await act(async () => window.history.back());
  await screen.findByText('暫停接單');
  await screen.findByText('目前無法更新部分門市資料，請重新載入。');
  expect(readDetail).toHaveBeenCalledTimes(2);
  expect(screen.getByText('尚未公開')).toBeTruthy();
  expect(screen.queryByText('允許公開瀏覽')).toBeNull();
  expect(screen.queryByText('營業中')).toBeNull();
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

it('keeps a newer paused list row when a successful detail returns an older open version', async () => {
  const open = { ...detail('store-a', true), paymentMode: 'online-and-counter' };
  const paused = { ...open, readinessVersion: 2, locationStatus: 'closed', publicAccess: false };
  let row = open;
  const path = 'merchant-workspaces/campus-one/store-a';
  mocks.request.mockImplementation((resource) => {
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [row] });
    if (resource === path) return Promise.resolve(open);
    if (resource === `${path}/settings`)
      return Promise.reject(new NuniError(409, 'CONFLICT'));
    return respond(resource);
  });
  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('button', { name: '暫停接單' });
  row = paused;
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await screen.findByText('暫停接單');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
  expect(screen.getByText('暫停接單')).toBeTruthy();
  expect(screen.queryByText('營業中')).toBeNull();
  expect(mocks.request.mock.calls.filter(([resource]) => resource === path)).toHaveLength(3);
  fireEvent.click(screen.getByRole('link', { name: '管理門市：一樓' }));
  await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
  const resume = await screen.findByRole<HTMLButtonElement>('button', { name: '恢復接單' });
  expect(resume.disabled).toBe(false);
  expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
  expect(screen.queryByText(/目前無法取得這間門市的管理權限/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認改為櫃檯付款' }));
  await screen.findByText(/門市資料已變更/);
  expect(mocks.request).toHaveBeenCalledWith(
    `${path}/settings`,
    'context-a',
    expect.objectContaining({ serviceModes: ['pickup'], expectedVersion: 1 }),
    'PUT',
  );
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
  'reopens with only the newly verified lower-version detail after list denial %s',
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
      readinessVersion: 6,
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

    readDetail.mockImplementation(() => Promise.resolve(current));
    await act(async () => window.history.forward());
    await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
    expect(readDetail).toHaveBeenCalledTimes(3);
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();
    expect(screen.queryByText('先前的餐坊／一樓')).toBeNull();
    const operations = screen.getByRole('region', { name: '接單狀態' });
    expect(within(operations).getByText('自取、內用')).toBeTruthy();
    expect(within(operations).getByText('現場櫃檯付款')).toBeTruthy();
    expect(within(operations).queryByText('線上及櫃檯付款')).toBeNull();
  },
);

it.each([
  { status: 403, forwardFirst: false },
  { status: 404, forwardFirst: false },
  { status: 403, forwardFirst: true },
  { status: 404, forwardFirst: true },
])(
  'discards a newer background detail when the earlier list request returns $status (Forward first: $forwardFirst)',
  async ({ status, forwardFirst }) => {
    const path = 'merchant-workspaces/campus-one/store-a';
    const open = detail('store-a', true);
    const background = {
      ...open,
      readinessVersion: 7,
      merchantName: '撤銷前的餐坊',
      paymentMode: 'online-and-counter',
    };
    const recovered = {
      ...open,
      readinessVersion: 6,
      merchantName: '重新授權的餐坊',
      locationStatus: 'closed',
      publicAccess: false,
      serviceModes: ['pickup', 'dine-in'],
    };
    let finishWrite!: (receipt: NuniMerchantWorkspaceDetail) => void;
    const write = new Promise<NuniMerchantWorkspaceDetail>((resolve) => {
      finishWrite = resolve;
    });
    let denyList!: (error: NuniError) => void;
    const list = new Promise<never>((_, reject) => {
      denyList = reject;
    });
    const readList = vi.fn()
      .mockResolvedValueOnce({ workspaces: [open] })
      .mockReturnValueOnce(list);
    let finishForwardRead!: (value: typeof recovered) => void;
    const forwardRead = new Promise<typeof recovered>((resolve) => {
      finishForwardRead = resolve;
    });
    let finishRecovery!: (value: typeof recovered) => void;
    const recovery = new Promise<typeof recovered>((resolve) => {
      finishRecovery = resolve;
    });
    const readDetail = vi.fn()
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(background)
      .mockImplementationOnce(() =>
        forwardFirst ? forwardRead : Promise.reject(new NuniError(503, 'UNAVAILABLE')),
      )
      .mockImplementationOnce(() => forwardFirst ? recovery : Promise.resolve(recovered));
    mocks.request.mockImplementation((resource) => {
      if (resource === 'merchant-workspaces') return readList();
      if (resource === path) return readDetail();
      if (resource === `${path}/availability`) return write;
      return respond(resource);
    });

    render(<MerchantWorkspace view="workspace" />);
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
    fireEvent.click(await screen.findByRole('button', { name: '暫停接單' }));
    await act(async () => window.history.back());
    await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
    expect(readDetail).toHaveBeenCalledTimes(1);

    await act(async () => finishWrite({ ...open, locationStatus: 'closed', publicAccess: false }));
    await screen.findByRole('heading', { name: '撤銷前的餐坊／一樓' });
    expect(readDetail).toHaveBeenCalledTimes(2);

    if (forwardFirst) {
      await act(async () => window.history.forward());
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
      await act(async () => denyList(new NuniError(status, 'DENIED')));
      await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(4));
      await act(async () => finishForwardRead(recovered));
      expect(screen.queryByText('撤銷前的餐坊／一樓')).toBeNull();
      expect(screen.queryByText('營業中')).toBeNull();
      expect(screen.queryByText('服務方式')).toBeNull();
      await act(async () => finishRecovery(recovered));
    } else {
      await act(async () => denyList(new NuniError(status, 'DENIED')));
      await screen.findByText('目前無法確認店家資料，請重新載入。');
      expect(readDetail).toHaveBeenCalledTimes(3);
      expect(screen.queryByRole('link', { name: '管理門市：一樓' })).toBeNull();
      await act(async () => window.history.forward());
    }
    await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
    expect(readDetail).toHaveBeenCalledTimes(4);
    expect(screen.getByText('暫停接單')).toBeTruthy();
    expect(screen.queryByText('營業中')).toBeNull();
    expect(screen.queryByText('撤銷前的餐坊／一樓')).toBeNull();
    expect(screen.getByText('自取、內用')).toBeTruthy();
    expect(screen.getByText('現場櫃檯付款')).toBeTruthy();
  },
);

it.each([
  { status: 403, forwardFirst: true },
  { status: 404, forwardFirst: true },
  { status: 403, forwardFirst: false },
  { status: 404, forwardFirst: false },
])('rechecks the visible entry after a retired detail returns $status (Forward success first: $forwardFirst)', async ({
  status,
  forwardFirst,
}) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = { ...detail('store-a', true), readinessVersion: 7 };
  const recovered = {
    ...detail(),
    readinessVersion: 6,
    merchantName: '重新確認的餐坊',
    missingRequirements: ['menu'],
  };
  let denyOld!: (error: NuniError) => void;
  let finishForward!: (value: typeof previous) => void;
  let finishRecovery!: (value: typeof recovered) => void;
  const oldRead = new Promise<never>((_, reject) => { denyOld = reject; });
  const forwardRead = new Promise<typeof previous>((resolve) => { finishForward = resolve; });
  const recovery = new Promise<typeof recovered>((resolve) => { finishRecovery = resolve; });
  const readDetail = vi.fn()
    .mockReturnValueOnce(oldRead)
    .mockReturnValueOnce(forwardRead)
    .mockReturnValueOnce(recovery);
  mocks.request.mockImplementation((resource) => {
    if (resource === path) return readDetail();
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [previous] });
    return respond(resource);
  });

  render(<MerchantWorkspace view="workspace" />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(1));
  await act(async () => window.history.back());
  await screen.findByRole('link', { name: '管理門市：一樓' });
  await act(async () => window.history.forward());
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));

  if (forwardFirst) {
    await act(async () => finishForward(previous));
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    expect(screen.getByRole('button', { name: '暫停接單' })).toBeTruthy();
  }
  await act(async () => denyOld(new NuniError(status, 'DENIED')));
  await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(3));
  if (!forwardFirst) await act(async () => finishForward(previous));
  expect(screen.getByRole('status').textContent).toContain('正在確認門市資料');
  expect(screen.queryByRole('heading', { name: '餐坊／一樓', level: 2 })).toBeNull();
  expect(screen.queryByRole('button', { name: '暫停接單' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => finishRecovery(recovered));
  await screen.findByRole('heading', { name: '重新確認的餐坊／一樓', level: 2 });
  expect(screen.getByText('待完成：建立有庫存的首次菜單')).toBeTruthy();
  expect(readDetail).toHaveBeenCalledTimes(3);
});

it.each([403, 404])('recovers with a lower-version detail after a manual read returns %s', async (status) => {
  const path = 'merchant-workspaces/campus-one/store-a';
  const previous = {
    ...detail('store-a', true),
    readinessVersion: 7,
    merchantName: '撤銷前的餐坊',
    paymentMode: 'online-and-counter',
  };
  const recovered = {
    ...detail('store-a', true),
    readinessVersion: 6,
    merchantName: '重新授權的餐坊',
    locationStatus: 'closed',
    publicAccess: false,
    serviceModes: ['pickup', 'dine-in'],
  };
  const readDetail = vi.fn()
    .mockResolvedValueOnce(previous)
    .mockRejectedValueOnce(new NuniError(status, 'DENIED'))
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
  await screen.findByRole('heading', { name: '重新授權的餐坊／一樓' });
  expect(readDetail).toHaveBeenCalledTimes(3);
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
    readinessVersion: 6,
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
    if (resource === 'merchant-workspaces') return Promise.resolve({ workspaces: [previous] });
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
  const recovered = { ...detail(), readinessVersion: 6, missingRequirements: ['menu'] };
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
    readDetail.mockResolvedValue(recovered);
    await act(async () => window.history.forward());
  } else {
    readDetail.mockRejectedValueOnce(new NuniError(status, 'DENIED'));
    reload();
    await screen.findByText(/目前無法取得這間門市的管理權限/);
    readDetail.mockResolvedValue(recovered);
    reload();
  }

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
    const link = await screen.findByRole('link', { name: '管理門市：一樓' });
    const row = within(link.closest('li')!);
    expect(row.queryByText(/確認營運設定與條款/)).toBeNull();
    expect(row.getByText('待完成：建立菜單')).toBeTruthy();
    if (!receiptFirst) {
      await resolveReceipt();
      expect(row.getByText('待完成：建立菜單')).toBeTruthy();
    }

    const detailReadsBeforeForward = readDetail.mock.calls.length;
    await act(async () => window.history.forward());
    await screen.findByRole('heading', { name: '餐坊／一樓', level: 2 });
    await waitFor(() => expect(readDetail.mock.calls.length).toBeGreaterThan(detailReadsBeforeForward));
    expect(screen.getByText('待完成：建立有庫存的首次菜單')).toBeTruthy();
    expect(screen.queryByText(/已建立 1 項首次菜單/)).toBeNull();
    await act(async () => finishApplications({ applications: [] }));
    expect(screen.queryByText(/目前有 \d+ 項有庫存的上架品項/)).toBeNull();
    expect(screen.getByLabelText('品項 1 名稱')).toBeTruthy();
  },
);
