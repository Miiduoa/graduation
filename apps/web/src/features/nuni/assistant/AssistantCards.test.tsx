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
  expect(screen.getByRole('button', { name: '依序確認 2 筆個人行程' })).toBeTruthy();
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
  const batch = screen.getByRole('button', { name: '依序確認 2 筆個人行程' }) as HTMLButtonElement;
  expect(batch.disabled).toBe(true);
  expect(batch.textContent).toBe('依序確認 2 筆個人行程');
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
  expect((screen.getByRole('button', { name: '依序確認 2 筆個人行程' }) as HTMLButtonElement).disabled).toBe(true);
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

it('does not combine calendar writes and food-order review into one batch confirmation', () => {
  const onConfirm = vi.fn();
  const calendar = eventCard('calendar-mixed-valid-1', '讀書：程式設計');
  const { rerender } = render(<AssistantCardStack
    cards={[calendar, foodCard]} states={{}} pending={false}
    onConfirm={onConfirm} onCancel={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  expect(screen.getByText(/點餐也不會和行程一起批次確認/)).toBeTruthy();
  const confirm = screen.getAllByRole('button', { name: '確認' });
  expect(confirm).toHaveLength(2);
  // Food cannot advance while a preceding calendar item is not read back.
  expect((confirm[1] as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/前一筆個人行程尚未確認建立/)).toBeTruthy();
  fireEvent.click(confirm[0]);
  expect(onConfirm).toHaveBeenLastCalledWith([calendar]);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  rerender(<AssistantCardStack cards={[calendar, foodCard]}
    states={{ [calendar.mutationId]: verifiedState(calendar) }} pending={false}
    onConfirm={onConfirm} onCancel={vi.fn()} />);
  expect(screen.queryByText(/前一筆個人行程尚未確認建立/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(onConfirm).toHaveBeenLastCalledWith([foodCard]);
  expect(onConfirm).toHaveBeenCalledTimes(2);

  const page: V2Card = {
    tool: 'propose_open_page', token: 'page-token', mutationId: 'page-1',
    schoolId: 'pu', destination: '/map?schoolId=pu', args: { page: 'map' },
  };
  rerender(<AssistantCardStack
    cards={[calendar, page]} states={{}} pending={false}
    onConfirm={onConfirm} onCancel={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(2);
});

it('holds a mixed action until its uncertain prerequisite is read back', () => {
  const calendar = eventCard('calendar-pending-readback', '準備英文');
  const onConfirm = vi.fn();
  const onReconcile = vi.fn();
  const states = { [calendar.mutationId]: { status: 'unknown' as const, message: '行程結果尚未讀回' } };
  const view = render(<AssistantCardStack cards={[calendar, foodCard]} pending={false}
    states={states} onConfirm={onConfirm} onCancel={vi.fn()} onReconcile={onReconcile} />);
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  const food = screen.getByRole('button', { name: '確認' }) as HTMLButtonElement;
  expect(food.disabled).toBe(true);
  expect(screen.getByText(/前一筆個人行程結果尚未核對/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新核對前一步行程' }));
  expect(onReconcile).toHaveBeenCalledExactlyOnceWith(calendar);
  expect(onConfirm).not.toHaveBeenCalled();

  view.rerender(<AssistantCardStack cards={[calendar, foodCard]} pending
    states={states} onConfirm={onConfirm} onCancel={vi.fn()} onReconcile={onReconcile} />);
  const recheck = screen.getByRole('button', { name: '重新核對前一步行程' }) as HTMLButtonElement;
  expect(recheck.disabled).toBe(true);
  fireEvent.click(recheck);
  expect(onReconcile).toHaveBeenCalledTimes(1);
});

it('refuses to render a confirmation button for an unknown model tool', () => {
  const onConfirm = vi.fn();
  const unsupported: V2Card = {
    tool: 'unrecognized_write', token: 'unused', mutationId: 'm2', schoolId: 'pu',
    destination: '不應信任', args: { href: 'https://outside.example' },
  };
  const valid = eventCard('m1', '讀書準備');
  render(<AssistantCardStack cards={[valid, unsupported]}
    states={{}} pending={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
  expect(screen.getByLabelText('無法確認的任務')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(onConfirm).toHaveBeenCalledWith([valid]);
  expect(screen.queryByRole('link', { name: /outside/ })).toBeNull();
});

it('warns that order-mode confirmation may submit an order and does not expose a page shortcut', () => {
  const order = { ...foodCard, args: { ...foodCard.args, mode: 'order' } };
  render(<AssistantCardStack cards={[order]} states={{}} pending={false}
    onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText(/確認可能直接送出訂單/)).toBeTruthy();
  expect(screen.getByText('合計 80 元')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往點餐頁' })).toBeNull();
  expect(screen.getByRole('button', { name: '確認' })).toBeTruthy();
  expect(screen.queryByText('已送出訂單')).toBeNull();
});

it('reports cross-service progress without treating a handoff as a finished order', () => {
  const calendar = eventCard('calendar-mixed-1', '資料庫複習');
  const page: V2Card = {
    tool: 'propose_open_page', token: 'page-mixed-1', mutationId: 'page-mixed-1',
    schoolId: 'pu', destination: '/map?schoolId=pu', args: { page: 'map' },
  };
  const { rerender } = render(<AssistantCardStack
    cards={[calendar, foodCard, page]}
    states={{ [calendar.mutationId]: verifiedState(calendar),
      [foodCard.mutationId]: { status: 'handoff', href: '/food?tenant=fixture-realm', message: '點餐頁已備妥' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  const status = screen.getByLabelText('跨功能任務進度');
  expect(status.textContent).toContain('個人行程已讀回核對 1/1 項');
  expect(status.textContent).toContain('服務入口已備妥 1 項');
  expect(status.textContent).toContain('其他 1 項尚未確認完成');
  expect(status.textContent).toContain('服務入口不代表訂單、付款或作業已完成');
  expect(screen.queryByText('已完成 3/3 項')).toBeNull();
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();

  rerender(<AssistantCardStack cards={[calendar, foodCard, page]}
    states={{ [calendar.mutationId]: { status: 'unknown', message: '回執尚未核對' },
      [foodCard.mutationId]: { status: 'handoff', href: '/food?tenant=fixture-realm', message: '入口已備妥' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByLabelText('跨功能任務進度').textContent).toContain('待核對或有衝突 1 項');
  expect(screen.getByLabelText('跨功能任務進度').textContent).toContain('其他 1 項尚未確認完成');
});

it('does not show an irrelevant zero-calendar count for multiple service-only actions', () => {
  const page: V2Card = {
    tool: 'propose_open_page', token: 'service-entry', mutationId: 'service-entry',
    schoolId: 'pu', destination: '/map?schoolId=pu', args: { page: 'map' },
  };
  render(<AssistantCardStack cards={[foodCard, page]} states={{}} pending={false}
    onConfirm={vi.fn()} onCancel={vi.fn()} />);
  const status = screen.getByLabelText('跨功能任務進度');
  expect(status.textContent).not.toContain('0/0');
  expect(status.textContent).toContain('服務入口已備妥 0 項');
  expect(status.textContent).toContain('其他 2 項尚未確認完成');
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
});

it.each(['cancelled', 'superseded'] as const)(
  'does not encourage retrying downstream cards after a %s prerequisite', (status) => {
    const first = eventCard('calendar-aborted-plan', '報告準備');
    render(<AssistantCardStack cards={[first, foodCard]}
      states={{ [first.mutationId]: { status } }} pending={false}
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/舊計畫不能繼續，請重新規劃後續步驟/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  },
);

it('distinguishes an uncertain prior write from a confirmed failure and blocks automatic continuation', () => {
  const first = eventCard('calendar-unknown-step', '程式複習');
  const { rerender } = render(<AssistantCardStack cards={[first, foodCard]}
    states={{ [first.mutationId]: { status: 'unknown', message: '讀回中斷' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText(/前一筆個人行程結果尚未核對/)).toBeTruthy();
  expect(screen.getByText(/不會自動繼續或重新送出/)).toBeTruthy();
  rerender(<AssistantCardStack cards={[first, foodCard]}
    states={{ [first.mutationId]: { status: 'conflict', message: '來源已改變' } }}
    pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText(/前一筆個人行程與現有紀錄不一致/)).toBeTruthy();
  expect(screen.getByText(/避免重複建立/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
});
