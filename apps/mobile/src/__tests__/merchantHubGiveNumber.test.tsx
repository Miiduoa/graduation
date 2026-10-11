import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockList = jest.fn();
const mockGive = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../services/merchant', () => ({
  listMerchantOrders: (...args: unknown[]) => mockList(...args),
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

test('店家工作台：沒號碼的訂單寫「取餐號碼：待確認」和下單時間，按「給號碼」走伺服器，換成真的號碼', async () => {
  mockList.mockResolvedValueOnce([pendingOrder]).mockResolvedValue([
    { ...pendingOrder, status: 'confirmed', queueNumber: '12' },
  ]);
  mockGive.mockResolvedValue({ queueNumber: 12, status: 'confirmed' });
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('給號碼')).toBeTruthy());
  expect(view.getByText('取餐號碼：待確認・下單 10 月 13 日（二）12:05')).toBeTruthy();
  // 沒號碼時不給「確認接單」，免得接了單學生還是沒號碼；「給號碼」會一併接單
  expect(view.queryByText('確認接單')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('給號碼')));
  expect(mockGive).toHaveBeenCalledTimes(1);
  expect(mockGive).toHaveBeenCalledWith({ schoolId: 'pu', orderId: 'co_order_abcd', cafeteriaId: 'cafe' });
  await waitFor(() => expect(view.getByText('取餐號碼 12')).toBeTruthy());
  expect(view.queryByText('給號碼')).toBeNull();
  expect(view.queryByText(/待確認・下單/)).toBeNull();
  expect(view.getByText('開始製作')).toBeTruthy();
});

test('店家工作台：給號碼被擋（例如不是這家店的帳號）照實提示，不顯示假號碼', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockList.mockResolvedValue([pendingOrder]);
  mockGive.mockRejectedValue(new Error('Only the buyer or this store can get a number'));
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('給號碼')).toBeTruthy());
  await act(async () => fireEvent.press(view.getByText('給號碼')));
  expect(alert).toHaveBeenCalledWith('號碼還沒給出去', 'Only the buyer or this store can get a number');
  expect(view.getByText(/取餐號碼：待確認/)).toBeTruthy();
  expect(view.queryByText(/取餐號碼 \d/)).toBeNull();
  alert.mockRestore();
});

test('店家工作台：已經有號碼的訂單直接顯示號碼，照常接單', async () => {
  mockList.mockResolvedValue([{ ...pendingOrder, queueNumber: '4' }]);
  const view = render(<MerchantHubScreen />);
  await waitFor(() => expect(view.getByText('取餐號碼 4')).toBeTruthy());
  expect(view.queryByText('給號碼')).toBeNull();
  expect(view.getByText('確認接單')).toBeTruthy();
});
