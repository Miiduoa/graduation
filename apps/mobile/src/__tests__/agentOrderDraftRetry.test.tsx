import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../firebase', () => ({ getFunctionsInstance: () => ({}) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

import { AgentCardList } from '../components/AgentCards';

const card = {
  kind: 'order_draft_card',
  payload: {
    cafeteriaId: 'cafe',
    cafeteriaName: '校園餐廳',
    items: [{ menuItemId: 'rice', name: '雞腿飯', price: 95, quantity: 1 }],
    subtotal: 95,
    tax: 5,
    total: 100,
    paymentMethod: 'campus_card',
    confirmAction: { input: { schoolId: 'pu' } },
  },
} as never;

beforeEach(() => mockCallable.mockReset());

test('助理下單卡：伺服器沒建成寫「訂單沒送出去，請再試一次。」，再試一次帶同一個送出編號', async () => {
  mockCallable
    .mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }))
    .mockResolvedValueOnce({ data: { success: true, orderId: 'co_1' } });
  const view = render(<AgentCardList cards={[card]} />);
  await act(async () => fireEvent.press(view.getByText('✅ 確認下單')));
  expect(view.getByText('訂單沒送出去，請再試一次。')).toBeTruthy();
  expect(view.queryByText(/請到櫃台確認/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  expect(mockCallable).toHaveBeenCalledTimes(2);
  const first = mockCallable.mock.calls[0][0].requestId;
  expect(typeof first).toBe('string');
  expect(mockCallable.mock.calls[1][0].requestId).toBe(first);
  expect(view.getByText(/訂單建立成功/)).toBeTruthy();
  expect(view.queryByText('再試一次')).toBeNull();
});

test('助理下單卡連點：確認下單、再試一次都只會有一個請求在路上，全部同一個送出編號', async () => {
  let release: (value: unknown) => void = () => undefined;
  mockCallable
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(Object.assign(new Error('internal'), { code: 'functions/internal' })), 0),
        ),
    )
    .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  const view = render(<AgentCardList cards={[card]} />);
  const confirm = view.getByText('✅ 確認下單');
  await act(async () => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(view.getByText('訂單沒送出去，請再試一次。')).toBeTruthy();

  const retry = view.getByText('再試一次');
  await act(async () => {
    fireEvent.press(retry);
    fireEvent.press(retry);
    fireEvent.press(retry);
  });
  expect(mockCallable).toHaveBeenCalledTimes(2);
  const ids = mockCallable.mock.calls.map(([sent]) => sent.requestId);
  expect(new Set(ids).size).toBe(1);
  await act(async () => release({ data: { success: true, orderId: 'co_1' } }));
  expect(view.getByText(/訂單建立成功/)).toBeTruthy();
  expect(mockCallable).toHaveBeenCalledTimes(2);
});
