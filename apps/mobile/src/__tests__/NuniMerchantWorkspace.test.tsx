import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniMerchant } from '../screens/nuni/NuniMerchant';
import { NuniDraftProvider } from '../state/nuniDrafts';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';

const mockRequest = jest.fn();
const mockRefresh = jest.fn();
let mockAuth = {
  session: { platformAccountId: 'pa-a', context: 'context-a' },
  loading: false,
  pendingLogout: false,
  error: '',
  request: mockRequest,
  refresh: mockRefresh,
};
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const base = 'merchant-workspaces/school-one/location-one';
const terms = '我確認營運資訊正確並同意現行店家營運條款';
const menuConsent = '我已確認品項、售價與庫存，了解初始菜單只能建立一次';
const receipt = {
  menuVersionId: 'food-menu_11111111-1111-4111-8111-111111111111',
  createdItems: 1,
};
const initial = (): NuniMerchantWorkspaceDetail => ({
  tenantId: 'school-one',
  tenantName: '第一學校',
  applicationId: 'fma-one',
  merchantId: 'merchant-one',
  merchantName: '餐坊',
  merchantStatus: 'suspended',
  locationId: 'location-one',
  locationName: '第一門市',
  locationStatus: 'suspended',
  publicAccess: false,
  campusId: 'main',
  campusName: '主校區',
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: false,
  termsVersion: null,
  activated: false,
  readinessVersion: 1,
  publishedMenuItems: 0,
  merchantMode: 'full',
  merchantModeLabel: '完整點餐',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: null,
  missingRequirements: ['settings', 'menu'],
});
let workspace: NuniMerchantWorkspaceDetail;
const other = () => ({
  ...initial(),
  tenantId: 'school-two',
  locationId: 'location-two',
  locationName: '第二門市',
});
const writes = () => mockRequest.mock.calls.filter((call) => call[2] !== undefined);
function respond(path: string) {
  if (path === 'merchant-onboarding-programs') return { programs: [] };
  if (path === 'merchant-applications') return { applications: [] };
  if (path === 'merchant-workspaces') return { workspaces: [workspace, other()] };
  if (path === base) return workspace;
  if (path === 'merchant-workspaces/school-two/location-two') return other();
  throw new Error(`Unexpected path ${path}`);
}
function ui(cache = new Map<string, unknown>()) {
  return (
    <NuniDraftProvider cache={cache}>
      <NuniMerchant />
    </NuniDraftProvider>
  );
}
async function open(view: ReturnType<typeof render>, name = '第一門市') {
  fireEvent.press(await view.findByRole('button', { name: `管理門市：${name}` }));
  await view.findByRole('button', { name: '檢查初始菜單' });
}
async function reload(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByRole('button', { name: '重新載入門市狀態' }));
  await waitFor(() => expect(view.queryByText('正在核對門市狀態…')).toBeNull());
}
function fillMenu(view: ReturnType<typeof render>, name = '雞腿飯', price = '120', stock = '20') {
  fireEvent.changeText(view.getByLabelText('品項 1 名稱'), name);
  fireEvent.changeText(view.getByLabelText('品項 1 售價（元）'), price);
  fireEvent.changeText(view.getByLabelText('品項 1 初始庫存（份）'), stock);
}
function reviewAndSend(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByRole('button', { name: '檢查初始菜單' }));
  fireEvent.press(view.getByRole('checkbox', { name: menuConsent }));
  fireEvent.press(view.getByRole('button', { name: '確認建立初始菜單' }));
}
beforeEach(() => {
  workspace = initial();
  mockAuth = {
    session: { platformAccountId: 'pa-a', context: 'context-a' },
    loading: false,
    pendingLogout: false,
    error: '',
    request: mockRequest,
    refresh: mockRefresh,
  };
  mockRequest.mockReset().mockImplementation(async (path) => respond(path));
  mockRefresh.mockReset().mockResolvedValue(undefined);
});

test('completes settings, one-time menu, explicit activation and pause/resume using real scoped operations', async () => {
  mockRequest.mockImplementation(async (path, _context, input, method) => {
    if (path.endsWith('/settings')) {
      expect(method).toBe('PUT');
      workspace = {
        ...workspace,
        serviceModes: input.serviceModes,
        paymentMode: input.paymentMode,
        termsVersion: input.termsVersion,
        readinessVersion: 2,
        managerConfirmed: true,
        missingRequirements: ['menu'],
      };
      return workspace;
    }
    if (path.endsWith('/initial-menu')) {
      workspace = { ...workspace, publishedMenuItems: 1, missingRequirements: [] };
      return receipt;
    }
    if (path.endsWith('/activate')) {
      workspace = {
        ...workspace,
        activated: true,
        readinessVersion: 3,
        merchantStatus: 'active',
        locationStatus: 'open',
        publicAccess: true,
      };
      return workspace;
    }
    if (path.endsWith('/availability')) {
      workspace = {
        ...workspace,
        locationStatus: input.acceptingOrders ? 'open' : 'closed',
        publicAccess: input.acceptingOrders,
      };
      return workspace;
    }
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('checkbox', { name: terms }));
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  await view.findByText('營運設定已儲存。');
  expect(writes()[0]).toEqual([
    `${base}/settings`,
    'context-a',
    {
      serviceModes: ['pickup'],
      paymentMode: 'counter-only',
      termsVersion: 'merchant-terms-v1',
      expectedVersion: 1,
    },
    'PUT',
  ]);
  fillMenu(view);
  fireEvent.changeText(view.getByLabelText('品項 1 過敏原（逗號分隔，可留白）'), '蛋、牛奶');
  fireEvent.press(view.getByRole('button', { name: '檢查初始菜單' }));
  fireEvent.press(view.getByRole('button', { name: '確認建立初始菜單' }));
  expect(writes()).toHaveLength(1);
  fireEvent.press(view.getByRole('checkbox', { name: menuConsent }));
  fireEvent.press(view.getByRole('button', { name: '確認建立初始菜單' }));
  await view.findByText('初始菜單已建立。請確認營運條件後再啟用門市。');
  expect(writes()[1][2]).toEqual({
    items: [
      {
        name: '雞腿飯',
        description: '',
        priceMinor: 120,
        initialStock: 20,
        allergens: ['蛋', '牛奶'],
      },
    ],
  });
  fireEvent.press(view.getByRole('button', { name: '檢查並啟用門市' }));
  expect(writes()).toHaveLength(2);
  fireEvent.press(view.getByRole('button', { name: '確認啟用並開始接單' }));
  await view.findByText('營業中');
  fireEvent.press(view.getByRole('button', { name: '暫停接單' }));
  await view.findByText('暫停接單');
  expect(writes()[3][2]).toEqual({ acceptingOrders: false });
  await waitFor(() =>
    expect(view.getByRole('button', { name: '恢復接單' }).props.accessibilityState.disabled).toBe(
      false,
    ),
  );
  fireEvent.press(view.getByRole('button', { name: '恢復接單' }));
  await view.findByText('營業中');
  expect(writes()[4][2]).toEqual({ acceptingOrders: true });
});

test.each(['12.5', '1e2', '0', '-1', '10000001'])(
  'rejects invalid whole-dollar price %s before one-time confirmation',
  async (price) => {
    const view = render(ui());
    await open(view);
    fillMenu(view, '雞腿飯', price);
    fireEvent.press(view.getByRole('button', { name: '檢查初始菜單' }));
    expect(view.getByText(/請填寫每項名稱/)).toBeTruthy();
    expect(view.queryByRole('button', { name: '確認建立初始菜單' })).toBeNull();
    expect(writes()).toHaveLength(0);
  },
);

test('unknown initial-menu result stays blocked after reload returns zero, back navigation and later same-scope response', async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation((path, _context, input) =>
    input
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(respond(path)),
  );
  const cache = new Map<string, unknown>();
  const view = render(ui(cache));
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  fireEvent.press(view.getByRole('button', { name: '確認建立初始菜單' }));
  expect(writes()).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '返回我的門市' }));
  await open(view);
  expect(view.getByText(/零個可售品項不代表未收件/)).toBeTruthy();
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('雞腿飯');
  expect(view.getByLabelText('品項 1 名稱').props.editable).toBe(false);
  await act(async () => finish(receipt));
  expect(view.queryByText(/初始菜單已建立/)).toBeNull();
  await reload(view);
  fireEvent.press(view.getByRole('button', { name: '檢查初始菜單' }));
  expect(writes()).toHaveLength(1);
});

test('timeout preserves menu draft and never offers a blind resubmit even after zero-item reconciliation', async () => {
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) throw new NuniError(502, 'UPSTREAM_ERROR');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  await view.findByText(/尚未確認這次操作/);
  expect(view.queryByText(/初始菜單已建立/)).toBeNull();
  await reload(view);
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('雞腿飯');
  expect(view.getByRole('button', { name: '檢查初始菜單' }).props.accessibilityState.disabled).toBe(
    true,
  );
  expect(writes()).toHaveLength(1);
});

test('menu creation receipt followed by a failed read never clears one-time intent or claims full readiness', async () => {
  let created = false;
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) {
      created = true;
      return receipt;
    }
    if (path === base && created) throw new NuniError(422, 'READ_UNAVAILABLE');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  await view.findByText(/菜單建立回執已收到，但目前無法核對/);
  expect(view.getByText(/零個可售品項不代表未收件/)).toBeTruthy();
  expect(view.queryByText('初始菜單已建立。請確認營運條件後再啟用門市。')).toBeNull();
  expect(
    view.getByRole('button', { name: '檢查並啟用門市' }).props.accessibilityState.disabled,
  ).toBe(true);
});

test('preserves settings draft on network failure, reconciles changed version and requires an explicit conflict choice', async () => {
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) throw new Error('offline');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fireEvent.press(view.getByRole('button', { name: '內用' }));
  fireEvent.press(view.getByRole('checkbox', { name: terms }));
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  await view.findByText(/尚未確認這次操作/);
  workspace = { ...workspace, serviceModes: ['delivery'], readinessVersion: 2 };
  await reload(view);
  expect(view.getByText(/草稿尚未覆蓋最新設定/)).toBeTruthy();
  expect(view.getByRole('button', { name: '內用' }).props.accessibilityState.selected).toBe(true);
  expect(view.getByRole('button', { name: '儲存營運設定' }).props.accessibilityState.disabled).toBe(
    true,
  );
  fireEvent.press(view.getByRole('button', { name: '保留草稿，套用最新版本' }));
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  expect(writes()).toHaveLength(1);
  fireEvent.press(view.getByRole('checkbox', { name: terms }));
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1][2]).toMatchObject({ serviceModes: ['pickup', 'dine-in'], expectedVersion: 2 });
});

test('a mismatched location receipt stays uncertain, never announces settings success', async () => {
  mockRequest.mockImplementation(async (path, _context, input) =>
    input ? { ...other(), ...input, managerConfirmed: true, readinessVersion: 2 } : respond(path),
  );
  const view = render(ui());
  await open(view);
  fireEvent.press(view.getByRole('checkbox', { name: terms }));
  fireEvent.press(view.getByRole('button', { name: '儲存營運設定' }));
  await view.findByText(/尚未確認這次操作/);
  expect(view.queryByText('營運設定已儲存。')).toBeNull();
});

test.each([403, 404])('permission failure %s hides private workspace controls', async (status) => {
  const view = render(ui());
  await open(view);
  fillMenu(view);
  mockRequest.mockImplementation(async () => {
    throw new NuniError(status, 'FORBIDDEN');
  });
  await reload(view);
  expect(view.getByText(/目前沒有這間門市的管理權限/)).toBeTruthy();
  expect(view.queryByLabelText('品項 1 名稱')).toBeNull();
  expect(view.queryByText('第一門市')).toBeNull();
});

test.each([{ pendingLogout: true }, { loading: true }, { error: '帳號待確認' }])(
  'auth uncertainty hides merchant details immediately: %j',
  async (change) => {
    const view = render(ui());
    await open(view);
    fillMenu(view);
    mockAuth = { ...mockAuth, ...change };
    view.rerender(ui());
    expect(view.queryByLabelText('品項 1 名稱')).toBeNull();
    expect(view.queryByText('第一門市')).toBeNull();
    expect(view.getByText('請先確認 Google 帳號狀態。')).toBeTruthy();
  },
);

test('switching accounts clears private draft and ignores old response, even with the same draft provider', async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation((path, _context, input) =>
    input
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(respond(path)),
  );
  const cache = new Map<string, unknown>();
  const view = render(ui(cache));
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  mockAuth = { ...mockAuth, session: { platformAccountId: 'pa-b', context: 'context-b' } };
  view.rerender(ui(cache));
  await open(view);
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('');
  expect(view.getByLabelText('品項 1 名稱').props.editable).toBe(true);
  await act(async () => finish(receipt));
  expect(view.queryByText(/初始菜單已建立/)).toBeNull();
});

test('switching stores keeps draft and uncertain attempt scoped to the original tenant/location', async () => {
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) throw new Error('offline');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  await view.findByText(/尚未確認這次操作/);
  fireEvent.press(view.getByRole('button', { name: '返回我的門市' }));
  await open(view, '第二門市');
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('');
  fillMenu(view, '第二店飯');
  reviewAndSend(view);
  await view.findByText(/尚未確認這次操作/);
  expect(writes()[1][0]).toBe('merchant-workspaces/school-two/location-two/initial-menu');
  expect(writes()[1][2].items[0].name).toBe('第二店飯');
});

test('a suspended active location cannot restore itself or edit activated settings', async () => {
  workspace = {
    ...workspace,
    activated: true,
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    publishedMenuItems: 1,
    missingRequirements: [],
  };
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '管理門市：第一門市' }));
  await view.findByText('門市目前由場域管理者停權，請聯絡管理者確認。');
  expect(view.queryByRole('button', { name: '恢復接單' })).toBeNull();
  expect(view.queryByRole('button', { name: '儲存營運設定' })).toBeNull();
  expect(writes()).toHaveLength(0);
});

test('same-account revalidation preserves the menu attempt but reloads private server data with the new context', async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation((path, _context, input) =>
    input
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(respond(path)),
  );
  const cache = new Map<string, unknown>();
  const view = render(ui(cache));
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  mockAuth = { ...mockAuth, loading: true };
  view.rerender(ui(cache));
  expect(view.queryByLabelText('品項 1 名稱')).toBeNull();
  mockAuth = {
    ...mockAuth,
    loading: false,
    session: { ...mockAuth.session, context: 'revalidated' },
  };
  view.rerender(ui(cache));
  await open(view);
  expect(mockRequest).toHaveBeenLastCalledWith(base, 'revalidated', undefined, undefined);
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('雞腿飯');
  expect(view.getByRole('button', { name: '檢查初始菜單' }).props.accessibilityState.disabled).toBe(
    true,
  );
  await act(async () => finish(receipt));
  expect(view.queryByText(/初始菜單已建立/)).toBeNull();
});

test('an existing-menu conflict cannot unlock another initial-menu submission', async () => {
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) throw new NuniError(409, 'FOOD_MERCHANT_INITIAL_MENU_EXISTS');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  await view.findByText(/操作未被接受/);
  await reload(view);
  expect(view.getByRole('button', { name: '檢查初始菜單' }).props.accessibilityState.disabled).toBe(
    true,
  );
  expect(writes()).toHaveLength(1);
});

test('a definite validation rejection retains the menu draft and allows correction only after a fresh read', async () => {
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) throw new NuniError(422, 'INVALID_INPUT');
    return respond(path);
  });
  const view = render(ui());
  await open(view);
  fillMenu(view);
  reviewAndSend(view);
  await view.findByText(/操作未被接受/);
  expect(view.getByLabelText('品項 1 名稱').props.editable).toBe(false);
  await reload(view);
  expect(view.getByLabelText('品項 1 名稱').props.value).toBe('雞腿飯');
  expect(view.getByLabelText('品項 1 名稱').props.editable).toBe(true);
});

test('legacy activated online-payment setting can downgrade to counter payment without changing service modes', async () => {
  workspace = {
    ...workspace,
    activated: true,
    merchantStatus: 'active',
    locationStatus: 'open',
    publicAccess: true,
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    paymentMode: 'online-and-counter',
    serviceModes: ['pickup', 'delivery'],
    publishedMenuItems: 1,
    missingRequirements: [],
  };
  mockRequest.mockImplementation(async (path, _context, input) => {
    if (input) {
      workspace = { ...workspace, paymentMode: 'counter-only', readinessVersion: 2 };
      return workspace;
    }
    return respond(path);
  });
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '管理門市：第一門市' }));
  fireEvent.press(await view.findByRole('button', { name: '改為只收櫃檯付款' }));
  await view.findByText('營運設定已儲存。');
  expect(writes()[0][2]).toEqual({
    serviceModes: ['pickup', 'delivery'],
    paymentMode: 'counter-only',
    termsVersion: 'merchant-terms-v1',
    expectedVersion: 1,
  });
});

test('unsaved settings cannot activate using different server settings until the merchant explicitly discards or saves the draft', async () => {
  workspace = {
    ...workspace,
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    publishedMenuItems: 1,
    missingRequirements: [],
  };
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '管理門市：第一門市' }));
  fireEvent.press(await view.findByRole('button', { name: '檢查並啟用門市' }));
  fireEvent.press(view.getByRole('button', { name: '內用' }));
  expect(view.queryByRole('button', { name: '確認啟用並開始接單' })).toBeNull();
  expect(
    view.getByRole('button', { name: '檢查並啟用門市' }).props.accessibilityState.disabled,
  ).toBe(true);
  expect(view.getByText(/已儲存服務：自取/)).toBeTruthy();
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '捨棄設定草稿，改用最新設定' }));
  expect(view.getByRole('button', { name: '內用' }).props.accessibilityState.selected).toBe(false);
  expect(
    view.getByRole('button', { name: '檢查並啟用門市' }).props.accessibilityState.disabled,
  ).toBe(false);
});
