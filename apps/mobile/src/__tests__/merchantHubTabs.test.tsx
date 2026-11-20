import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockList = jest.fn();
const mockGive = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../services/merchant', () => ({
  // 每次接上監聽就讀一次伺服器的資料（按完按鈕會重新接一次）
  watchMerchantOrders: (input: unknown, onOrders: (orders: unknown[]) => void) => {
    let live = true;
    void Promise.resolve(mockList(input)).then((orders) => {
      if (live) onOrders(orders as unknown[]);
    });
    return () => {
      live = false;
    };
  },
  giveMerchantQueueNumber: (...args: unknown[]) => mockGive(...args),
  updateMerchantOrderStatus: (...args: unknown[]) => mockUpdate(...args),
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
jest.mock('../services/companionEngine', () => ({ recordCompanionFeatureSignal: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { MerchantHubScreen, ordersForView } from '../screens/MerchantHubScreen';
import type { Order } from '../data/types';

const order = (id: string, extra: Partial<Order> = {}): Order =>
  ({
    id,
    userId: 'alice',
    schoolId: 'pu',
    cafeteriaId: 'cafe',
    cafeteria: '校園餐廳',
    items: [{ menuItemId: 'rice', name: '雞腿飯', price: 95, quantity: 1 }],
    total: 100,
    totalAmount: 100,
    paymentMethod: 'onsite',
    status: 'pending',
    queueNumber: null,
    createdAt: '2026-10-13T04:05:00.000Z',
    ...extra,
  }) as Order;

let server: Order[];
beforeEach(() => {
  jest.clearAllMocks();
  server = [
    order('co_waiting_aaa111'),
    order('co_numbered_bbb222', { queueNumber: 3 }),
    order('co_cooking_ccc333', { status: 'preparing', queueNumber: 1 }),
    order('co_ready_ddd444', { status: 'ready', queueNumber: 2 }),
    order('co_done_eee555', { status: 'completed', queueNumber: 9 }),
    order('co_gone_fff666', { status: 'cancelled', queueNumber: 8 }),
  ];
  mockList.mockImplementation(async () => server.map((o) => ({ ...o })));
});

test('分頁：待接單只列還沒接的單，出餐只列接了還沒取的，沒有一張同時在兩邊', () => {
  const pending = ordersForView(server, 'pending').map((o) => o.id);
  const kitchen = ordersForView(server, 'kitchen').map((o) => o.id);
  expect(pending).toEqual(['co_waiting_aaa111', 'co_numbered_bbb222']);
  expect(kitchen).toEqual(['co_cooking_ccc333', 'co_ready_ddd444']);
  expect(pending.filter((id) => kitchen.includes(id))).toEqual([]);
  for (const status of ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as const) {
    const one = [order('x', { status })];
    expect(ordersForView(one, 'pending').length + ordersForView(one, 'kitchen').length).toBeLessThanOrEqual(1);
  }
});

test('待給號碼的單：「給號碼並接單」和「拒單」兩個按鈕，同一個短代碼', async () => {
  const view = render(<MerchantHubScreen view="pending" />);
  await act(async () => {});
  expect(view.getByText('取餐號碼：待給號碼・下單 10 月 13 日（二）12:05')).toBeTruthy();
  expect(view.getByText(/訂單末 6 碼 AAA111/)).toBeTruthy();
  expect(view.getAllByText('給號碼並接單')).toHaveLength(1);
  expect(view.getAllByText('拒單')).toHaveLength(2);
  expect(view.getByText('確認接單')).toBeTruthy();
  expect(view.queryByText(/待確認/)).toBeNull();
  expect(view.queryByText(/co_cooking|CCC333|DDD444/)).toBeNull();
});

test('按「給號碼並接單」：單從待接單移到出餐，不會兩邊都有', async () => {
  mockGive.mockImplementation(async ({ orderId }: { orderId: string }) => {
    server = server.map((o) => (o.id === orderId ? { ...o, status: 'confirmed', queueNumber: 4 } : o));
    return { queueNumber: 4, status: 'confirmed' };
  });
  const pendingView = render(<MerchantHubScreen view="pending" />);
  await act(async () => {});
  await act(async () => fireEvent.press(pendingView.getByText('給號碼並接單')));
  expect(mockGive).toHaveBeenCalledWith({ schoolId: 'pu', orderId: 'co_waiting_aaa111', cafeteriaId: 'cafe' });
  expect(pendingView.queryByText(/AAA111/)).toBeNull();
  pendingView.unmount();
  const kitchenView = render(<MerchantHubScreen view="kitchen" />);
  await act(async () => {});
  expect(kitchenView.getByText(/AAA111/)).toBeTruthy();
  expect(kitchenView.getByText('取餐號碼 4')).toBeTruthy();
  expect(kitchenView.queryByText('拒單')).toBeNull();
  expect(kitchenView.queryByText(/BBB222/)).toBeNull();
});

test('給號碼失敗也能拒單：走原本的取消訂單', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockGive.mockRejectedValue(new Error('internal'));
  mockUpdate.mockImplementation(async ({ orderId }: { orderId: string }) => {
    server = server.map((o) => (o.id === orderId ? { ...o, status: 'cancelled', queueNumber: null } : o));
    return { success: true };
  });
  const view = render(<MerchantHubScreen view="pending" />);
  await act(async () => {});
  await act(async () => fireEvent.press(view.getByText('給號碼並接單')));
  expect(view.getByText('號碼沒給出去，請再按一次。')).toBeTruthy();
  expect(view.getByText(/AAA111/)).toBeTruthy();
  const rejectButtons = view.getAllByText('拒單');
  await act(async () => fireEvent.press(rejectButtons[0]));
  const confirm = alert.mock.calls.find(([title]) => title === '確定拒單？');
  expect(confirm?.[1]).toContain('這張單店家取消了');
  const destructive = (confirm?.[2] as Array<{ text: string; onPress?: () => void }>).find(
    (button) => button.text === '拒單',
  );
  await act(async () => destructive!.onPress!());
  expect(mockUpdate).toHaveBeenCalledWith({ schoolId: 'pu', orderId: 'co_waiting_aaa111', status: 'cancelled' });
  expect(view.queryByText(/AAA111/)).toBeNull();
  alert.mockRestore();
});

test('出餐分頁的單還沒號碼：只有「給號碼」，不會改狀態按鈕以外的東西', async () => {
  server = [order('co_nonum_ggg777', { status: 'confirmed' })];
  const view = render(<MerchantHubScreen view="kitchen" />);
  await act(async () => {});
  expect(view.getByText('給號碼')).toBeTruthy();
  expect(view.getByText('開始製作')).toBeTruthy();
  expect(view.queryByText('給號碼並接單')).toBeNull();
  expect(view.queryByText('拒單')).toBeNull();
});
