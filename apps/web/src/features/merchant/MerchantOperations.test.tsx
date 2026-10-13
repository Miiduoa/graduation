import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';
import { MerchantOperations, type MerchantOperationDrafts } from './MerchantOperations';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/nuni/Session', () => ({ browserRequest: request }));
const onChanged = vi.fn();
const onExpired = vi.fn();
const base = 'merchant-workspaces/campus-one/location-1';
let current: NuniMerchantWorkspaceDetail;
let drafts: MerchantOperationDrafts;
const initial = (): NuniMerchantWorkspaceDetail => ({
  tenantId: 'campus-one',
  tenantName: '第一校園',
  applicationId: 'application-1',
  merchantId: 'merchant-1',
  merchantName: '米飯店',
  locationId: 'location-1',
  locationName: '一樓門市',
  merchantStatus: 'suspended',
  locationStatus: 'suspended',
  publicAccess: false,
  campusId: 'main',
  campusName: '主校区',
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: false,
  termsVersion: null,
  activated: false,
  readinessVersion: 1,
  publishedMenuItems: 0,
  merchantMode: 'info_only',
  merchantModeLabel: '資訊展示',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: null,
  missingRequirements: ['settings', 'menu'],
});
function ready() {
  current = {
    ...current,
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    publishedMenuItems: 1,
    missingRequirements: [],
  };
}
async function response(path: string, _context: string, input?: Record<string, unknown>) {
  if (path.endsWith('/settings')) {
    current = {
      ...current,
      serviceModes: input!.serviceModes as typeof current.serviceModes,
      paymentMode: input!.paymentMode as typeof current.paymentMode,
      managerConfirmed: true,
      termsVersion: 'merchant-terms-v1',
      readinessVersion: Number(input!.expectedVersion) + 1,
      missingRequirements: current.publishedMenuItems ? [] : ['menu'],
    };
  } else if (path.endsWith('/initial-menu')) {
    current = {
      ...current,
      publishedMenuItems: (input!.items as unknown[]).length,
      missingRequirements: current.managerConfirmed ? [] : ['settings'],
    };
    return {
      menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc',
      createdItems: current.publishedMenuItems,
    };
  } else if (path.endsWith('/activate')) {
    current = {
      ...current,
      activated: true,
      merchantStatus: 'active',
      locationStatus: 'open',
      publicAccess: true,
      readinessVersion: current.readinessVersion + 1,
      merchantMode: 'full',
    };
  } else if (path.endsWith('/availability')) {
    current = {
      ...current,
      locationStatus: input!.acceptingOrders ? 'open' : 'closed',
      publicAccess: Boolean(input!.acceptingOrders),
    };
  }
  return current;
}
const view = (context = 'account-a', locationId = 'location-1', suspended = false) => (
  <MerchantOperations
    key={`${context}:${locationId}`}
    context={context}
    drafts={drafts}
    tenantId="campus-one"
    locationId={locationId}
    suspended={suspended}
    onBack={vi.fn()}
    onChanged={onChanged}
    onExpired={onExpired}
  />
);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  vi.clearAllMocks();
  current = initial();
  drafts = new Map();
  request.mockReset().mockImplementation(response);
});
async function open() {
  const mounted = render(view());
  await screen.findByText('米飯店／一樓門市');
  return mounted;
}
function fillMenu() {
  fireEvent.change(screen.getByLabelText('品項 1 名稱'), { target: { value: '蔬菜便當' } });
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85' } });
  fireEvent.change(screen.getByLabelText('品項 1 初始庫存'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('品項 1 過敏原'), { target: { value: '大豆，芝麻' } });
}
function confirmMenu() {
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
}

it('completes settings, one-time menu, confirmed activation and pause/resume with server receipts', async () => {
  await open();
  expect(button('儲存營運設定').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
  fireEvent.click(button('儲存營運設定'));
  await screen.findByText('營運設定已儲存。');
  expect(request).toHaveBeenCalledWith(
    `${base}/settings`,
    'account-a',
    {
      serviceModes: ['pickup'],
      paymentMode: 'counter-only',
      termsVersion: 'merchant-terms-v1',
      expectedVersion: 1,
    },
    'PUT',
  );
  fillMenu();
  expect(button('確認建立並上架菜單').disabled).toBe(true);
  confirmMenu();
  fireEvent.click(button('確認建立並上架菜單'));
  await screen.findByText('已建立 1 項首次菜單。啟用前請再確認門市資料。');
  expect(request).toHaveBeenCalledWith(
    `${base}/initial-menu`,
    'account-a',
    {
      items: [
        {
          name: '蔬菜便當',
          description: '',
          priceMinor: 85,
          initialStock: 20,
          allergens: ['大豆', '芝麻'],
        },
      ],
    },
    undefined,
  );
  expect(button('確認啟用門市').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/我已確認門市、營運方式及菜單/));
  fireEvent.click(button('確認啟用門市'));
  await screen.findByText('門市狀態已更新：營業中。');
  expect(screen.queryByRole('button', { name: '儲存營運設定' })).toBeNull();
  fireEvent.click(button('暫停接單'));
  await screen.findByText('門市狀態已更新：暫停接單。');
  fireEvent.click(button('恢復接單'));
  await screen.findByText('門市狀態已更新：營業中。');
  expect(request.mock.calls.filter(([path]) => path.endsWith('/initial-menu'))).toHaveLength(1);
});

it('offers a read retry after a detail failure without showing a made-up empty workspace', async () => {
  request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  render(view());
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('付款方式')).toBeNull();
  fireEvent.click(button('重新讀取門市狀態'));
  await screen.findByLabelText('付款方式');
});

it('locks retained details after a failed refresh and cannot send from the stale form', async () => {
  await open();
  fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
  request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  fireEvent.click(button('重新讀取門市狀態'));
  await screen.findByRole('alert');
  expect(button('儲存營運設定').disabled).toBe(true);
  fireEvent.submit(screen.getByLabelText('付款方式').closest('form')!);
  expect(request.mock.calls.some(([path]) => path.endsWith('/settings'))).toBe(false);
  fireEvent.click(button('重新讀取門市狀態'));
  await waitFor(() => expect(button('儲存營運設定').disabled).toBe(false));
});

it('hides the retained location when its management permission is revoked on refresh', async () => {
  await open();
  request.mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
  fireEvent.click(button('重新讀取門市狀態'));
  await screen.findByText(/目前無法取得這間門市的管理權限/);
  expect(screen.queryByText('米飯店／一樓門市')).toBeNull();
  expect(screen.queryByLabelText('付款方式')).toBeNull();
});

it('preserves both drafts on refresh and requires a choice before replacing newer settings', async () => {
  await open();
  fireEvent.click(screen.getByLabelText('內用'));
  fillMenu();
  current = {
    ...current,
    readinessVersion: 2,
    serviceModes: ['delivery'],
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
  };
  fireEvent.click(button('重新讀取門市狀態'));
  await screen.findByText(/營運設定已有新版/);
  expect((screen.getByLabelText('內用') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
  fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
  expect(button('儲存營運設定').disabled).toBe(true);
  fireEvent.click(button('保留草稿，儲存時取代'));
  fireEvent.click(button('儲存營運設定'));
  await screen.findByText('營運設定已儲存。');
  expect(request.mock.calls.find(([path]) => path.endsWith('/settings'))?.[2]).toMatchObject({
    expectedVersion: 2,
    serviceModes: ['pickup', 'dine-in'],
  });
});

it('rereads a 409 settings conflict and lets the merchant adopt the current settings', async () => {
  await open();
  fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
  request.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/settings')) {
      current = {
        ...current,
        readinessVersion: 3,
        serviceModes: ['delivery'],
        managerConfirmed: true,
        termsVersion: 'merchant-terms-v1',
      };
      throw new NuniError(409, 'FOOD_MERCHANT_WORKSPACE_CHANGED');
    }
    return response(path, context, input);
  });
  fireEvent.click(button('儲存營運設定'));
  await screen.findByText(/門市資料已變更/);
  expect(request.mock.calls.filter(([path]) => path.endsWith('/settings'))).toHaveLength(1);
  fireEvent.click(button('改用目前設定'));
  expect((screen.getByLabelText('外送') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('自取') as HTMLInputElement).checked).toBe(false);
});

it('never blindly resends an uncertain one-time menu, even when a reload reports zero sellable items', async () => {
  await open();
  fillMenu();
  confirmMenu();
  request.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/initial-menu')) throw new NuniError(0, 'NETWORK_ERROR');
    return response(path, context, input);
  });
  fireEvent.click(button('確認建立並上架菜單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
  fireEvent.click(button('重新讀取門市狀態'));
  await waitFor(() => expect(screen.queryByText('正在確認門市資料…')).toBeNull());
  expect(button('確認建立並上架菜單').disabled).toBe(true);
  fireEvent.click(button('確認建立並上架菜單'));
  expect(request.mock.calls.filter(([path]) => path.endsWith('/initial-menu'))).toHaveLength(1);
  current = { ...current, publishedMenuItems: 1, missingRequirements: ['settings'] };
  fireEvent.click(button('重新讀取門市狀態'));
  await screen.findByText(/目前有 1 項有庫存的上架品項/);
  expect(screen.queryByRole('button', { name: '確認建立並上架菜單' })).toBeNull();
});

it('keeps a confirmed menu receipt when its following detail read fails', async () => {
  await open();
  fillMenu();
  confirmMenu();
  let created = false;
  request.mockImplementation(async (path, context, input) => {
    if (!input && created) throw new NuniError(503, 'UNAVAILABLE');
    const result = await response(path, context, input);
    if (path.endsWith('/initial-menu')) created = true;
    return result;
  });
  fireEvent.click(button('確認建立並上架菜單'));
  await screen.findByText('已建立 1 項首次菜單。啟用前請再確認門市資料。');
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '確認建立並上架菜單' })).toBeNull();
  expect(button('確認啟用門市').disabled).toBe(true);
});

it('keeps one-time menu intent and drafts across returning, changing locations and renewing the session', async () => {
  const mounted = await open();
  fillMenu();
  confirmMenu();
  request.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/initial-menu')) throw new NuniError(0, 'NETWORK_ERROR');
    return response(path, context, input);
  });
  fireEvent.click(button('確認建立並上架菜單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  mounted.unmount();
  current = { ...initial(), locationId: 'location-2', merchantName: '另一家店' };
  const other = render(view('renewed-context', 'location-2'));
  await screen.findByText('另一家店／一樓門市');
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('');
  current = initial();
  other.rerender(view('renewed-context'));
  await screen.findByText('米飯店／一樓門市');
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
  expect(button('確認建立並上架菜單').disabled).toBe(true);
  fireEvent.submit(screen.getByLabelText('品項 1 名稱').closest('form')!);
  expect(request.mock.calls.filter(([path]) => path.endsWith('/initial-menu'))).toHaveLength(1);
});

it('reconciles a pending write after hidden session revalidation without leaving controls busy', async () => {
  const mounted = await open();
  fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
  const pending = deferred<NuniMerchantWorkspaceDetail>();
  request.mockImplementation((path, context, input) =>
    path.endsWith('/settings') ? pending.promise : response(path, context, input),
  );
  fireEvent.click(button('儲存營運設定'));
  mounted.rerender(view('account-a', 'location-1', true));
  current = {
    ...current,
    readinessVersion: 2,
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
  };
  onChanged.mockClear();
  await act(async () => pending.resolve(current));
  expect(onChanged).not.toHaveBeenCalled();
  mounted.rerender(view());
  await screen.findByText(/營運設定已有新版/);
  expect(button('重新讀取門市狀態').disabled).toBe(false);
  expect(button('改用目前設定').disabled).toBe(false);
  fireEvent.click(button('改用目前設定'));
  expect(button('儲存營運設定').disabled).toBe(false);
});

it('rejects fractional money before sending without discarding the menu draft', async () => {
  await open();
  fillMenu();
  confirmMenu();
  fireEvent.change(screen.getByLabelText('品項 1 售價（元）'), { target: { value: '85.5' } });
  confirmMenu();
  fireEvent.submit(screen.getByLabelText('品項 1 名稱').closest('form')!);
  await screen.findByRole('alert');
  expect(request.mock.calls.some(([path]) => path.endsWith('/initial-menu'))).toBe(false);
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
});

it.each(['account', 'location'])(
  'ignores a late settings receipt after switching %s',
  async (scope) => {
    const mounted = await open();
    fireEvent.click(screen.getByLabelText(/我確認營運資訊正確/));
    const pending = deferred<NuniMerchantWorkspaceDetail>();
    request.mockImplementation((path, context, input) =>
      path.endsWith('/settings') ? pending.promise : response(path, context, input),
    );
    fireEvent.click(button('儲存營運設定'));
    const oldReceipt = {
      ...current,
      readinessVersion: 2,
      managerConfirmed: true,
      termsVersion: 'merchant-terms-v1',
    };
    const nextLocation = scope === 'location' ? 'location-2' : 'location-1';
    if (scope === 'account') drafts = new Map();
    current = { ...initial(), locationId: nextLocation, merchantName: '另一家店' };
    mounted.rerender(view(scope === 'account' ? 'account-b' : 'account-a', nextLocation));
    await screen.findByText('另一家店／一樓門市');
    onChanged.mockClear();
    await act(async () => pending.resolve(oldReceipt));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText('營運設定已儲存。')).toBeNull();
    expect((screen.getByLabelText(/我確認營運資訊正確/) as HTMLInputElement).checked).toBe(false);
  },
);

it('hides all location data while the session is revalidated and keeps the draft on return', async () => {
  const mounted = await open();
  fillMenu();
  mounted.rerender(view('account-a', 'location-1', true));
  expect(screen.queryByText('米飯店／一樓門市')).toBeNull();
  expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
  mounted.rerender(view());
  await screen.findByText('米飯店／一樓門市');
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('蔬菜便當');
});

it('shows the actual paused state when replaying an activation that was already completed', async () => {
  ready();
  await open();
  request.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/activate'))
      return {
        ...current,
        activated: true,
        merchantStatus: 'active',
        locationStatus: 'closed',
        publicAccess: false,
      };
    return response(path, context, input);
  });
  fireEvent.click(screen.getByLabelText(/我已確認門市、營運方式及菜單/));
  fireEvent.click(button('確認啟用門市'));
  await screen.findByText('門市狀態已更新：暫停接單。');
  expect(screen.queryByText('門市狀態已更新：營業中。')).toBeNull();
});

it('does not claim pause succeeded when the receipt still says open', async () => {
  ready();
  current = {
    ...current,
    activated: true,
    merchantStatus: 'active',
    locationStatus: 'open',
    publicAccess: true,
  };
  await open();
  request.mockImplementation(async () => current);
  fireEvent.click(button('暫停接單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  expect(screen.queryByText('門市狀態已更新：暫停接單。')).toBeNull();
  expect(button('暫停接單').disabled).toBe(true);
});

it('cannot resume a store suspended by the administrator', async () => {
  ready();
  current = { ...current, activated: true };
  await open();
  expect(screen.queryByRole('button', { name: '恢復接單' })).toBeNull();
  expect(screen.getByText(/門市的營運狀態需要由場域管理者確認/)).toBeTruthy();
});

it('expires the account boundary when authorization is revoked', async () => {
  request.mockRejectedValue(new NuniError(401, 'SESSION_CHANGED'));
  render(view());
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText('付款方式')).toBeNull();
});
