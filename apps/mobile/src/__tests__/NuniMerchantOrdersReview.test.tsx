import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  NuniFoodShiftProjection,
  NuniFoodStaffOrderQueueItem,
} from '@campus/shared/src/nuniFood';
import { NuniMerchantOrders } from '../screens/nuni/NuniMerchantOrders';
import { NuniDraftProvider } from '../state/nuniDrafts';

const mockRequest = jest.fn();
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: { platformAccountId: 'account-a', context: 'context-a' },
    request: mockRequest,
    refresh: jest.fn(),
  }),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../screens/nuni/NuniPickupScanner', () => ({ NuniPickupScanner: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('../state/foodPersistence', () => ({
  FoodStorageError: class FoodStorageError extends Error {},
  FOOD_POLL_MS: 10_000,
  FOOD_TERMINAL_STATES: new Set(['fulfilled', 'canceled', 'rejected', 'payment-expired']),
  loadFoodPending: jest.fn(async () => null),
  saveFoodPending: jest.fn(async () => undefined),
  clearFoodPending: jest.fn(async () => undefined),
}));

const merchant = 'merchant-workspaces/school-one/location-one';
const money = (amountMinor: number) => ({ amountMinor, currency: 'TWD' as const });
const now = () => new Date().toISOString();
let shift: NuniFoodShiftProjection | null;
let orders: NuniFoodStaffOrderQueueItem[];
let foreground!: (state: string) => void;

function order(): NuniFoodStaffOrderQueueItem {
  return {
    id: 'order-one',
    locationId: 'location-one',
    viewerScope: 'cash-register',
    state: 'accepted',
    requestedPickupAt: now(),
    pickupDisplayCode: 'A001',
    lines: [
      {
        menuItemId: 'rice',
        nameSnapshot: '雞腿飯',
        quantity: 1,
        selectedOptions: [],
        unitPrice: money(90),
        lineTotal: money(90),
      },
    ],
    total: money(90),
    allowedActions: [],
    kitchenTickets: [
      {
        id: 'ticket-one',
        station: 'hot',
        state: 'queued',
        allowedActions: ['start-preparation'],
      },
    ],
  };
}

async function respond(path: string, _context: string, input?: unknown) {
  if (path === `${merchant}/orders`) return { orders };
  if (path === `${merchant}/shift` && !input) {
    if (!shift) throw new NuniError(404, 'FOOD_SHIFT_NOT_FOUND');
    return shift;
  }
  throw new Error(`Unexpected write ${path}`);
}

beforeEach(() => {
  mockRequest.mockReset().mockImplementation(respond);
  orders = [order()];
  shift = {
    id: 'shift-one',
    locationId: 'location-one',
    state: 'open',
    openedAt: now(),
    openingCash: money(1000),
    campusLedgerTotal: money(0),
    allowedActions: ['handover', 'view'],
  };
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());

function mount(cache = new Map<string, unknown>()) {
  return render(
    <NuniDraftProvider cache={cache}>
      <NuniMerchantOrders
        context="context-a"
        tenantId="school-one"
        locationId="location-one"
        onBack={jest.fn()}
      />
    </NuniDraftProvider>,
  );
}
async function refresh() {
  await act(async () => foreground('active'));
}

test.each(['advanced', 'replaced', 'revoked'])(
  'a %s kitchen ticket removes only the unsent preparation confirmation',
  async (change) => {
    const view = mount();
    const start = await view.findByRole('button', { name: '開始備餐：A001 熱食' });
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.press(start);
    expect(view.getByRole('button', { name: '確認執行這次操作' })).toBeTruthy();
    orders = [
      {
        ...order(),
        kitchenTickets: [
          {
            id: change === 'replaced' ? 'ticket-two' : 'ticket-one',
            station: 'hot',
            state: change === 'advanced' ? 'preparing' : 'queued',
            allowedActions:
              change === 'replaced'
                ? ['start-preparation']
                : change === 'advanced'
                  ? ['mark-ready']
                  : [],
          },
        ],
      },
    ];
    await refresh();
    await waitFor(() =>
      expect(view.queryByRole('button', { name: '確認執行這次操作' })).toBeNull(),
    );
    expect(mockRequest.mock.calls.some(([, , input]) => input !== undefined)).toBe(false);
  },
);

test('a completed preparation ticket removes its unsent ready confirmation', async () => {
  orders = [
    {
      ...order(),
      state: 'preparing',
      kitchenTickets: [
        {
          id: 'ticket-one',
          station: 'hot',
          state: 'preparing',
          allowedActions: ['mark-ready'],
        },
      ],
    },
  ];
  const view = mount();
  const ready = await view.findByRole('button', { name: '餐點備妥：A001 熱食' });
  await waitFor(() => expect(ready).not.toBeDisabled());
  fireEvent.press(ready);
  orders = [
    {
      ...order(),
      state: 'ready',
      kitchenTickets: [
        {
          id: 'ticket-one',
          station: 'hot',
          state: 'ready',
          allowedActions: [],
        },
      ],
    },
  ];
  await refresh();
  await waitFor(() => expect(view.queryByRole('button', { name: '確認執行這次操作' })).toBeNull());
});

test.each(['replaced', 'restricted'])(
  'a %s shift requires a new handover confirmation while keeping counted cash',
  async (change) => {
    const view = mount();
    const cash = await view.findByLabelText('交班實點現金（元）');
    await waitFor(() => expect(view.getByRole('button', { name: '檢查交班' })).not.toBeDisabled());
    fireEvent.changeText(cash, '1180');
    fireEvent.press(view.getByRole('button', { name: '檢查交班' }));
    expect(view.getByRole('button', { name: '確認執行這次操作' })).toBeTruthy();
    shift = {
      ...shift!,
      ...(change === 'replaced' ? { id: 'shift-two' } : { allowedActions: ['view'] }),
    };
    await refresh();
    await waitFor(() =>
      expect(view.queryByRole('button', { name: '確認執行這次操作' })).toBeNull(),
    );
    shift = { ...shift!, allowedActions: ['handover', 'view'] };
    await refresh();
    expect(view.getByLabelText('交班實點現金（元）').props.value).toBe('1180');
    expect(view.queryByRole('button', { name: '確認執行這次操作' })).toBeNull();
    expect(mockRequest.mock.calls.some(([, , input]) => input !== undefined)).toBe(false);
  },
);

test('another employee opening a shift revokes the unsent open-shift review', async () => {
  const opened = shift;
  shift = null;
  const view = mount();
  const cash = await view.findByLabelText('起始現金（元）');
  await waitFor(() => expect(view.getByRole('button', { name: '檢查開班' })).not.toBeDisabled());
  fireEvent.changeText(cash, '1000');
  fireEvent.press(view.getByRole('button', { name: '檢查開班' }));
  shift = opened;
  await refresh();
  await waitFor(() => expect(view.queryByRole('button', { name: '確認執行這次操作' })).toBeNull());
  expect(view.getByLabelText('交班實點現金（元）').props.value).toBe('1000');
});

test('newer shift data does not discard an already submitted uncertain handover', async () => {
  const cache = new Map<string, unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/shift/handover')
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  const view = mount(cache);
  const cash = await view.findByLabelText('交班實點現金（元）');
  await waitFor(() => expect(view.getByRole('button', { name: '檢查交班' })).not.toBeDisabled());
  fireEvent.changeText(cash, '1180');
  fireEvent.press(view.getByRole('button', { name: '檢查交班' }));
  fireEvent.press(view.getByRole('button', { name: '確認執行這次操作' }));
  await view.findByText('尚未確認是否成功，請用下方按鈕重試。');
  const original = cache.get('merchant-food:school-one:location-one:intent');
  expect(original).toMatchObject({ kind: 'handover', shiftId: 'shift-one', cash: 1180 });
  shift = { ...shift!, id: 'shift-two' };
  await refresh();
  expect(cache.get('merchant-food:school-one:location-one:intent')).toEqual(original);
  expect(view.getByRole('button', { name: '重試確認上一筆操作' })).toBeTruthy();
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/shift/handover'))).toHaveLength(
    1,
  );
});
