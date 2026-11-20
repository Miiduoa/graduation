import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { PaymentScreen } from '../screens/PaymentScreen';
import { loadPaymentDashboardData } from '../features/payments';
import type { PaymentDashboard } from '../features/payments';
import { isFeatureEnabled } from '../services/release';
import { safeNavigate } from '../utils/safeNavigate';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'school-a', name: '目前學校' };
const mockWrite = jest.fn();
const mockDelete = jest.fn();
const navigation = { navigate: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../features/payments', () => ({
  loadPaymentDashboardData: jest.fn(),
  PAYMENT_HISTORY_LIMIT: 100,
  formatPaymentAmount: (value: number) => `${value < 0 ? '−' : '+'}NT$${Math.abs(value)}`,
  buildPaymentCsv: jest.fn(() => 'transactions'),
}));
jest.mock('../services/release', () => ({ isFeatureEnabled: jest.fn(() => true) }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn().mockImplementation(() => ({
    uri: 'cache/export.csv',
    exists: true,
    write: mockWrite,
    delete: mockDelete,
  })),
}));
function data(title = '實際消費'): PaymentDashboard {
  return {
    balance: 500,
    pending: 0,
    transactions: [
      {
        id: 'transaction-1',
        title,
        amount: -75,
        type: 'expense',
        status: 'completed',
        timestamp: new Date('2026-10-08T01:00:00Z'),
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-a' };
  mockSchool = { id: 'school-a', name: '目前學校' };
  jest.mocked(isFeatureEnabled).mockReturnValue(true);
  jest.mocked(loadPaymentDashboardData).mockResolvedValue(data());
  jest.mocked(isAvailableAsync).mockResolvedValue(true);
  jest.mocked(shareAsync).mockResolvedValue();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('shows actual debits and does not claim an attached card, security setup or a live top-up service', async () => {
  const view = render(<PaymentScreen navigation={navigation} />);
  await view.findByText('實際消費');
  expect(loadPaymentDashboardData).toHaveBeenCalledWith({
    userId: 'student-a',
    schoolId: 'school-a',
  });
  expect(view.getByText('−NT$75')).toBeTruthy();
  expect(view.getByText('線上儲值尚未開放')).toBeTruthy();
  expect(view.queryByText(/已綁定學生證|支付密碼|生物辨識|學生餐廳午餐|1234/)).toBeNull();
  fireEvent.press(view.getByText('我的訂單'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'StudentOrders');
});

test('empty data stays empty and an absent wallet is not treated as a zero balance', async () => {
  jest
    .mocked(loadPaymentDashboardData)
    .mockResolvedValue({ balance: null, pending: 0, transactions: [] });
  const view = render(<PaymentScreen />);
  await view.findByText('目前沒有本校交易紀錄。');
  expect(view.getByText('尚無本校錢包資料')).toBeTruthy();
  expect(view.getByRole('button', { name: '匯出已載入紀錄' })).toBeDisabled();
});

test('a read failure exposes retry without sample money or a false empty success', async () => {
  jest.mocked(loadPaymentDashboardData).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<PaymentScreen />);
  await view.findByText('暫時無法讀取錢包');
  expect(view.queryByText('目前沒有本校交易紀錄。')).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('實際消費');
});

test('account and school changes mask old rows immediately and ignore the old response', async () => {
  const first = deferred<PaymentDashboard>();
  const second = deferred<PaymentDashboard>();
  jest
    .mocked(loadPaymentDashboardData)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const view = render(<PaymentScreen />);
  mockUser = { uid: 'student-b' };
  mockSchool = { id: 'school-b', name: '另一間學校' };
  view.rerender(<PaymentScreen />);
  await act(async () => first.resolve(data('舊帳號消費')));
  expect(view.queryByText('舊帳號消費')).toBeNull();
  await act(async () => second.resolve(data('新帳號消費')));
  expect(view.getByText('新帳號消費')).toBeTruthy();
});

test('logout hides private data and stops reads', async () => {
  const view = render(<PaymentScreen />);
  await view.findByText('實際消費');
  mockUser = null;
  view.rerender(<PaymentScreen />);
  expect(view.queryByText('實際消費')).toBeNull();
  expect(view.getByText('登入後查看錢包')).toBeTruthy();
  expect(loadPaymentDashboardData).toHaveBeenCalledTimes(1);
});

test('disabled payment access performs no financial reads', async () => {
  jest.mocked(isFeatureEnabled).mockReturnValue(false);
  const view = render(<PaymentScreen />);
  expect(view.getByText('校園支付尚未開通')).toBeTruthy();
  expect(loadPaymentDashboardData).not.toHaveBeenCalled();
});

test('a pending export cannot share the previous account ledger or emit alerts after an account change', async () => {
  const pending = deferred<boolean>();
  jest.mocked(isAvailableAsync).mockReturnValueOnce(pending.promise);
  const view = render(<PaymentScreen />);
  await view.findByText('實際消費');
  fireEvent.press(view.getByText('匯出已載入紀錄'));
  mockUser = { uid: 'student-b' };
  view.rerender(<PaymentScreen />);
  await act(async () => pending.resolve(true));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('pending and failed payments are not counted as completed spending', async () => {
  const dashboard = data();
  dashboard.transactions.push({
    ...dashboard.transactions[0],
    id: 'pending',
    status: 'pending',
    amount: -500,
  });
  jest.mocked(loadPaymentDashboardData).mockResolvedValue(dashboard);
  const view = render(<PaymentScreen />);
  await view.findByText(/消費合計 \$75/);
  expect(view.getByText(/處理中/)).toBeTruthy();
});

test('exports the loaded ledger then removes the temporary file', async () => {
  const view = render(<PaymentScreen />);
  await view.findByText('實際消費');
  await act(async () => fireEvent.press(view.getByText('匯出已載入紀錄')));
  expect(mockWrite).toHaveBeenCalledWith('transactions');
  expect(shareAsync).toHaveBeenCalledWith(
    'cache/export.csv',
    expect.objectContaining({ mimeType: 'text/csv' }),
  );
  expect(mockDelete).toHaveBeenCalledTimes(1);
});
