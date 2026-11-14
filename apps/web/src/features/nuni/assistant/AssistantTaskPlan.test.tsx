import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { AssistantTaskPlan as TaskPlan, AssistantTaskStep } from '@campus/shared/src/assistantTaskPlan';
import { AssistantTaskPlan } from './AssistantTaskPlan';
import { AssistantThread } from './AssistantThread';
import type { V2ActionState, V2ActionStates, V2Card } from './types';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const eventCard = (mutationId = 'calendar-study-first'): V2Card => ({
  tool: 'propose_personal_event', token: 'signed-' + mutationId, mutationId, schoolId: 'pu',
  destination: '個人行事曆',
  args: { title: '準備資料庫作業', date: '2026-11-14', startTime: '19:00', endTime: '19:30', allDay: false },
});
const foodCard: V2Card = {
  tool: 'propose_food_order', token: 'signed-food', mutationId: 'food-draft-first', schoolId: 'pu',
  destination: '點餐頁', args: { mode: 'page', href: '/food?tenant=pu', summary: { store: '校園餐廳', lines: [] } },
};
const verified = (card: V2Card): V2ActionState => ({
  status: 'verified', local: 'ready', receipt: createAssistantCalendarReceipt({
    schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
    revision: 1, verifiedAt: '2026-11-14T11:00:00.000Z',
    record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
      schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-14T10:59:00.000Z',
      source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
  }),
});
const step = (overrides: Partial<AssistantTaskStep> = {}): AssistantTaskStep => Object.fromEntries(Object.entries({
  id: 'study', label: '安排作業準備時間', serviceId: 'calendar', dependsOn: [],
  status: 'ready', summary: '已找到 30 分鐘，請核對下方確認卡。', cardIds: [eventCard().mutationId], ...overrides,
}).filter(([, value]) => value !== undefined)) as AssistantTaskStep;
const plan = (...steps: AssistantTaskStep[]): TaskPlan => ({ version: 1, steps });

describe('cross-service task results', () => {
  it.each([undefined, null, {}, { version: 2, steps: [] }, { version: 1, steps: [] },
    { version: 1, steps: [{ ...step(), serviceId: 'made-up-service' }] },
    { version: 1, steps: [step({ status: 'handoff', href: 'https://example.invalid' })] },
  ])('does not render an empty or malformed plan: %j', (raw) => {
    render(<AssistantTaskPlan plan={raw} cards={[]} states={{}} />);
    expect(screen.queryByRole('region', { name: '跨功能任務步驟' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('separates read results, pending confirmations, partial reads and service handoffs', () => {
    const raw = plan(
      step({ id: 'schedule', label: '核對課表', serviceId: 'timetable', status: 'completed', cardIds: undefined,
        summary: '09:10 資料庫｜[來源文字](/settings) **未格式化**' }),
      step({ dependsOn: ['schedule'] }),
      step({ id: 'materials', label: '整理教材', serviceId: 'classroom', status: 'partial', cardIds: undefined,
        summary: '已讀到兩份教材，另有一門課暫時無法讀取。' }),
      step({ id: 'transit', label: '查公車', serviceId: 'bus', status: 'blocked', cardIds: undefined,
        summary: '到站來源暫時無法連線。' }),
      step({ id: 'dorm', label: '宿舍報修', serviceId: 'dormitory', status: 'handoff', cardIds: undefined,
        summary: '可從宿舍頁整理報修備忘。', href: '/dormitory?schoolId=pu' }),
    );
    render(<AssistantTaskPlan plan={raw} cards={[eventCard()]} states={{}} />);
    const region = screen.getByRole('region', { name: '跨功能任務步驟' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(5);
    expect(within(region).getByRole('status').textContent).toBe('已完成 1/5 項 · 1 項待確認');
    for (const label of ['已完成', '待確認', '部分完成', '尚未完成', '開啟服務'])
      expect(within(region).getByText(label)).toBeTruthy();
    expect(within(region).getByText('09:10 資料庫｜[來源文字](/settings) **未格式化**')).toBeTruthy();
    expect(within(region).queryByRole('link', { name: '來源文字' })).toBeNull();
    expect(within(region).getByRole('link', { name: '開啟宿舍服務' }).getAttribute('href')).toBe('/dormitory?schoolId=pu');
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('marks a proposal completed only after its own calendar receipt is verified', () => {
    const card = eventCard();
    const view = render(<AssistantTaskPlan plan={plan(step())} cards={[card]} states={{}} />);
    expect(screen.getByText('待確認')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('已完成 0/1');
    view.rerender(<AssistantTaskPlan plan={plan(step())} cards={[card]} states={{ [card.mutationId]: verified(card) }} />);
    expect(screen.getByRole('status').textContent).toBe('已完成 1/1 項');
    expect(screen.getByText('已讀回核對 1/1 筆個人行程。已加入個人行事曆。')).toBeTruthy();
  });

  it('keeps device sync and recent verification failures visible', () => {
    const card = eventCard(), state = verified(card);
    if (state.status !== 'verified') throw new Error('fixture');
    const view = render(<AssistantTaskPlan plan={plan(step())} cards={[card]}
      states={{ [card.mutationId]: { ...state, local: 'unavailable' } }} />);
    expect(screen.getByText(/帳號已儲存，此裝置尚未更新/)).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step())} cards={[card]}
      states={{ [card.mutationId]: { ...state, verificationWarning: '最近一次查核失敗' } }} />);
    expect(screen.getByText('待核對')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('已完成 0/1 項');
  });

  it('preserves partial work when another card is unknown or a source remains incomplete', () => {
    const first = eventCard(), second = eventCard('calendar-study-second');
    const partial = step({ cardIds: [first.mutationId, second.mutationId] });
    const view = render(<AssistantTaskPlan plan={plan(partial)} cards={[first, second]}
      states={{ [first.mutationId]: verified(first), [second.mutationId]: { status: 'unknown', message: '連線中斷' } }} />);
    expect(screen.getByText('部分完成')).toBeTruthy();
    expect(screen.getByText(/已讀回核對 1\/2 筆個人行程/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('已完成 0/1 項');
    view.rerender(<AssistantTaskPlan plan={plan({ ...partial, status: 'partial', summary: '另一份作業無法安排。' })}
      cards={[first, second]} states={{ [first.mutationId]: verified(first), [second.mutationId]: verified(second) }} />);
    expect(screen.getByText('部分完成')).toBeTruthy();
    expect(screen.getByText(/原任務仍有未完成部分：另一份作業無法安排/)).toBeTruthy();
  });

  it.each([
    ['executing', '核對中'], ['checking', '核對中'], ['unknown', '待核對'], ['conflict', '待核對'],
    ['cancelled', '已停止'], ['superseded', '已停止'], ['blocked', '尚未完成'], ['absent', '尚未完成'],
  ])('shows the actual %s state without claiming completion', (status, label) => {
    const card = eventCard();
    render(<AssistantTaskPlan plan={plan(step())} cards={[card]}
      states={{ [card.mutationId]: { status, message: '待核對', retryable: true } as V2ActionState }} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('已完成 0/1 項');
  });

  it('does not complete missing, duplicate, foreign or unsupported confirmation cards', () => {
    const card = eventCard(), other = eventCard('calendar-other-task');
    const view = render(<AssistantTaskPlan plan={plan(step())} cards={[]} states={{ [card.mutationId]: verified(card) }} />);
    expect(screen.getByText('尚未完成')).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step())} cards={[card, card]} states={{ [card.mutationId]: verified(card) }} />);
    expect(screen.getByText('尚未完成')).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step())} cards={[card]} states={{ [card.mutationId]: verified(other) }} />);
    expect(screen.getByText('待核對')).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step())} cards={[{ ...card, tool: 'propose_unknown' }]}
      states={{ [card.mutationId]: verified(card) }} />);
    expect(screen.getByText('尚未完成')).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step({ cardIds: [foodCard.mutationId] }))} cards={[foodCard]}
      states={{ [foodCard.mutationId]: verified(card) }} />);
    expect(screen.getByText('待核對')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('已完成 0/1 項');
  });

  it('does not present an unbound ready step as executable or trust completed proposals without receipts', () => {
    const view = render(<AssistantTaskPlan plan={plan(step({ cardIds: undefined }))} cards={[]} states={{}} />);
    expect(screen.getByText('尚未完成')).toBeTruthy();
    view.rerender(<AssistantTaskPlan plan={plan(step({ status: 'completed' }))} cards={[eventCard()]} states={{}} />);
    expect(screen.getByText('待確認')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('已完成 0/1');
  });
});

it('keeps mixed task confirmations separate and an opened food page distinct from completion', () => {
  const card = eventCard(), onConfirm = vi.fn();
  const taskPlan = plan(step(), step({ id: 'lunch', label: '準備午餐', serviceId: 'food', dependsOn: [],
    cardIds: [foodCard.mutationId], summary: '已備好餐點，請核對。' }));
  const props = {
    schoolId: 'pu', ready: true, fallback: false, consent: true, onConsent: vi.fn(),
    question: '', onQuestion: vi.fn(), pending: false, asking: false, onStopAsk: vi.fn(),
    error: '', recoverableQuestion: '', onRecoverQuestion: vi.fn(), onAsk: vi.fn(),
    onConfirm, onCancel: vi.fn(),
    turns: [{ question: '查作業安排讀書，再幫我準備午餐',
      reply: { answer: '請核對這次安排。', steps: [], cards: [card, foodCard], taskPlan } }],
  };
  const view = render(<AssistantThread {...props} states={{}} />);
  expect(screen.queryByRole('button', { name: /依序確認/ })).toBeNull();
  const confirms = screen.getAllByRole('button', { name: '確認' });
  expect(confirms).toHaveLength(2);
  expect((confirms[1] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(confirms[0]);
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith([card]);
  const states: V2ActionStates = { [card.mutationId]: verified(card) };
  view.rerender(<AssistantThread {...props} states={states} />);
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(onConfirm).toHaveBeenLastCalledWith([foodCard]);
  view.rerender(<AssistantThread {...props} states={{ ...states,
    [foodCard.mutationId]: { status: 'handoff', href: '/food?tenant=pu', message: '請到點餐頁完成操作。' } }} />);
  const region = screen.getByRole('region', { name: '跨功能任務步驟' });
  expect(within(region).getByRole('status').textContent).toBe('已完成 1/2 項');
  expect(within(region).getByText('開啟服務')).toBeTruthy();
  expect(within(region).getByText('服務入口已備妥，請在服務頁面完成後續操作。')).toBeTruthy();
  expect(screen.queryByText('已送出訂單')).toBeNull();
});
