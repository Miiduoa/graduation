import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canConfirmAction, firstUnverifiedCalendarAction, isAssistantCalendarActionReady,
  priorCalendarActionHint, priorCalendarActionsVerified,
  withAssistantRequestDeadline,
} from './execution';
import type { V2ActionState, V2ActionStates, V2Card } from './types';

afterEach(() => vi.useRealTimers());

it('releases a hung request at its own deadline without cancelling the conversation', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  let requestSignal!: AbortSignal;
  let finish!: (value: string) => void;
  const outcome = withAssistantRequestDeadline(lifetime.signal, 15000, (signal) => {
    requestSignal = signal;
    return new Promise<string>((resolve) => { finish = resolve; });
  }).catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await outcome).toBeInstanceOf(Error);
  expect((await outcome as Error).message).toContain('連線逾時');
  expect(requestSignal.aborted).toBe(true);
  expect(lifetime.signal.aborted).toBe(false);
  finish('late success');
  expect(await outcome).toBeInstanceOf(Error);
  expect(await withAssistantRequestDeadline(lifetime.signal, 15000, async () => 'later read')).toBe('later read');
  expect(vi.getTimerCount()).toBe(0);
});

it('stops an old scope immediately even when the transport ignores AbortSignal', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  let requestSignal!: AbortSignal;
  const outcome = withAssistantRequestDeadline(lifetime.signal, 15000, (signal) => {
    requestSignal = signal;
    return new Promise<string>(() => {});
  }).catch((error: Error) => error);
  lifetime.abort();
  expect((await outcome as Error).message).toBe('已取消');
  expect(requestSignal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const work = vi.fn();
  await expect(withAssistantRequestDeadline(lifetime.signal, 15000, work)).rejects.toThrow('已取消');
  expect(work).not.toHaveBeenCalled();
});

it('clears its deadline after a completed request', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  expect(await withAssistantRequestDeadline(lifetime.signal, 15000, async () => 1)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

const calendarCard = (mutationId: string): V2Card => ({
  tool: 'propose_personal_event', token: 'signed-' + mutationId, mutationId, schoolId: 'pu',
  destination: '個人行事曆', coursework: true,
  args: { title: '準備資料庫作業', date: '2030-11-04', allDay: false, startTime: '11:00', endTime: '11:30' },
});
type VerifiedState = Extract<V2ActionState, { status: 'verified' }>;
function verified(card: V2Card): VerifiedState {
  return {
    status: 'verified', local: 'ready', receipt: createAssistantCalendarReceipt({
      schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
      revision: 1, verifiedAt: '2030-11-04T02:30:00.000Z',
      record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
        schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2030-11-04T02:29:00.000Z',
        source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
    }),
  };
}
const incompleteReadbacks: { name: string; patch: Partial<VerifiedState> }[] = [
  { name: 'local mirror unavailable', patch: { local: 'unavailable', localMessage: '此裝置尚未更新' } },
  { name: 'follow-up verification warning', patch: { verificationWarning: '安排追蹤尚未接續' } },
  { name: 'local mirror and follow-up unavailable', patch: {
    local: 'unavailable', localMessage: '此裝置尚未更新', verificationWarning: '這次查核未完成',
  } },
];

describe('calendar confirmation dependencies', () => {
  it('allows the next calendar action only after preceding receipts are locally ready without warnings', () => {
    const first = calendarCard('calendar-ready-first'), next = calendarCard('calendar-ready-next');
    const states: V2ActionStates = { [first.mutationId]: verified(first) };
    expect(isAssistantCalendarActionReady(states[first.mutationId])).toBe(true);
    expect(isAssistantCalendarActionReady(undefined)).toBe(false);
    expect(priorCalendarActionsVerified([first, next], 1, states)).toBe(true);
    expect(firstUnverifiedCalendarAction([first, next], 1, states)).toBeUndefined();
    expect(canConfirmAction(states[first.mutationId])).toBe(false);
    expect(canConfirmAction(states[next.mutationId])).toBe(true);
  });

  it.each(incompleteReadbacks)('keeps $name on the original read-only recheck and blocks the next confirmation', ({ patch }) => {
    const settled = calendarCard('calendar-settled');
    const original = calendarCard('calendar-original');
    const next = calendarCard('calendar-next');
    const page: V2Card = { tool: 'propose_open_page', args: { page: 'calendar' },
      mutationId: 'page-calendar', schoolId: 'pu', token: 'signed-page-calendar', destination: '/calendar' };
    const state: VerifiedState = { ...verified(original), ...patch };
    const states: V2ActionStates = { [settled.mutationId]: verified(settled), [original.mutationId]: state };
    const cards = [settled, page, original, next];
    const before = JSON.stringify({ cards, states });

    // A server receipt is retained evidence, never permission to submit it again.
    expect(canConfirmAction(state)).toBe(false);
    expect(isAssistantCalendarActionReady(state)).toBe(false);
    expect(priorCalendarActionsVerified(cards, 3, states)).toBe(false);
    expect(firstUnverifiedCalendarAction(cards, 3, states)).toBe(original);
    expect(priorCalendarActionHint(cards, 3, states)).toContain('已儲存');
    expect(priorCalendarActionHint(cards, 3, states)).toContain('重新核對原操作');
    expect(state.receipt.mutationId).toBe(original.mutationId);
    expect(JSON.stringify({ cards, states })).toBe(before);

    // Only a completed recheck of this same action clears the dependency.
    const checked: V2ActionStates = {
      ...states, [original.mutationId]: { status: 'verified', local: 'ready', receipt: state.receipt },
    };
    expect(priorCalendarActionsVerified(cards, 3, checked)).toBe(true);
    expect(firstUnverifiedCalendarAction(cards, 3, checked)).toBeUndefined();
    expect(isAssistantCalendarActionReady(checked[original.mutationId])).toBe(true);
    expect(priorCalendarActionHint(cards, 3, checked)).toBeNull();
    expect(canConfirmAction(checked[original.mutationId])).toBe(false);
  });
});
