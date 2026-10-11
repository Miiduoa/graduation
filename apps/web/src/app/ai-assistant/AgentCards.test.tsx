import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  watch: vi.fn(),
}));
vi.mock('@/lib/campusAssistantClient', () => ({
  confirmCreateOrder: mocks.confirm,
  watchOrderQueueNumber: mocks.watch,
}));

import { AgentCardList } from './AgentCards';

const draft = {
  kind: 'order_draft_card',
  payload: {
    cafeteriaId: 'cafe',
    cafeteriaName: '校園餐廳',
    items: [{ menuItemId: 'rice', name: '雞腿飯', price: 90, quantity: 1 }],
    subtotal: 90,
    tax: 5,
    total: 95,
    itemCount: 1,
    paymentMethod: 'campus_card',
    confirmAction: {
      functionName: 'createOrder',
      input: { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', name: '雞腿飯', price: 90, quantity: 1 }] },
    },
  },
} as never;

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.watch.mockReset();
});

it('沒拿到號碼：寫「號碼還沒拿到，請到櫃台確認。」和台灣時間、品項，店家給號碼後換成真的號碼', async () => {
  let push: ((n: number) => void) | undefined;
  const stop = vi.fn();
  mocks.watch.mockImplementation((_s: string, _o: string, cb: (n: number) => void) => {
    push = cb;
    return stop;
  });
  mocks.confirm.mockResolvedValue({
    success: true,
    orderId: 'co_1',
    total: 95,
    queueNumber: null,
    queueStatus: 'pending_confirmation',
    createdAt: '2026-10-13T04:05:00.000Z',
    items: [{ name: '雞腿飯', quantity: 1 }],
  });
  render(<AgentCardList cards={[draft]} schoolId="pu" />);
  await act(async () => fireEvent.click(screen.getByText('確認下單')));
  expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ schoolId: 'pu', cafeteriaId: 'cafe' });
  expect(typeof mocks.confirm.mock.calls[0][0].requestId).toBe('string');
  expect(screen.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(screen.getByText('10 月 13 日（二）12:05・雞腿飯 ×1')).toBeTruthy();
  expect(screen.getByText('狀態：待給號碼')).toBeTruthy();
  expect(mocks.watch).toHaveBeenCalledWith('pu', 'co_1', expect.any(Function));
  await act(async () => push!(8));
  expect(screen.getByText('取餐號碼 8')).toBeTruthy();
  expect(screen.queryByText('號碼還沒拿到，請到櫃台確認。')).toBeNull();
  expect(stop).toHaveBeenCalled();
});

it('伺服器已發號：直接顯示取餐號碼', async () => {
  mocks.confirm.mockResolvedValue({ success: true, orderId: 'co_2', total: 95, queueNumber: 3, queueStatus: 'assigned' });
  render(<AgentCardList cards={[draft]} schoolId="pu" />);
  await act(async () => fireEvent.click(screen.getByText('確認下單')));
  expect(screen.getByText('取餐號碼 3')).toBeTruthy();
  expect(mocks.watch).not.toHaveBeenCalled();
});

it('連點確認下單、失敗後再連點：同時只會有一個請求，全部同一個送出編號', async () => {
  let release: (value: unknown) => void = () => undefined;
  mocks.confirm
    .mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: false, errorMessage: '下單失敗，請稍後再試' }), 0)),
    )
    .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  render(<AgentCardList cards={[draft]} schoolId="pu" />);
  const button = screen.getByText('確認下單');
  await act(async () => {
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByText('訂單沒送出去，請再試一次。')).toBeTruthy();
  const again = screen.getByText('再試一次');
  await act(async () => {
    fireEvent.click(again);
    fireEvent.click(again);
    fireEvent.click(again);
  });
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  expect(new Set(mocks.confirm.mock.calls.map(([sent]) => sent.requestId)).size).toBe(1);
  await act(async () => release({ success: true, orderId: 'co_9', total: 95, queueNumber: 4, queueStatus: 'assigned' }));
  expect(screen.getByText('取餐號碼 4')).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
});

it('伺服器明確說不成立（菜單變了）：照實轉述，下次換新的送出編號', async () => {
  mocks.confirm
    .mockResolvedValueOnce({ success: false, errorMessage: '餐點已售完，請重新確認', notCreated: true })
    .mockResolvedValueOnce({ success: true, orderId: 'co_3', total: 95, queueNumber: 2, queueStatus: 'assigned' });
  render(<AgentCardList cards={[draft]} schoolId="pu" />);
  await act(async () => fireEvent.click(screen.getByText('確認下單')));
  expect(screen.getByText('餐點已售完，請重新確認')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText('再試一次')));
  const [first, second] = mocks.confirm.mock.calls.map(([sent]) => sent.requestId);
  expect(second).not.toBe(first);
  expect(screen.getByText('取餐號碼 2')).toBeTruthy();
});
