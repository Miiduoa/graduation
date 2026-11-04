import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantCardStack } from './AssistantCards';
import type { V2Card } from './types';

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
  render(
    <AssistantCardStack
      cards={[eventCard('m1', '精確作業安排')]}
      states={{ m1: '已加入個人行事曆' }}
      pending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('已加入個人行事曆')).toBeTruthy();
  expect(screen.queryByText('確認')).toBeNull();
});
