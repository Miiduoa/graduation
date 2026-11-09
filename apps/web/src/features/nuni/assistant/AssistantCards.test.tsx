import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantCardStack } from './AssistantCards';
import type { V2Card } from './types';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';

const eventCard = (id: string, title: string): V2Card => ({
  tool: 'propose_personal_event',
  token: 't-' + id,
  mutationId: id,
  schoolId: 'pu',
  destination: '個人行事曆（無推播提醒）',
  args: {
    title,
    date: '2026-11-04',
    startTime: '20:00',
    endTime: '21:00',
    allDay: false,
  },
});

const verifiedState = (card: V2Card) => ({
  status: 'verified' as const, local: 'ready' as const,
  receipt: createAssistantCalendarReceipt({
    schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
    revision: 1, verifiedAt: '2026-11-04T11:00:00.000Z',
    record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
      schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-04T10:59:00.000Z',
      source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
  }),
});

const foodCard: V2Card = {
  tool: 'propose_food_order',
  token: 'food',
  mutationId: 'food-1',
  schoolId: 'pu',
  destination: '帶到點餐頁',
  args: {
    reason: '線上點餐尚未開放；帶到點餐頁',
    href: '/food?tenant=fixture-realm&location=dining-a',
    summary: {
      store: '合成蔬食餐廳',
      totalMinor: 8000,
      requestedPickupAt: '2026-11-04T12:00:00+08:00',
      pickupMethod: '自取',
      lines: [{ name: '蔬菜便當', quantity: 1, options: ['標準不辣'], unitMinor: 8000 }],
    },
  },
};

it('shows event time and keeps sequential confirm/cancel actions', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const cards = [eventCard('m1', '寫作業：樹與圖作業'), eventCard('m2', '寫作業：程式練習')];
  render(
    <AssistantCardStack
      cards={cards}
      states={{}}
      pending={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByText('寫作業：樹與圖作業')).toBeTruthy();
  expect(screen.getAllByText(/20:00–21:00/).length).toBe(2);
  expect(screen.getByText('依序全部確認')).toBeTruthy();
  const confirms = screen.getAllByText('確認');
  expect((confirms[1] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(confirms[0]);
  expect(onConfirm).toHaveBeenCalledWith([cards[0]]);
  fireEvent.click(screen.getAllByText('取消')[1]);
  expect(onCancel).toHaveBeenCalledWith(1);
});

it('shows food store, item, price and a button to the order page', () => {
  render(
    <AssistantCardStack
      cards={[foodCard]}
      states={{}}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('合成蔬食餐廳')).toBeTruthy();
  expect(screen.getByText(/蔬菜便當/)).toBeTruthy();
  expect(screen.getByText('80 元')).toBeTruthy();
  expect(screen.getByText('合計 80 元')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往點餐頁' }).getAttribute('href')).toContain('/food?');
  expect(screen.getByText('確認')).toBeTruthy();
  expect(screen.getByText('取消')).toBeTruthy();
});

it('keeps confirmed calendar copy and page link after write-in', () => {
  const card = eventCard('calendar-event-1', '精確作業安排');
  render(
    <AssistantCardStack
      cards={[card]}
      states={{ [card.mutationId]: verifiedState(card) }}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('已核對並加入個人行事曆')).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟這筆行程' }).getAttribute('href')).toBe('/calendar?schoolId=pu&eventId=calendar-event-1');
  expect(screen.queryByText('確認')).toBeNull();
});

it('only links food and confirmed pages through in-app hrefs', () => {
  const { rerender } = render(
    <AssistantCardStack
      cards={[{ ...foodCard, args: { ...foodCard.args, href: 'https://evil.test/order' } }]}
      states={{}}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByRole('link', { name: '前往點餐頁' })).toBeNull();
  rerender(
    <AssistantCardStack
      cards={[foodCard]}
      states={{}}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole('link', { name: '前往點餐頁' }).getAttribute('href')).toContain('/food?');
  rerender(
    <AssistantCardStack
      cards={[eventCard('m1', '精確作業安排')]}
      states={{ m1: { status: 'handoff', href: 'https://evil.test/done', message: '外部連結未核對' } }}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByRole('link', { name: '開啟確認的頁面' })).toBeNull();
  expect(screen.getByText('外部連結未核對')).toBeTruthy();
  rerender(
    <AssistantCardStack
      cards={[eventCard('m1', '精確作業安排')]}
      states={{ m1: { status: 'handoff', href: '/calendar?id=evt-1', message: '入口已備妥' } }}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole('link', { name: '開啟確認的頁面' }).getAttribute('href')).toBe(
    '/calendar?id=evt-1',
  );
});

it('keeps pending batch confirm disabled without hiding the label', () => {
  render(
    <AssistantCardStack
      cards={[eventCard('m1', '寫作業：樹與圖作業'), eventCard('m2', '寫作業：程式練習')]}
      states={{}}
      pending
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const batch = screen.getByRole('button', { name: '依序全部確認' }) as HTMLButtonElement;
  expect(batch.disabled).toBe(true);
  expect(batch.textContent).toBe('依序全部確認');
});

it('offers read-only recovery for uncertain results and blocks the dependent batch', () => {
  const onReconcile = vi.fn();
  const cards = [eventCard('calendar-event-1', '英文'), eventCard('calendar-event-2', '程式'), eventCard('calendar-event-3', '資料庫')];
  render(<AssistantCardStack cards={cards}
    states={{ [cards[0].mutationId]: { status: 'unknown', message: '尚未核對執行結果' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} onReconcile={onReconcile} />);
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  expect(onReconcile).toHaveBeenCalledWith(cards[0]);
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: '確認' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  expect((screen.getByRole('button', { name: '依序全部確認' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText('行程執行進度').textContent).toContain('待核對 1 項');
});

it('keeps service handoff distinct from verified calendar completion', () => {
  render(<AssistantCardStack cards={[foodCard]}
    states={{ [foodCard.mutationId]: { status: 'handoff', href: '/food?tenant=fixture-realm', message: '請到點餐頁完成確認與付款。' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText('請到點餐頁完成確認與付款。')).toBeTruthy();
  expect(screen.queryByText('已送出訂單')).toBeNull();
  expect(screen.queryByLabelText('行程執行回執')).toBeNull();
});


it('offers only separate ordered confirmations when the owner requires individual decisions', () => {
  const cards = [eventCard('selected-first', '保留項目一'), eventCard('selected-second', '保留項目二')];
  const onConfirm = vi.fn(), onCancel = vi.fn();
  const view = render(<AssistantCardStack cards={cards} states={{}} pending={false}
    allowBatchConfirmation={false} onConfirm={onConfirm} onCancel={onCancel} />);
  expect(screen.queryByRole('button', { name: '依序全部確認' })).toBeNull();
  const buttons = screen.getAllByRole('button', { name: '確認' });
  expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(buttons[0]);
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith([cards[0]]);
  view.rerender(<AssistantCardStack cards={cards} states={{ [cards[0].mutationId]: verifiedState(cards[0]) }}
    pending={false} allowBatchConfirmation={false} onConfirm={onConfirm} onCancel={onCancel} />);
  expect(screen.queryByRole('button', { name: '依序全部確認' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(onConfirm.mock.calls).toEqual([[[cards[0]]], [[cards[1]]]]);
});
