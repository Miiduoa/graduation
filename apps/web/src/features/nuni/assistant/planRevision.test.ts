import { describe, expect, it, vi } from 'vitest';
import type { V2ActionState, V2Card, V2Turn } from './types';
import { buildPlanRevisionQuestion, getPlanRevisionEvents, hasUnresolvedAssistantAction, isUnattemptedCalendarPlan } from './planRevision';

const event = { title: '英文複習', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00' };
function card(id = 'calendar-1', args: Record<string, unknown> = event): V2Card {
  return { tool: 'propose_personal_event', args: { ...args }, token: 'private-token', mutationId: id,
    schoolId: 'private-school', destination: 'private-destination', conversationId: 'private-conversation' };
}
function turn(cards: V2Card[] = [card()]): V2Turn {
  return { question: 'private-original-question', reply: { answer: 'private-answer',
    steps: [{ name: 'private-step', status: 'ok', summary: 'private-summary' }], cards } };
}
const statuses: V2ActionState['status'][] = ['executing', 'checking', 'unknown', 'blocked', 'conflict',
  'absent', 'cancelled', 'superseded', 'handoff', 'verified'];

describe('unattempted calendar plan eligibility', () => {
  it('accepts only a nonempty, valid calendar-only plan with no recorded attempt', () => {
    expect(isUnattemptedCalendarPlan(turn([card(), card('calendar-2')]), {})).toBe(true);
    expect(isUnattemptedCalendarPlan(turn(), { unrelated: { status: 'cancelled' } })).toBe(true);
    expect(isUnattemptedCalendarPlan(turn([]), {})).toBe(false);
    expect(isUnattemptedCalendarPlan(turn([card(), { ...card('page'), tool: 'propose_open_page' }]), {})).toBe(false);
    expect(isUnattemptedCalendarPlan(turn([card('calendar-1', { ...event, endTime: '19:00' })]), {})).toBe(false);
  });

  it.each(statuses)('does not revise a card with %s state', status => {
    expect(isUnattemptedCalendarPlan(turn(), { 'calendar-1': { status } as V2ActionState })).toBe(false);
  });
});

describe('unresolved action guard', () => {
  it.each(['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'] as const)('blocks new planning for %s', status => {
    expect(hasUnresolvedAssistantAction({ unrelated: { status } as V2ActionState })).toBe(true);
  });
  it('allows empty or settled state collections', () => {
    expect(hasUnresolvedAssistantAction({})).toBe(false);
    expect(hasUnresolvedAssistantAction(Object.fromEntries(['cancelled', 'superseded', 'handoff', 'verified']
      .map((status, index) => [String(index), { status } as V2ActionState])))).toBe(false);
  });
});

describe('revision preview snapshot', () => {
  it('preserves all calendar rows and exact times while omitting execution and private metadata', () => {
    const cards = [card(), card('calendar-2', { title: '專題活動', date: '2030-11-05', endDate: '2030-11-07', allDay: true,
      location: 'private-location', source: { rawText: 'private-source' }, token: 'private-arg-token', scope: 'private-scope' })];
    const original = turn(cards);
    const before = JSON.stringify(original);
    const snapshots = getPlanRevisionEvents(original);
    expect(snapshots).toEqual([event, { title: '專題活動', date: '2030-11-05', allDay: true, endDate: '2030-11-07' }]);
    const question = buildPlanRevisionQuestion(original, '  只把英文複習延後一小時  ');
    expect(question).toContain(JSON.stringify(snapshots));
    expect(question).toContain('沒有要求修改的行程請保持原樣');
    expect(question).toContain('這次不要執行、儲存或取消任何行程');
    expect(question).toContain('新確認卡仍須由我另行確認');
    expect(question).toMatch(/修改條件：只把英文複習延後一小時$/);
    expect(question).not.toContain('private-');
    expect(JSON.stringify(original)).toBe(before);
    snapshots[0].title = '修改副本';
    expect(cards[0].args.title).toBe('英文複習');
  });

  it('keeps the end date of an overnight timed event', () => {
    const overnight = { ...event, startTime: '23:30', endTime: '00:30', endDate: '2030-11-05' };
    expect(getPlanRevisionEvents(turn([card('night', overnight)]))).toEqual([overnight]);
  });

  it('does not evaluate metadata getters and rejects getters in calendar details', () => {
    const privateGetter = vi.fn(() => 'private-source');
    const value = card();
    Object.defineProperty(value.args, 'source', { enumerable: true, get: privateGetter });
    expect(getPlanRevisionEvents(turn([value]))).toEqual([event]);
    expect(privateGetter).not.toHaveBeenCalled();
    const titleGetter = vi.fn(() => 'changed title');
    Object.defineProperty(value.args, 'title', { enumerable: true, get: titleGetter });
    expect(() => getPlanRevisionEvents(turn([value]))).toThrow('原安排無法完整核對');
    expect(titleGetter).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'empty', cards: [] },
    { name: 'mixed-tool', cards: [card(), { ...card('food'), tool: 'propose_food_order' }] },
    { name: 'invalid', cards: [card('bad', { ...event, date: '2030-02-30' })] },
  ])('rejects $name snapshots', ({ cards }) => {
    expect(() => buildPlanRevisionQuestion(turn(cards), '延後一小時')).toThrow('原安排無法完整核對');
  });
});

describe('revision request limits', () => {
  it.each(['', ' \t\n '])('rejects blank instruction %j', instruction => {
    expect(() => buildPlanRevisionQuestion(turn(), instruction)).toThrow('請先填寫');
  });
  it('uses trimmed UTF-16 length for the instruction without truncation', () => {
    const exact = '𠮷'.repeat(150);
    expect(buildPlanRevisionQuestion(turn(), ' ' + exact + ' ')).toMatch(new RegExp(exact + '$'));
    expect(() => buildPlanRevisionQuestion(turn(), exact + '字')).toThrow('最多 300 字');
  });
  it('accepts exactly 1000 UTF-16 units and rejects the next unit instead of dropping a row', () => {
    const original = turn(Array.from({ length: 4 }, (_, i) => card('calendar-' + i, { ...event, title: '校'.repeat(75) + i })));
    const base = buildPlanRevisionQuestion(original, '改');
    const instruction = '改'.repeat(1000 - base.length + 1);
    expect(instruction.length).toBeLessThanOrEqual(300);
    expect(buildPlanRevisionQuestion(original, instruction)).toHaveLength(1000);
    expect(() => buildPlanRevisionQuestion(original, instruction + '字')).toThrow('超過 1000 字');
  });
  it('rejects an oversized original plan even for a short instruction', () => {
    const original = turn(Array.from({ length: 8 }, (_, i) => card('calendar-' + i, { ...event, title: '校'.repeat(200) })));
    expect(() => buildPlanRevisionQuestion(original, '改時間')).toThrow('內容不會被截斷');
  });
});
