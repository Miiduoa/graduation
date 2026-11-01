import React from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { NavigationContext } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniFood } from '../screens/nuni/NuniFood';
import { NuniMerchantOrders } from '../screens/nuni/NuniMerchantOrders';
import { NuniDraftProvider } from '../state/nuniDrafts';
import {
  clearAllFoodPendingForAccount,
  loadFoodPending,
  saveFoodPending,
} from '../state/foodPersistence';
import { NuniError } from '@campus/shared/src/nuni';

const mockSecureRecords = new Map<string, string>();
const mockSecureKey = (key: string) => {
  if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid native SecureStore key');
  return key;
};
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecureRecords.get(mockSecureKey(key)) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureRecords.set(mockSecureKey(key), value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureRecords.delete(mockSecureKey(key));
  }),
}));
const mockRequest = jest.fn();
const mockRefresh = jest.fn();
const mockPermission = jest.fn();
let mockCameraGranted = true;
let mockScan: ((value: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: mockCameraGranted }, mockPermission],
  CameraView: (props: any) => {
    mockScan = props.onBarcodeScanned;
    return require('react').createElement(require('react-native').View, {
      testID: 'food-pickup-camera',
    });
  },
}));
jest.mock(
  'react-native-qrcode-svg',
  () => (props: any) =>
    require('react').createElement(require('react-native').View, {
      testID: 'pickup-qr',
      value: props.value,
    }),
);
let mockAuth: any;
let mockSequence = 0;
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `11111111-1111-4111-8111-${String(++mockSequence).padStart(12, '0')}`,
}));
const realm = 'realms/school-one/food';
const merchant = 'merchant-workspaces/school-one/location-one';
const token = 'a'.repeat(43);
const price = (amountMinor: number) => ({ amountMinor, currency: 'TWD' });
const date = () => new Date().toISOString();
const future = () => new Date(Date.now() + 30 * 60_000).toISOString();
let state: string;
let hasOrder: boolean;
let paused: boolean;
let shiftOpen: boolean;
let expiresAt: string;
const location = () => ({
  id: 'location-one',
  campusId: 'main',
  name: '餐坊',
  description: '現場自取',
  zoneLabel: '一樓',
  timeZone: 'Asia/Taipei',
  state: 'open',
  merchantMode: 'full',
  sourceLabel: '店家',
  sourceUpdatedAt: null,
  allowedActions: ['view-menu'],
});
const lines = () => [
  {
    menuItemId: 'rice',
    nameSnapshot: '雞腿飯',
    quantity: 2,
    selectedOptions: [{ optionId: 'brown', nameSnapshot: '糙米', priceDelta: price(5) }],
    unitPrice: price(90),
    lineTotal: price(180),
  },
];
const summary = () => ({
  id: 'order-one',
  locationId: 'location-one',
  locationName: '餐坊',
  state,
  requestedPickupAt: future(),
  itemCount: 2,
  total: price(180),
  createdAt: date(),
  updatedAt: date(),
  allowedActions:
    state === 'ready' ? ['show-pickup-credential'] : state === 'payment-pending' ? ['cancel'] : [],
});
const detail = () => ({
  ...summary(),
  quoteId: 'quote-one',
  lines: lines(),
  pickup: {
    state: state === 'ready' || state === 'fulfilled' ? state : 'awaiting-preparation',
    displayCode: 'A001',
    calls: [],
    callCount: 0,
    allowedActions: state === 'ready' ? ['present-one-time-token'] : [],
    ...(state === 'ready' ? { credential: { kind: 'one-time-token', token, expiresAt } } : {}),
  },
});
const shift = () => ({
  id: 'shift-one',
  locationId: 'location-one',
  state: 'open',
  openedAt: date(),
  openingCash: price(1000),
  campusLedgerTotal: price(0),
  allowedActions: ['handover', 'view'],
});
const staffOrder = () => ({
  id: 'order-one',
  locationId: 'location-one',
  viewerScope: 'cash-register',
  state,
  requestedPickupAt: future(),
  pickupDisplayCode: 'A001',
  lines: lines(),
  total: price(180),
  allowedActions:
    state === 'payment-pending' && shiftOpen
      ? ['record-counter-payment']
      : state === 'paid'
        ? ['accept']
        : state === 'ready'
          ? ['fulfill-pickup']
          : [],
  kitchenTickets: ['accepted', 'preparing', 'ready'].includes(state)
    ? [
        {
          id: 'ticket-one',
          station: 'hot',
          state: state === 'accepted' ? 'queued' : state,
          allowedActions:
            state === 'accepted'
              ? ['start-preparation']
              : state === 'preparing'
                ? ['mark-ready']
                : [],
        },
      ]
    : [],
});
async function respond(path: string, _context?: string, input?: any) {
  if (path === 'realms')
    return {
      realms: paused ? [] : [{ tenantId: 'school-one', name: '第一校區', services: ['food'] }],
    };
  if (path === 'food-order-realms')
    return { realms: hasOrder ? [{ tenantId: 'school-one', name: '第一校區' }] : [] };
  if (path === `${realm}/locations`) return { locations: [location()] };
  if (path === `${realm}/locations/location-one/menu`)
    return {
      location: location(),
      menuVersion: 'menu-one',
      generatedAt: date(),
      sections: [
        {
          id: 'main',
          name: '主餐',
          items: [
            {
              id: 'rice',
              name: '雞腿飯',
              description: '當日現做',
              basePrice: price(85),
              available: true,
              dietaryTags: [],
              allergenTags: ['大豆'],
              nutrition: { declared: false },
              allowedActions: ['add-to-quote'],
              optionGroups: [
                {
                  id: 'grain',
                  name: '米飯',
                  minimumSelections: 1,
                  maximumSelections: 1,
                  options: [{ id: 'brown', name: '糙米', priceDelta: price(5), available: true }],
                },
              ],
            },
          ],
        },
      ],
    };
  if (path === `${realm}/quotes`)
    return {
      id: 'quote-one',
      locationId: 'location-one',
      menuVersion: 'menu-one',
      state: 'active',
      requestedPickupAt: input.requestedPickupAt,
      lines: input.items.map((item: any) => ({
        ...lines()[0],
        quantity: item.quantity,
        selectedOptions: item.selectedOptionIds.map((id: string) => ({
          optionId: id,
          nameSnapshot: id === 'white' ? '白飯' : '糙米',
          priceDelta: price(id === 'white' ? 0 : 5),
        })),
        unitPrice: price(item.selectedOptionIds.includes('white') ? 85 : 90),
        lineTotal: price((item.selectedOptionIds.includes('white') ? 85 : 90) * item.quantity),
        ...(item.customerNote ? { customerNote: item.customerNote } : {}),
      })),
      subtotal: price(
        input.items.reduce(
          (sum: number, item: any) =>
            sum + (item.selectedOptionIds.includes('white') ? 85 : 90) * item.quantity,
          0,
        ),
      ),
      fees: [],
      total: price(
        input.items.reduce(
          (sum: number, item: any) =>
            sum + (item.selectedOptionIds.includes('white') ? 85 : 90) * item.quantity,
          0,
        ),
      ),
      expiresAt,
      allowedActions: ['create-order'],
    };
  if (path === `${realm}/orders` && input) {
    hasOrder = true;
    return { orderId: 'order-one', state, updatedAt: date(), replayed: false };
  }
  if (path === `${realm}/orders`) return { orders: hasOrder ? [summary()] : [] };
  if (path === `${realm}/orders/order-one`) return detail();
  if (path === `${realm}/orders/order-one/cancel`) {
    state = 'canceled';
    return { orderId: 'order-one', state, updatedAt: date(), replayed: false };
  }
  if (path === `${merchant}/orders`) return { orders: state === 'fulfilled' ? [] : [staffOrder()] };
  if (path === `${merchant}/shift` && input) {
    shiftOpen = true;
    return { ...shift(), openingCash: price(input.openingCashMinor) };
  }
  if (path === `${merchant}/shift`) {
    if (!shiftOpen) throw new NuniError(404, 'FOOD_SHIFT_NOT_FOUND');
    return shift();
  }
  if (path === `${merchant}/shift/handover`) {
    shiftOpen = false;
    return {
      closed: {
        ...shift(),
        state: 'closed',
        closedAt: date(),
        countedCash: price(input.countedCashMinor),
        expectedCash: price(1180),
        allowedActions: ['view'],
      },
    };
  }
  if (path.endsWith('/confirm-counter-refund')) state = 'canceled';
  else if (path.endsWith('/reject')) state = 'rejection-pending-refund';
  else if (path.endsWith('/cancel-accepted')) state = 'cancellation-pending-refund';
  else if (path.endsWith('/counter-payment')) state = 'paid';
  else if (path.endsWith('/accept')) {
    state = 'accepted';
    return {
      orderId: 'order-one',
      state,
      updatedAt: date(),
      replayed: false,
      kitchenTicketId: 'ticket-one',
    };
  } else if (path.endsWith('/start')) state = 'preparing';
  else if (path.endsWith('/ready')) state = 'ready';
  else if (path.endsWith('/fulfill')) {
    state = 'fulfilled';
    return { orderId: 'order-one', state, fulfilledAt: date(), replayed: false };
  } else throw new Error(`Unexpected ${path}`);
  return { orderId: 'order-one', state, updatedAt: date(), replayed: false };
}
function ui(cache = new Map<string, unknown>()) {
  return (
    <NuniDraftProvider cache={cache}>
      <NuniFood />
    </NuniDraftProvider>
  );
}
function staffUi(cache = new Map<string, unknown>(), locationId = 'location-one') {
  return (
    <NuniDraftProvider cache={cache}>
      <NuniMerchantOrders
        key={`${mockAuth.session.context}:${locationId}`}
        context={mockAuth.session.context}
        tenantId="school-one"
        locationId={locationId}
        onBack={jest.fn()}
      />
    </NuniDraftProvider>
  );
}
const writes = () => mockRequest.mock.calls.filter((call) => call[2] !== undefined);
async function openMenu(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByRole('button', { name: '查看餐點：第一校區' }));
  fireEvent.press(await view.findByRole('button', { name: '選餐：餐坊' }));
  await view.findByRole('button', { name: '選擇雞腿飯' });
}
async function customizeRice(view: ReturnType<typeof render>, quantity = '2') {
  fireEvent.press(view.getByRole('button', { name: /選擇雞腿飯|調整雞腿飯/ }));
  await view.findByLabelText('雞腿飯數量');
  fireEvent.changeText(view.getByLabelText('雞腿飯數量'), quantity);
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  await view.findByRole('button', { name: '查看購物籃，已選 2 份' });
}
async function fillQuote(view: ReturnType<typeof render>) {
  await openMenu(view);
  await customizeRice(view);
  fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 2 份' }));
  fireEvent.press(view.getByRole('button', { name: '確認餐點與金額' }));
  await view.findByText('應付總額 180 元');
}
async function openOrder(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByRole('button', { name: '訂單紀錄：第一校區' }));
  fireEvent.press(await view.findByRole('button', { name: '查看訂單 order-one' }));
  await view.findByText('取餐號碼 A001');
}
beforeEach(async () => {
  process.env.EXPO_PUBLIC_ONLINE_ORDERING = 'true';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockAuth = {
    session: { platformAccountId: 'pa-a', context: 'context-a' },
    loading: false,
    error: '',
    pendingLogout: false,
    request: mockRequest,
    refresh: mockRefresh,
  };
  state = 'payment-pending';
  hasOrder = false;
  paused = false;
  shiftOpen = false;
  expiresAt = future();
  mockSequence = 0;
  mockCameraGranted = true;
  mockScan = undefined;
  mockPermission.mockReset().mockResolvedValue({ granted: false });
  mockRequest.mockReset().mockImplementation(respond);
  mockRefresh.mockReset().mockResolvedValue(undefined);
  await clearAllFoodPendingForAccount('pa-a');
  await clearAllFoodPendingForAccount('pa-b');
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_ONLINE_ORDERING;
});

test('closed online ordering keeps existing orders and does not open a new meal', async () => {
  process.env.EXPO_PUBLIC_ONLINE_ORDERING = 'false';
  hasOrder = true;
  const view = render(ui());
  expect(view.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(view.queryByText('選擇門市、確認金額後送出，到店付款。取餐前可隨時查看進度。')).toBeNull();
  expect(view.queryByRole('button', { name: /查看餐點/ })).toBeNull();
  fireEvent.press(await view.findByRole('button', { name: '訂單紀錄：第一校區' }));
  expect(await view.findByRole('button', { name: '查看訂單 order-one' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '餐點門市' })).toBeNull();
  expect(view.queryByRole('button', { name: /選餐/ })).toBeNull();
});
test('student selects required options, reviews whole TWD quote and explicitly places an onsite order', async () => {
  const view = render(ui());
  await fillQuote(view);
  expect(writes()).toHaveLength(1);
  expect(writes()[0][2]).toMatchObject({
    locationId: 'location-one',
    items: [{ menuItemId: 'rice', quantity: 2, selectedOptionIds: ['brown'] }],
  });
  expect(view.getByText(/不會線上扣款/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '確認送出訂單，到店付款' }));
  await view.findByText('取餐號碼 A001');
  expect(view.getByText('等待現場付款')).toBeTruthy();
  expect(writes()[1][2]).toMatchObject({ quoteId: 'quote-one' });
  expect(writes().some((call) => call[0].includes('payment-session'))).toBe(false);
});
test('missing required option and out-of-range quantities do not request a quote', async () => {
  const view = render(ui());
  await openMenu(view);
  fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
  await view.findByLabelText('雞腿飯數量');
  fireEvent.changeText(view.getByLabelText('雞腿飯數量'), '2');
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  expect(view.getByRole('alert')).toHaveTextContent(/米飯/);
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  await view.findByRole('button', { name: '查看購物籃，已選 2 份' });
  fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 2 份' }));
  fireEvent.changeText(view.getByLabelText('雞腿飯數量'), '21');
  fireEvent.press(view.getByRole('button', { name: '確認餐點與金額' }));
  expect(view.getAllByRole('alert').some((node) => /1–20|數量/.test(node.props.children))).toBe(
    true,
  );
  expect(writes()).toHaveLength(0);
});
test('menu customization and basket navigation preserve chosen options and notes before quoting', async () => {
  const view = render(ui());
  await openMenu(view);
  expect(view.queryByLabelText('雞腿飯數量')).toBeNull();
  expect(view.queryByLabelText('雞腿飯備註')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
  fireEvent.changeText(view.getByLabelText('雞腿飯數量'), '2');
  fireEvent.changeText(view.getByLabelText('雞腿飯備註'), '醬汁另外放');
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  expect(view.getAllByRole('alert')).toHaveLength(1);
  expect(view.getByRole('alert')).toHaveTextContent(/米飯/);
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 2 份' }));
  expect(view.getByLabelText('雞腿飯備註').props.value).toBe('醬汁另外放');
  expect(
    view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }).props.accessibilityState.selected,
  ).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '繼續選餐' }));
  expect(view.queryByLabelText('雞腿飯數量')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '調整雞腿飯' }));
  expect(view.getByLabelText('雞腿飯數量').props.value).toBe('2');
  expect(view.getByLabelText('雞腿飯備註').props.value).toBe('醬汁另外放');
  expect(writes()).toHaveLength(0);
});
test('returning from a new customization keeps a draft without putting an unfinished dish in the basket', async () => {
  const view = render(ui());
  await openMenu(view);
  fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
  fireEvent.changeText(view.getByLabelText('雞腿飯數量'), '3');
  fireEvent.changeText(view.getByLabelText('雞腿飯備註'), '醬汁另外放');
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
  fireEvent.press(view.getByRole('button', { name: '返回菜單' }));
  expect(view.getByRole('button', { name: '購物籃還是空的' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
  expect(view.getByLabelText('雞腿飯數量').props.value).toBe('3');
  expect(view.getByLabelText('雞腿飯備註').props.value).toBe('醬汁另外放');
  expect(
    view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }).props.accessibilityState.selected,
  ).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  expect(view.getByRole('button', { name: '查看購物籃，已選 3 份' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});
test.each(['zero', 'remove'] as const)(
  '%s keeps customization available when the dish is selected again',
  async (method) => {
    const view = render(ui());
    await openMenu(view);
    fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
    fireEvent.changeText(view.getByLabelText('雞腿飯備註'), '少醬');
    fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
    fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
    fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 1 份' }));
    if (method === 'zero') fireEvent.press(view.getByRole('button', { name: '減少雞腿飯數量' }));
    else fireEvent.press(view.getByRole('button', { name: '移除：雞腿飯' }));
    expect(view.getByText('購物籃還是空的，請先選餐。')).toBeTruthy();
    expect(view.getByRole('button', { name: '確認餐點與金額' })).toBeDisabled();
    fireEvent.press(view.getByRole('button', { name: '繼續選餐' }));
    fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
    expect(view.getByLabelText('雞腿飯數量').props.value).toBe('1');
    expect(view.getByLabelText('雞腿飯備註').props.value).toBe('少醬');
    expect(
      view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }).props.accessibilityState.selected,
    ).toBe(true);
    fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
    fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 1 份' }));
    fireEvent.press(view.getByRole('button', { name: '確認餐點與金額' }));
    await view.findByText('應付總額 90 元');
    expect(writes()[0][2].items).toEqual([
      { menuItemId: 'rice', quantity: 1, selectedOptionIds: ['brown'], customerNote: '少醬' },
    ]);
  },
);
test('choosing a different single-choice option replaces the previous choice', async () => {
  mockRequest.mockImplementation(async (path, context, input) => {
    const result = await respond(path, context, input);
    if (path === `${realm}/locations/location-one/menu`)
      (result as any).sections[0].items[0].optionGroups[0].options.push({
        id: 'white',
        name: '白飯',
        priceDelta: price(0),
        available: true,
      });
    return result;
  });
  const view = render(ui());
  await openMenu(view);
  fireEvent.press(view.getByRole('button', { name: '選擇雞腿飯' }));
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }));
  fireEvent.press(view.getByRole('button', { name: '雞腿飯：白飯（0 元）' }));
  expect(
    view.getByRole('button', { name: '雞腿飯：糙米（5 元）' }).props.accessibilityState.selected,
  ).toBe(false);
  expect(
    view.getByRole('button', { name: '雞腿飯：白飯（0 元）' }).props.accessibilityState.selected,
  ).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '放入購物籃' }));
  expect(view.queryByRole('alert')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 1 份' }));
  fireEvent.press(view.getByRole('button', { name: '確認餐點與金額' }));
  await view.findByText('應付總額 85 元');
  expect(writes()[0][2].items[0].selectedOptionIds).toEqual(['white']);
});
test('a dish removed from the refreshed menu remains removable from the basket', async () => {
  let removed = false;
  mockRequest.mockImplementation(async (path, context, input) => {
    const result = await respond(path, context, input);
    if (removed && path === `${realm}/locations/location-one/menu`)
      (result as any).sections[0].items = [];
    return result;
  });
  const view = render(ui());
  await openMenu(view);
  await customizeRice(view);
  fireEvent.press(view.getByRole('button', { name: '查看購物籃，已選 2 份' }));
  removed = true;
  fireEvent.press(view.getByRole('button', { name: '重新讀取' }));
  await view.findByText('這道餐點已不在目前菜單中');
  fireEvent.press(view.getByRole('button', { name: '移除下架餐點' }));
  expect(view.getByText('購物籃還是空的，請先選餐。')).toBeTruthy();
  expect(writes()).toHaveLength(0);
});
test('expired quote cannot create an order', async () => {
  expiresAt = new Date(Date.now() - 1000).toISOString();
  const view = render(ui());
  await fillQuote(view);
  expect(view.getByRole('button', { name: '確認送出訂單，到店付款' })).toBeDisabled();
  expect(view.getByText(/這次報價已過期/)).toBeTruthy();
  expect(writes()).toHaveLength(1);
});
test('unknown order write survives back and same-account revalidation with the exact key and payload', async () => {
  let failed = false;
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${realm}/orders` && input && !failed) {
      failed = true;
      throw new Error('response lost');
    }
    return respond(path, context, input);
  });
  const cache = new Map();
  const view = render(ui(cache));
  await fillQuote(view);
  fireEvent.press(view.getByRole('button', { name: '確認送出訂單，到店付款' }));
  await view.findByText(/尚未確認是否成功/);
  const sent = writes().at(-1)![2];
  fireEvent.press(view.getByRole('button', { name: '返回門市列表' }));
  fireEvent.press(await view.findByRole('button', { name: '選餐：餐坊' }));
  await view.findByRole('button', { name: '重試確認這次送出' });
  expect(view.getByLabelText('雞腿飯數量').props.editable).toBe(false);
  mockAuth.loading = true;
  view.rerender(ui(cache));
  mockAuth.loading = false;
  mockAuth.session = { ...mockAuth.session, context: 'context-b' };
  view.rerender(ui(cache));
  await waitFor(() =>
    expect(view.getByRole('button', { name: '重試確認這次送出' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('取餐號碼 A001');
  expect(writes().at(-1)![2]).toEqual(sent);
  expect(writes().at(-1)![1]).toBe('context-b');
});
test('paused storefront remains discoverable through own order realms and cancellation requires confirmation', async () => {
  paused = true;
  hasOrder = true;
  const view = render(ui());
  await openOrder(view);
  expect(view.getByText('等待現場付款')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '檢查取消訂單' }));
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '確認取消這張訂單' }));
  await view.findByText('已取消');
  expect(writes()[0][2]).toMatchObject({ reason: 'changed-mind' });
});
test('only a ready, authorized and unexpired pickup credential is displayed', async () => {
  hasOrder = true;
  state = 'ready';
  const view = render(ui());
  await openOrder(view);
  expect(view.getByLabelText('一次性取餐憑證')).toHaveTextContent(token);
  expiresAt = new Date(Date.now() - 1000).toISOString();
  fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
  await waitFor(() => expect(view.queryByLabelText('一次性取餐憑證')).toBeNull());
  expect(view.getByText(/取餐號碼不能代替憑證核銷/)).toBeTruthy();
});
test.each([
  [null, 'UNKNOWN'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'SESSION_CHANGED'],
  [400, 'INVALID_REQUEST'],
  [0, 'UNKNOWN'],
  [0, 'REQUEST_CANCELLED'],
  [503, 'SESSION_CHANGED'],
  [403, 'NETWORK_ERROR'],
])('訂單讀取失效 %s %s 後清除已展開的詳情', async (status, code) => {
  hasOrder = true;
  state = 'ready';
  const view = render(ui());
  await openOrder(view);
  fireEvent.press(view.getByRole('button', { name: '訂單編號' }));
  expect(view.getByText('訂單 order-one')).toBeTruthy();
  expect(view.getByText('取餐號碼 A001')).toBeTruthy();
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${realm}/orders/order-one`)
      throw status === null ? new Error(code) : new NuniError(status, code);
    return respond(path, context, input);
  });
  fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
  await view.findByText(/這次沒能更新狀態/);
  expect(view.queryByLabelText('一次性取餐憑證')).toBeNull();
  expect(view.queryByText('訂單 order-one')).toBeNull();
  expect(view.queryByText('取餐號碼 A001')).toBeNull();
  expect(view.queryByText(/應付總額/)).toBeNull();
  expect(view.queryByText(/雞腿飯/)).toBeNull();
  expect(view.queryByText('餐坊')).toBeNull();
  expect(view.queryByRole('button', { name: '訂單編號' })).toBeNull();
  expect(view.queryByText(/畫面保留上次讀到的資料/)).toBeNull();
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${realm}/orders/order-one`) throw new NuniError(0, 'NETWORK_ERROR');
    return respond(path, context, input);
  });
  fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
  await view.findByText(/這次沒能更新狀態/);
  expect(view.queryByText('取餐號碼 A001')).toBeNull();
});
test('merchant performs real confirmation steps from shift to cash, preparation, pickup and handover', async () => {
  const view = render(staffUi());
  fireEvent.changeText(await view.findByLabelText('起始現金（元）'), '1000');
  fireEvent.press(view.getByRole('button', { name: '檢查開班' }));
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  fireEvent.press(await view.findByRole('button', { name: '登記現場收款：A001' }));
  expect(view.getByText(/不會刷卡或扣款/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '我已實際收到款項，確認登記' }));
  fireEvent.press(await view.findByRole('button', { name: '接單：A001' }));
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  fireEvent.press(await view.findByRole('button', { name: '開始備餐：A001 熱食' }));
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  fireEvent.press(await view.findByRole('button', { name: '餐點備妥：A001 熱食' }));
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  fireEvent.changeText(await view.findByLabelText('取餐 A001 的一次性憑證'), token);
  fireEvent.press(view.getByRole('button', { name: '檢查取餐：A001' }));
  fireEvent.press(view.getByRole('button', { name: '確認交付餐點並核銷' }));
  await view.findByText('這一頁沒有待處理訂單。');
  expect(writes().at(-1)![2].pickupToken).toBe(token);
  fireEvent.changeText(view.getByLabelText('交班實點現金（元）'), '1180');
  fireEvent.press(view.getByRole('button', { name: '檢查交班' }));
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  await view.findByLabelText('起始現金（元）');
  expect(writes().at(-1)![2]).toMatchObject({ countedCashMinor: 1180, openNext: false });
  expect(writes()[0][2].openingCashMinor).toBe(1000);
});
test('merchant never treats pickup number as a fulfillment token', async () => {
  shiftOpen = true;
  state = 'ready';
  const view = render(staffUi());
  fireEvent.changeText(await view.findByLabelText('取餐 A001 的一次性憑證'), 'A001');
  fireEvent.press(view.getByRole('button', { name: '檢查取餐：A001' }));
  expect(view.getByRole('alert')).toHaveTextContent(/取餐號碼不能代替憑證/);
  expect(writes()).toHaveLength(0);
});
test('merchant unknown cash write is locked and retries the same intent after remount', async () => {
  shiftOpen = true;
  let fail = true;
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/counter-payment') && fail) {
      fail = false;
      throw new Error('lost');
    }
    return respond(path, context, input);
  });
  const cache = new Map();
  let view = render(staffUi(cache));
  fireEvent.press(await view.findByRole('button', { name: '登記現場收款：A001' }));
  fireEvent.press(view.getByRole('button', { name: '我已實際收到款項，確認登記' }));
  await view.findByText(/尚未確認是否成功/);
  const input = writes()[0][2];
  view.unmount();
  mockAuth.session.context = 'context-b';
  view = render(staffUi(cache));
  await waitFor(() =>
    expect(view.getByRole('button', { name: '重試確認上一筆操作' })).not.toBeDisabled(),
  );
  expect(view.getByRole('button', { name: '登記現場收款：A001' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '重試確認上一筆操作' }));
  await view.findByRole('button', { name: '接單：A001' });
  expect(writes()[1][2]).toEqual(input);
  expect(writes()[1][1]).toBe('context-b');
});
test('late receipt from an unmounted merchant screen cannot clear its unresolved intent', async () => {
  shiftOpen = true;
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : respond(path, context, input),
  );
  const cache = new Map();
  const view = render(staffUi(cache));
  fireEvent.press(await view.findByRole('button', { name: '登記現場收款：A001' }));
  fireEvent.press(view.getByRole('button', { name: '我已實際收到款項，確認登記' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  view.unmount();
  await act(async () =>
    finish({ orderId: 'order-one', state: 'paid', updatedAt: date(), replayed: false }),
  );
  expect(cache.get('merchant-food:school-one:location-one:intent')).toMatchObject({
    kind: 'counter',
  });
});

test('merchant QR scan only fills this order token, then requires explicit fulfillment', async () => {
  shiftOpen = true;
  state = 'ready';
  const view = render(staffUi());
  fireEvent.press(await view.findByRole('button', { name: '掃描取餐 QR：A001' }));
  fireEvent.press(view.getByRole('button', { name: '開啟相機掃描' }));
  await view.findByTestId('food-pickup-camera');
  await act(async () => mockScan!({ data: token }));
  expect(view.queryByTestId('food-pickup-camera')).toBeNull();
  expect(view.getByLabelText('取餐 A001 的一次性憑證').props.value).toBe(token);
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '檢查取餐：A001' }));
  expect(writes()).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '確認交付餐點並核銷' }));
  await view.findByText('這一頁沒有待處理訂單。');
  expect(writes()[0][2].pickupToken).toBe(token);
});
test('invalid QR does not fill a token or write; cancelling removes the scanner', async () => {
  shiftOpen = true;
  state = 'ready';
  const view = render(staffUi());
  fireEvent.press(await view.findByRole('button', { name: '掃描取餐 QR：A001' }));
  fireEvent.press(view.getByRole('button', { name: '開啟相機掃描' }));
  await view.findByTestId('food-pickup-camera');
  await act(async () => mockScan!({ data: 'https://example.com/evil' }));
  expect(view.queryByTestId('food-pickup-camera')).toBeNull();
  expect(view.getByRole('alert')).toHaveTextContent(/不是有效的取餐憑證/);
  fireEvent.press(view.getByRole('button', { name: '取消掃描' }));
  expect(view.getByLabelText('取餐 A001 的一次性憑證').props.value).toBe('');
  expect(writes()).toHaveLength(0);
});
test('denied camera permission does not mount camera or submit', async () => {
  shiftOpen = true;
  state = 'ready';
  mockCameraGranted = false;
  const view = render(staffUi());
  fireEvent.press(await view.findByRole('button', { name: '掃描取餐 QR：A001' }));
  fireEvent.press(view.getByRole('button', { name: '開啟相機掃描' }));
  await view.findByText(/尚未取得相機權限/);
  expect(mockPermission).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('food-pickup-camera')).toBeNull();
  expect(writes()).toHaveLength(0);
});
test('late permission resolution after cancellation cannot start camera', async () => {
  shiftOpen = true;
  state = 'ready';
  mockCameraGranted = false;
  let grant!: (value: { granted: boolean }) => void;
  mockPermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const view = render(staffUi());
  fireEvent.press(await view.findByRole('button', { name: '掃描取餐 QR：A001' }));
  fireEvent.press(view.getByRole('button', { name: '開啟相機掃描' }));
  fireEvent.press(view.getByRole('button', { name: '取消掃描' }));
  await act(async () => grant({ granted: true }));
  expect(view.queryByTestId('food-pickup-camera')).toBeNull();
  expect(writes()).toHaveLength(0);
});
test('another location never inherits the first locations cash or unresolved intent', async () => {
  shiftOpen = true;
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/counter-payment')) throw new Error('lost');
    if (path === 'merchant-workspaces/school-one/location-two/orders') return { orders: [] };
    if (path === 'merchant-workspaces/school-one/location-two/shift')
      throw new NuniError(404, 'FOOD_SHIFT_NOT_FOUND');
    return respond(path, context, input);
  });
  const cache = new Map();
  const view = render(staffUi(cache));
  fireEvent.press(await view.findByRole('button', { name: '登記現場收款：A001' }));
  fireEvent.press(view.getByRole('button', { name: '我已實際收到款項，確認登記' }));
  await view.findByText(/尚未確認是否成功/);
  view.rerender(staffUi(cache, 'location-two'));
  expect((await view.findByLabelText('起始現金（元）')).props.value).toBe('');
  expect(view.queryByRole('button', { name: '重試確認上一筆操作' })).toBeNull();
  expect(writes()).toHaveLength(1);
});
test('kitchen-only permissions do not expose cash actions or open a shift', async () => {
  state = 'accepted';
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${merchant}/shift`) throw new NuniError(403, 'FOOD_STAFF_FORBIDDEN');
    if (path === `${merchant}/orders`) {
      const { total, ...order } = staffOrder();
      expect(total).toEqual(price(180));
      return {
        orders: [
          {
            ...order,
            lines: order.lines.map(({ menuItemId, nameSnapshot, quantity, selectedOptions }) => ({
              menuItemId,
              nameSnapshot,
              quantity,
              selectedOptions: selectedOptions.map(({ optionId, nameSnapshot }) => ({
                optionId,
                nameSnapshot,
              })),
            })),
            viewerScope: 'kitchen',
          },
        ],
      };
    }
    return respond(path, context, input);
  });
  const view = render(staffUi());
  await view.findByRole('button', { name: '開始備餐：A001 熱食' });
  expect(view.queryByLabelText('起始現金（元）')).toBeNull();
  expect(view.queryByText('總額 180 元')).toBeNull();
  expect(view.queryByRole('button', { name: '登記現場收款：A001' })).toBeNull();
});

test.each(['blur', 'background'])(
  'camera stops on %s and ignores its late scan callback',
  async (event) => {
    shiftOpen = true;
    state = 'ready';
    let blur!: () => void;
    let change!: (state: string) => void;
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        change = listener;
        return { remove: jest.fn() };
      });
    const navigation = {
      addListener: (_event: string, listener: () => void) => {
        blur = listener;
        return jest.fn();
      },
      isFocused: () => true,
    };
    const view = render(
      <NavigationContext.Provider value={navigation as any}>
        {staffUi()}
      </NavigationContext.Provider>,
    );
    fireEvent.press(await view.findByRole('button', { name: '掃描取餐 QR：A001' }));
    fireEvent.press(view.getByRole('button', { name: '開啟相機掃描' }));
    await view.findByTestId('food-pickup-camera');
    const lateScan = mockScan!;
    await act(async () => {
      if (event === 'blur') blur();
      else change('background');
    });
    expect(view.queryByTestId('food-pickup-camera')).toBeNull();
    await act(async () => lateScan({ data: token }));
    expect(view.getByLabelText('取餐 A001 的一次性憑證').props.value).toBe('');
    expect(writes()).toHaveLength(0);
    subscription.mockRestore();
  },
);

test('canceled paid order requires actual refund confirmation and preserves unknown refund retry', async () => {
  shiftOpen = true;
  state = 'cancellation-pending-refund';
  let first = true;
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${merchant}/orders`)
      return {
        orders:
          state === 'canceled'
            ? []
            : [{ ...staffOrder(), allowedActions: ['confirm-counter-refund'] }],
      };
    if (path.endsWith('/confirm-counter-refund') && first) {
      first = false;
      throw new Error('lost');
    }
    return respond(path, context, input);
  });
  const cache = new Map();
  let view = render(staffUi(cache));
  fireEvent.press(await view.findByRole('button', { name: '登記現場退款：A001' }));
  expect(writes()).toHaveLength(0);
  expect(view.getByText(/不會自動匯款或刷退/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '我已實際退還款項，確認登記' }));
  await view.findByText(/尚未確認是否成功/);
  const original = writes()[0][2];
  view.unmount();
  view = render(staffUi(cache));
  await waitFor(() =>
    expect(view.getByRole('button', { name: '重試確認上一筆操作' })).not.toBeDisabled(),
  );
  expect(view.getByRole('button', { name: '登記現場退款：A001' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '重試確認上一筆操作' }));
  await view.findByText('這一頁沒有待處理訂單。');
  expect(writes()[1][2]).toEqual(original);
});

test.each([
  ['paid', 'reject', '檢查拒單：A001'],
  ['accepted', 'cancel-accepted', '檢查取消已接訂單：A001'],
])(
  'staff %s uses the server action and an explicitly confirmed reason',
  async (initial, action, label) => {
    shiftOpen = true;
    state = initial;
    mockRequest.mockImplementation(async (path, context, input) => {
      if (path === `${merchant}/orders`)
        return {
          orders: [
            {
              ...staffOrder(),
              allowedActions: state === initial ? [action] : ['confirm-counter-refund'],
            },
          ],
        };
      return respond(path, context, input);
    });
    const view = render(staffUi());
    fireEvent.press(await view.findByRole('button', { name: '其他原因：A001' }));
    fireEvent.press(view.getByRole('button', { name: label }));
    expect(view.getByRole('alert')).toHaveTextContent(/至少填寫 3 個字/);
    expect(writes()).toHaveLength(0);
    fireEvent.changeText(view.getByLabelText('訂單 A001 原因補充（其他原因必填）'), '停電無法供餐');
    fireEvent.press(view.getByRole('button', { name: label }));
    expect(writes()).toHaveLength(0);
    fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
    await view.findByRole('button', { name: '登記現場退款：A001' });
    expect(writes()[0][0]).toBe(`${merchant}/orders/order-one/${action}`);
    expect(writes()[0][2]).toMatchObject({ reason: 'other', reasonDetail: '停電無法供餐' });
  },
);

test('order number is hidden by default and resets after returning to the accessible order list', async () => {
  hasOrder = true;
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '訂單紀錄：第一校區' }));
  const button = await view.findByRole('button', { name: '查看訂單 order-one' });
  expect(button).toHaveTextContent('查看訂單');
  expect(view.queryByText('查看訂單 order-one')).toBeNull();
  fireEvent.press(button);
  await view.findByText('取餐號碼 A001');
  expect(view.queryByText('訂單 order-one')).toBeNull();
  expect(view.getByRole('button', { name: '訂單編號' }).props.accessibilityState.expanded).toBe(
    false,
  );
  fireEvent.press(view.getByRole('button', { name: '訂單編號' }));
  expect(view.getByText('訂單 order-one')).toBeTruthy();
  expect(view.getByRole('button', { name: '收起訂單編號' }).props.accessibilityState.expanded).toBe(
    true,
  );
  fireEvent.press(view.getByRole('button', { name: '返回訂單紀錄' }));
  fireEvent.press(await view.findByRole('button', { name: '查看訂單 order-one' }));
  await view.findByText('取餐號碼 A001');
  expect(view.queryByText('訂單 order-one')).toBeNull();
  expect(view.getByRole('button', { name: '訂單編號' }).props.accessibilityState.expanded).toBe(
    false,
  );
});

test('cold start restores the same food idempotency key from SecureStore at the original store', async () => {
  const scope = 'food:school-one:location-one:intent';
  await saveFoodPending('pa-a', scope, {
    kind: 'order',
    input: { quoteId: 'quote-one', idempotencyKey: 'food-mobile-cold-key' },
  });
  const view = render(ui(new Map()));
  fireEvent.press(await view.findByRole('button', { name: '查看餐點：第一校區' }));
  fireEvent.press(await view.findByRole('button', { name: '選餐：餐坊' }));
  await waitFor(() =>
    expect(view.getByRole('button', { name: '重試確認這次送出' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('取餐號碼 A001');
  expect(writes().at(-1)![2]).toEqual({
    quoteId: 'quote-one',
    idempotencyKey: 'food-mobile-cold-key',
  });
  expect(await loadFoodPending('pa-a', scope)).toBeNull();
});

test('storage failure blocks the network mutation and cross-account pending stays isolated', async () => {
  await saveFoodPending('pa-b', 'food:school-one:location-one:intent', {
    kind: 'order',
    input: { quoteId: 'quote-other', idempotencyKey: 'food-other-account' },
  });
  const view = render(ui(new Map()));
  await fillQuote(view);
  const spy = jest
    .spyOn(SecureStore, 'setItemAsync')
    .mockRejectedValue(new Error('secure unavailable'));
  try {
    fireEvent.press(view.getByRole('button', { name: '確認送出訂單，到店付款' }));
    await view.findByText(/目前無法安全保存/);
    expect(writes().some((call) => call[0].endsWith('/orders') && call[2]?.quoteId)).toBe(false);
  } finally {
    spy.mockRestore();
  }
  expect(await loadFoodPending('pa-b', 'food:school-one:location-one:intent')).toMatchObject({
    input: { idempotencyKey: 'food-other-account' },
  });
});

test('order detail skips background polls, keeps cancel confirm on quiet refresh, then shows ready QR and revokes it when fulfilled', async () => {
  jest.useFakeTimers({ advanceTimers: true });
  hasOrder = true;
  state = 'payment-pending';
  let appListener: ((state: string) => void) | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      appListener = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const view = render(ui());
  await openOrder(view);
  const dataTime = view.getByText(/最後更新時間/).props.children;
  fireEvent.press(view.getByRole('button', { name: '檢查取消訂單' }));
  expect(view.getByRole('button', { name: '確認取消這張訂單' })).toBeTruthy();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  appListener?.('background');
  const before = mockRequest.mock.calls.filter((call) =>
    call[0].endsWith('/orders/order-one'),
  ).length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(
    mockRequest.mock.calls.filter((call) => call[0].endsWith('/orders/order-one')).length,
  ).toBe(before);
  expect(view.getByText(dataTime)).toBeTruthy();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  await act(async () => {
    appListener?.('active');
  });
  await waitFor(() => expect(view.getByRole('button', { name: '確認取消這張訂單' })).toBeTruthy());
  expect(view.getByText(/最後更新時間.*訂單資料時間/)).toBeTruthy();
  state = 'ready';
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  await view.findByLabelText('一次性取餐憑證');
  state = 'fulfilled';
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  await waitFor(() => expect(view.queryByLabelText('一次性取餐憑證')).toBeNull());
  expect(view.getByText('已取餐')).toBeTruthy();
  subscription.mockRestore();
  jest.useRealTimers();
});

test.each([
  ['payment-pending', 'awaiting-offline-payment', '請到櫃檯向店員完成付款'],
  ['payment-pending', 'authorized-awaiting-settlement', '付款確認中'],
  ['cancellation-pending-refund', 'refunding', '退款處理中'],
  ['ready', undefined, '餐點好了。請到店出示取餐憑證。'],
])('訂單 %s／%s 顯示下一步與來源時間', async (nextState, progress, copy) => {
  hasOrder = true;
  state = nextState;
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path === `${realm}/orders/order-one`)
      return {
        ...detail(),
        updatedAt: '2026-10-31T04:15:00.000Z',
        ...(progress
          ? {
              paymentSession: {
                id: 'session-one',
                orderId: 'order-one',
                method: 'credit-card',
                checkoutUrl: 'https://example.com/checkout',
                progress,
                allowedActions: [],
                expiresAt: future(),
              },
            }
          : {}),
      };
    return respond(path, context, input);
  });
  const view = render(ui());
  await openOrder(view);
  expect(view.getByText(new RegExp(`現在該做什麼：.*${copy}`))).toBeTruthy();
  expect(view.getByText(/最後更新時間.*10\/31.*12:15.*訂單資料時間/)).toBeTruthy();
  if (nextState !== 'ready') expect(view.queryByText(/餐點好了/)).toBeNull();
});

test.each([0, 408, 429, 503, 'timeout'])(
  '暫時失敗 %s 保留訂單，成功才顯示正常下一步',
  async (status) => {
    hasOrder = true;
    state = 'ready';
    const view = render(ui());
    await openOrder(view);
    const timestamp = view.getByText(/最後更新時間/).props.children;
    mockRequest.mockImplementation(async (path, context, input) => {
      if (path === `${realm}/orders/order-one`)
        throw status === 'timeout'
          ? Object.assign(new Error('逾時'), { name: 'TimeoutError' })
          : new NuniError(status as number, status === 0 ? 'NETWORK_ERROR' : 'TEMPORARY');
      return respond(path, context, input);
    });
    fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
    await view.findByText(/這次沒能更新狀態/);
    expect(view.getByText('現在該做什麼：請先更新訂單，再確認付款或取餐')).toBeTruthy();
    expect(view.queryByText(/請到店出示取餐憑證/)).toBeNull();
    expect(view.getByText('取餐號碼 A001')).toBeTruthy();
    expect(view.getByText(timestamp)).toBeTruthy();
    expect(view.getByText('餐坊')).toBeTruthy();
    expect(view.getByText(/雞腿飯/)).toBeTruthy();
    expect(view.getByText(/應付總額/)).toBeTruthy();
    expect(view.queryByRole('button', { name: '檢查取消訂單' })).toBeNull();
    expect(view.queryByLabelText('一次性取餐憑證')).toBeNull();
    state = 'fulfilled';
    mockRequest.mockImplementation(respond);
    fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
    await view.findByText('現在該做什麼：這筆訂單已取餐完成。');
    expect(view.queryByText(/這次沒能更新狀態/)).toBeNull();
  },
);

test.each(['ready', 'payment-pending'] as const)(
  '更新中 %s 優先提示更新，成功後恢復下一步',
  async (nextState) => {
    hasOrder = true;
    state = nextState;
    const view = render(ui());
    await openOrder(view);
    const guidance = view.getByText(/現在該做什麼：/).props.children;
    let finish!: (value: unknown) => void;
    mockRequest.mockImplementation((path, context, input) => {
      if (path === `${realm}/orders/order-one`)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return respond(path, context, input);
    });
    fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
    await view.findByText('正在更新訂單…');
    expect(view.getByText('現在該做什麼：請先更新訂單，再確認付款或取餐')).toBeTruthy();
    expect(view.queryByText(guidance)).toBeNull();
    expect(view.queryByLabelText('一次性取餐憑證')).toBeNull();
    await act(async () => {
      finish(await respond(`${realm}/orders/order-one`));
    });
    await view.findByText(guidance);
  },
);

test.each([
  ['ready', 'quiet'],
  ['payment-pending', 'quiet'],
  ['ready', 'manual'],
  ['payment-pending', 'manual'],
])('%s 訂單以 %s 更新斷線保留詳情，撤權後不復活', async (nextState, mode) => {
  jest.useFakeTimers({ advanceTimers: true });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  try {
    hasOrder = true;
    state = nextState;
    const view = render(ui());
    await openOrder(view);
    const timestamp = view.getByText(/最後更新時間/).props.children;
    const amount = view.getByText(/應付總額/).props.children;
    let failure = new NuniError(0, 'NETWORK_ERROR');
    mockRequest.mockImplementation(async (path, context, input) => {
      if (path === `${realm}/orders/order-one`) throw failure;
      return respond(path, context, input);
    });
    const refresh = async () => {
      if (mode === 'manual') {
        await act(async () => {
          fireEvent.press(view.getByRole('button', { name: '更新狀態' }));
        });
        await view.findByText(/這次沒能更新狀態/);
      } else {
        await act(async () => {
          await jest.advanceTimersByTimeAsync(10_000);
        });
      }
    };
    await refresh();
    expect(view.getByText(/這次沒能更新狀態/)).toBeTruthy();
    expect(view.getByText('餐坊')).toBeTruthy();
    expect(view.getByText(/雞腿飯/)).toBeTruthy();
    expect(view.getByText(amount)).toBeTruthy();
    expect(view.getByText('取餐號碼 A001')).toBeTruthy();
    expect(view.getByText(timestamp)).toBeTruthy();
    expect(view.queryByLabelText('一次性取餐憑證')).toBeNull();
    expect(view.queryByRole('button', { name: '檢查取消訂單' })).toBeNull();
    failure = new NuniError(403, 'FORBIDDEN');
    await refresh();
    failure = new NuniError(0, 'NETWORK_ERROR');
    await refresh();
    expect(view.queryByText('餐坊')).toBeNull();
    expect(view.queryByText(/雞腿飯/)).toBeNull();
    expect(view.queryByText(/應付總額/)).toBeNull();
    expect(view.queryByText('取餐號碼 A001')).toBeNull();
    expect(view.queryByText(timestamp)).toBeNull();
    expect(view.queryByLabelText('一次性取餐憑證')).toBeNull();
    expect(view.queryByRole('button', { name: '檢查取消訂單' })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
