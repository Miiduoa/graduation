import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: () => false,
  isDemoUid: () => false,
}));
jest.mock('../services/demoMerchantOrders', () => ({
  listDemoMerchantOrders: () => [],
  updateDemoOrderStatus: jest.fn(),
  subscribeDemoOrders: () => () => undefined,
}));
jest.mock('../services/demoStore', () => ({ updateOrderStatus: jest.fn() }));
jest.mock('../services/companionEngine', () => ({ recordCompanionFeatureSignal: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'cafe-staff' },
    profile: {
      role: 'vendor',
      merchantAssignments: [
        { schoolId: 'pu', schoolName: '靜宜大學', cafeteriaId: 'cafe', cafeteriaName: '校園餐廳', status: 'active', orderingEnabled: true },
      ],
    },
  }),
}));

import { MerchantHubScreen } from '../screens/MerchantHubScreen';

const pendingOrder = {
  id: 'co_order_abcd',
  userId: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  items: [{ menuItemId: 'rice', name: '雞腿飯', price: 90, quantity: 1 }],
  total: 90,
  status: 'pending',
  paymentStatus: 'pending',
  createdAt: '2026-10-13T04:05:00.000Z',
};

beforeEach(() => {
  mockList.mockReset();
  mockGive.mockReset();
  mockUpdate.mockReset();
});

test('店家工作台：沒號碼的訂單寫「取餐號碼：待給號碼」和下單時間，按「給號碼並接單」走伺服器，換成真的號碼', async () => {
  mockList.mockResolvedValueOnce([pendingOrder]).mockResolvedValue([
    { ...pendingOrder, status: 'confirmed', queueNumber: '12' },
  ]);
  mockGive.mockResolvedValue({ queueNumber: 12, status: 'confirmed' });
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('給號碼並接單')).toBeTruthy());
  expect(view.getByText('取餐號碼：待給號碼・下單 10 月 13 日（二）12:05')).toBeTruthy();
  // 沒號碼時不給「確認接單」，免得接了單學生還是沒號碼；「給號碼並接單」會一併接單
  expect(view.queryByText('確認接單')).toBeNull();
  expect(view.getByText('拒單')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('給號碼並接單')));
  expect(mockGive).toHaveBeenCalledTimes(1);
  expect(mockGive).toHaveBeenCalledWith({ schoolId: 'pu', orderId: 'co_order_abcd', cafeteriaId: 'cafe' });
  await waitFor(() => expect(view.getByText('取餐號碼 12')).toBeTruthy());
  expect(view.queryByText(/^給號碼/)).toBeNull();
  expect(view.queryByText(/待給號碼・下單/)).toBeNull();
  expect(view.getByText('開始製作')).toBeTruthy();
});

test('店家工作台：給號碼失敗，按鈕旁邊寫「號碼沒給出去，請再按一次。」，同一顆鈕再按成功後那句消失', async () => {
  mockList.mockResolvedValueOnce([pendingOrder]).mockResolvedValueOnce([pendingOrder]).mockResolvedValue([
    { ...pendingOrder, status: 'confirmed', queueNumber: '7' },
  ]);
  mockGive.mockRejectedValueOnce(new Error('deadline-exceeded')).mockResolvedValue({ queueNumber: 7, status: 'confirmed' });
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('給號碼並接單')).toBeTruthy());
  await act(async () => fireEvent.press(view.getByText('給號碼並接單')));
  expect(view.getByText('號碼沒給出去，請再按一次。')).toBeTruthy();
  expect(view.getByText(/取餐號碼：待給號碼/)).toBeTruthy();
  expect(view.getByText('拒單')).toBeTruthy();
  expect(view.queryByText(/取餐號碼 \d/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('給號碼並接單')));
  await waitFor(() => expect(view.getByText('取餐號碼 7')).toBeTruthy());
  expect(view.queryByText('號碼沒給出去，請再按一次。')).toBeNull();
  expect(mockGive).toHaveBeenCalledTimes(2);
});

test('出餐頁：接了的單有「取消訂單」，先問「確定取消這張單？學生會收到通知。」，按「取消訂單」才走取消', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockList.mockResolvedValue([{ ...pendingOrder, status: 'preparing', queueNumber: '3' }]);
  mockUpdate.mockResolvedValue({ status: 'cancelled' });
  const view = render(<MerchantHubScreen view="kitchen" />);
  await waitFor(() => expect(view.getByText('取消訂單')).toBeTruthy());
  expect(view.queryByText('拒單')).toBeNull();
  fireEvent.press(view.getByText('取消訂單'));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
  expect(title).toBe('確定取消這張單？');
  expect(message).toBe('學生會收到通知。');
  expect(buttons.map((button) => button.text)).toEqual(['先不要', '取消訂單']);
  expect(mockUpdate).not.toHaveBeenCalled();
  await act(async () => buttons[1].onPress?.());
  expect(mockUpdate).toHaveBeenCalledWith({ schoolId: 'pu', orderId: 'co_order_abcd', status: 'cancelled' });
  alert.mockRestore();
});

test('出餐頁：按「先不要」不會取消；已完成或已取消的單沒有「取消訂單」', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockList.mockResolvedValue([{ ...pendingOrder, status: 'ready', queueNumber: '3' }]);
  const view = render(<MerchantHubScreen view="kitchen" />);
  await waitFor(() => expect(view.getByText('取消訂單')).toBeTruthy());
  fireEvent.press(view.getByText('取消訂單'));
  const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
  buttons[0].onPress?.();
  expect(mockUpdate).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('店家工作台：已經有號碼的訂單直接顯示號碼，照常接單', async () => {
  mockList.mockResolvedValue([{ ...pendingOrder, queueNumber: '4' }]);
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('取餐號碼 4')).toBeTruthy());
  expect(view.queryByText('給號碼')).toBeNull();
  expect(view.getByText('確認接單')).toBeTruthy();
});
