import React from 'react';
import { act, render } from '@testing-library/react-native';

type Listener = { input: Record<string, unknown>; onOrders: (orders: unknown[]) => void; closed: boolean };
const listeners: Listener[] = [];
jest.mock('../services/merchant', () => ({
  watchMerchantOrders: (input: Record<string, unknown>, onOrders: (orders: unknown[]) => void) => {
    const listener = { input, onOrders, closed: false };
    listeners.push(listener);
    return () => {
      listener.closed = true;
    };
  },
  giveMerchantQueueNumber: jest.fn(),
  updateMerchantOrderStatus: jest.fn(),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'shop-a' },
    profile: {
      role: 'vendor',
      displayName: '店員',
      merchantAssignments: [
        { status: 'active', schoolId: 'pu', cafeteriaId: 'cafe', cafeteriaName: '校園餐廳', orderingEnabled: true },
      ],
    },
  }),
}));
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: () => false,
  isDemoUid: () => false,
}));
jest.mock('../services/demoMerchantOrders', () => ({
  listDemoMerchantOrders: jest.fn(() => []),
  updateDemoOrderStatus: jest.fn(),
  subscribeDemoOrders: jest.fn(() => () => undefined),
}));
jest.mock('../services/demoStore', () => ({ updateOrderStatus: jest.fn() }));
jest.mock('../services/shopCatalog', () => ({
  createShopPost: jest.fn(),
  deleteShopMenuItem: jest.fn(),
  loadShopHours: jest.fn(async () => ({})),
  loadShopMenu: jest.fn(async () => []),
  loadShopStorefront: jest.fn(async () => ({
    openingHours: '',
    intro: '',
    location: '',
    websiteUrl: '',
    orderingUrl: '',
    merchantMode: 'info_only',
  })),
  saveShopHours: jest.fn(),
  saveShopMenuItem: jest.fn(),
  saveShopStorefront: jest.fn(),
}));
jest.mock('../services/companionEngine', () => ({ recordCompanionFeatureSignal: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import ShopDockScreen from '../screens/ShopDockScreen';
import { MerchantHubScreen } from '../screens/MerchantHubScreen';
import { countOrdersByView, merchantTabLabel } from '../features/merchantOrderViews';
import type { Order } from '../data/types';

const order = (id: string, extra: Partial<Order> = {}): Order =>
  ({
    id,
    userId: 'alice',
    schoolId: 'pu',
    cafeteriaId: 'cafe',
    items: [{ menuItemId: 'rice', name: '雞腿飯', price: 95, quantity: 1 }],
    total: 95,
    status: 'pending',
    paymentStatus: 'pending',
    createdAt: '2026-10-13T04:05:00.000Z',
    ...extra,
  }) as Order;

const open = () => listeners.filter((l) => !l.closed);
const push = (orders: Order[]) => act(() => open().forEach((l) => l.onOrders(orders)));

beforeEach(() => {
  listeners.length = 0;
});

test('分頁數字：「待接單 3」「出餐 2」，已完成／取消的不算', () => {
  const counts = countOrdersByView([
    order('a'),
    order('b'),
    order('c', { queueNumber: '4' }),
    order('d', { status: 'confirmed' }),
    order('e', { status: 'ready' }),
    order('f', { status: 'completed' }),
    order('g', { status: 'cancelled' }),
  ]);
  expect(counts).toEqual({ pending: 3, kitchen: 2 });
  expect(merchantTabLabel('pending', 3)).toBe('待接單 3');
  expect(merchantTabLabel('kitchen', 2)).toBe('出餐 2');
  expect(merchantTabLabel('pending', null)).toBe('待接單');
});

test('店家工作台：只監聽自己這家店，新單進來不用下拉就出現，分頁數字跟著變', async () => {
  const view = render(<ShopDockScreen />);
  await act(async () => {});
  expect(open().length).toBeGreaterThan(0);
  for (const l of open()) {
    expect(l.input).toMatchObject({ schoolId: 'pu', cafeteriaId: 'cafe' });
    expect(l.input.includeClosed).toBe(false);
  }

  await push([order('co_first_aaa111'), order('co_cook_bbb222', { status: 'preparing', queueNumber: '1' })]);
  expect(view.getByText('待接單 1')).toBeTruthy();
  expect(view.getByText('出餐 1')).toBeTruthy();
  expect(view.getByText(/AAA111/)).toBeTruthy();

  // 學生又下了一張：伺服器推過來，畫面直接多一張，沒有任何下拉／重新讀取
  await push([
    order('co_new_ccc333', { createdAt: '2026-10-13T04:10:00.000Z' }),
    order('co_first_aaa111'),
    order('co_cook_bbb222', { status: 'preparing', queueNumber: '1' }),
  ]);
  expect(view.getByText('待接單 2')).toBeTruthy();
  expect(view.getByText(/CCC333/)).toBeTruthy();
  expect(view.queryByText(/BBB222/)).toBeNull();

  // 別的裝置按了接單：單從待接單移到出餐
  await push([
    order('co_new_ccc333', { status: 'confirmed', queueNumber: '2', createdAt: '2026-10-13T04:10:00.000Z' }),
    order('co_first_aaa111'),
    order('co_cook_bbb222', { status: 'preparing', queueNumber: '1' }),
  ]);
  expect(view.getByText('待接單 1')).toBeTruthy();
  expect(view.getByText('出餐 2')).toBeTruthy();
  expect(view.queryByText(/CCC333/)).toBeNull();

  view.unmount();
  expect(listeners.length).toBeGreaterThan(0);
  expect(open()).toHaveLength(0);
});

test('離開畫面就把監聽關掉', async () => {
  const view = render(<MerchantHubScreen view="kitchen" />);
  await act(async () => {});
  expect(open()).toHaveLength(1);
  expect(open()[0].input).toMatchObject({ schoolId: 'pu', cafeteriaId: 'cafe', includeClosed: false });
  view.unmount();
  expect(open()).toHaveLength(0);
});
