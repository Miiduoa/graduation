import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockAssign = jest.fn();
jest.mock('../services/cafeteriaData', () => ({
  ...jest.requireActual('../services/cafeteriaData'),
  assignOrderQueueNumber: (...args: unknown[]) => mockAssign(...args),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { OrderCard } from '../screens/VendorManagementScreen';
import type { Order } from '../services/cafeteriaData';

const baseOrder: Order = {
  id: 'co_order_abcd',
  studentUid: 'alice',
  vendorId: 'cafe',
  cafeteriaId: 'jingyuan' as Order['cafeteriaId'],
  items: [
    { menuItemId: 'rice', menuItemName: '雞腿飯', quantity: 1, unitPrice: 90, selectedOptions: [], subtotal: 90 },
  ],
  totalPrice: 90,
  status: 'pending',
  note: '',
  createdAt: '2026-10-13T04:05:00.000Z',
  estimatedPickup: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  queueNumber: null,
  queueStatus: 'pending_confirmation',
};

beforeEach(() => mockAssign.mockReset());

test('待確認訂單：店家看到「待確認」和「給號碼」，按了走伺服器拿真的號碼並一併接單', async () => {
  const onAccept = jest.fn();
  mockAssign.mockResolvedValue({ queueNumber: 12, status: 'confirmed' });
  const view = render(<OrderCard order={baseOrder} onAccept={onAccept} onCancel={jest.fn()} />);
  expect(view.getByText('待確認')).toBeTruthy();
  // 沒號碼時不給「確認訂單」，免得接了單學生還是沒號碼
  expect(view.queryByText('確認訂單')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('給號碼')));
  expect(mockAssign).toHaveBeenCalledTimes(1);
  expect(mockAssign).toHaveBeenCalledWith('co_order_abcd', { asMerchant: true, vendorId: 'cafe' });
  expect(view.getByText('號碼 12')).toBeTruthy();
  expect(view.queryByText('待確認')).toBeNull();
  expect(view.queryByText('給號碼')).toBeNull();
  expect(onAccept).not.toHaveBeenCalled();
});

test('給號碼失敗：照實提示，不顯示假號碼', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockAssign.mockRejectedValue(new Error('Cafeteria operator access required'));
  const view = render(<OrderCard order={baseOrder} onAccept={jest.fn()} />);
  await act(async () => fireEvent.press(view.getByText('給號碼')));
  expect(alert).toHaveBeenCalled();
  expect(view.getByText('待確認')).toBeTruthy();
  expect(view.queryByText(/號碼 \d/)).toBeNull();
  alert.mockRestore();
});

test('已經有號碼：不出現「待確認」和「給號碼」，照常可以接單', () => {
  const view = render(
    <OrderCard order={{ ...baseOrder, queueNumber: 4, queueStatus: 'assigned' }} onAccept={jest.fn()} />,
  );
  expect(view.getByText('號碼 4')).toBeTruthy();
  expect(view.queryByText('待確認')).toBeNull();
  expect(view.queryByText('給號碼')).toBeNull();
  expect(view.getByText('確認訂單')).toBeTruthy();
});
