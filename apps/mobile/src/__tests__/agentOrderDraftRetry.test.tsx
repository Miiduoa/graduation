import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockCallable = jest.fn();
const mockGetDoc = jest.fn();
const mockNavigate = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: (...args: unknown[]) => mockGetDoc(...args),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async () => 'hash'),
}));
jest.mock('../firebase', () => ({
  getFunctionsInstance: () => ({}),
  getDb: () => 'db',
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: (_nav: unknown, route: string) => mockNavigate(route) }));
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

const missing = { exists: () => false, data: () => null };
beforeEach(() => {
  mockCallable.mockReset();
  mockNavigate.mockReset();
  mockGetDoc.mockReset().mockResolvedValue(missing);
});

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
  expect(view.getByText('下單成功')).toBeTruthy();
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
  expect(view.getByText('下單成功')).toBeTruthy();
  expect(mockCallable).toHaveBeenCalledTimes(2);
});

const timeout = () => Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded' });

test('助理下單卡逾時，但伺服器其實建好單：用同一個編號查到，顯示末 6 碼和取餐號碼', async () => {
  mockCallable.mockRejectedValueOnce(timeout());
  mockGetDoc.mockImplementation(async () => ({
    exists: () => true,
    data: () => ({ userId: 'alice', requestId: mockCallable.mock.calls[0][0].requestId, queueNumber: 12, status: 'confirmed', items: [{ name: '雞腿飯', quantity: 1 }] }),
  }));
  const view = render(<AgentCardList cards={[card]} />);
  await act(async () => fireEvent.press(view.getByText('✅ 確認下單')));
  expect(mockGetDoc).toHaveBeenCalledWith('users/alice/schools/pu/orders/co_hash');
  expect(view.getByText('下單成功')).toBeTruthy();
  expect(view.getByText('訂單末 6 碼 O_HASH')).toBeTruthy();
  expect(view.getByText('取餐號碼 12')).toBeTruthy();
  expect(view.queryByText('再試一次')).toBeNull();
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('助理下單卡逾時，伺服器確定沒有這張單：寫「訂單沒送出去，請再試一次。」', async () => {
  mockCallable.mockRejectedValueOnce(timeout());
  const view = render(<AgentCardList cards={[card]} />);
  await act(async () => fireEvent.press(view.getByText('✅ 確認下單')));
  expect(view.getByText('訂單沒送出去，請再試一次。')).toBeTruthy();
  expect(view.getByText('再試一次')).toBeTruthy();
});

test('助理下單卡逾時，連查都查不出結果：寫「還在確認訂單有沒有送出，請到『我的訂單』看。」，按「我的訂單」開我的訂單', async () => {
  mockCallable.mockRejectedValueOnce(timeout());
  mockGetDoc.mockRejectedValue(new Error('offline'));
  const view = render(<AgentCardList cards={[card]} />);
  await act(async () => fireEvent.press(view.getByText('✅ 確認下單')));
  expect(view.getByText('還在確認訂單有沒有送出，請到『我的訂單』看。')).toBeTruthy();
  expect(view.queryByText('再試一次')).toBeNull();
  fireEvent.press(view.getByText('我的訂單'));
  expect(mockNavigate).toHaveBeenCalledWith('StudentOrders');
});

test('助理下單卡成功：寫末 6 碼；還沒號碼時寫待給號碼兩行，不顯示整串編號', async () => {
  mockCallable.mockResolvedValueOnce({
    data: { success: true, orderId: 'co_abcdef123456', queueNumber: null, createdAt: '2026-10-13T04:05:00.000Z', items: [{ name: '雞腿飯', quantity: 1 }] },
  });
  const view = render(<AgentCardList cards={[card]} />);
  await act(async () => fireEvent.press(view.getByText('✅ 確認下單')));
  expect(view.getByText('訂單末 6 碼 123456')).toBeTruthy();
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(view.getByText('10 月 13 日（二）12:05・雞腿飯 ×1')).toBeTruthy();
  expect(view.getByText('狀態：待給號碼')).toBeTruthy();
  expect(view.queryByText(/co_abcdef123456/)).toBeNull();
});
