import { describe, expect, it } from 'vitest';
import { buildShiftPlanRevision } from './shiftPlanRevision';
import type { V2Turn } from './types';

const turn = (): V2Turn => ({ question: '請排三段', reply: { answer: '待核對', steps: [], cards: [
  { tool: 'propose_personal_event', schoolId: 'pu', token: 'signed-a', mutationId: 'a', destination: '個人行程',
    args: { title: '讀書', date: '2030-12-31', allDay: false, startTime: '22:00', endTime: '22:30' } },
  { tool: 'propose_personal_event', schoolId: 'pu', token: 'signed-b', mutationId: 'b', destination: '個人行程',
    args: { title: '讀書', date: '2030-12-31', allDay: false, startTime: '23:40', endTime: '23:55' } },
] } });

describe('current-source group time revision', () => {
  it('selects by exact current ID despite equal names and reversed request order, preserving signed cards', () => {
    const source = turn(), before = JSON.stringify(source);
    const value = buildShiftPlanRevision(source, { mutationIds: ['b', 'a'], offsetMinutes: 30 });
    expect(value.selectedIndices).toEqual([0, 1]);
    expect(value.after).toEqual([
      { title: '讀書', date: '2030-12-31', allDay: false, startTime: '22:30', endTime: '23:00' },
      { title: '讀書', date: '2031-01-01', allDay: false, startTime: '00:10', endTime: '00:25' },
    ]);
    expect(value.label).toBe('2 項延後 30 分鐘');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('preserves an explicitly locked equal-name item while moving the other earlier', () => {
    const source = turn();
    const value = buildShiftPlanRevision(source, { mutationIds: ['b'], offsetMinutes: -30 }, [0]);
    expect(value.after[0]).toEqual(source.reply.cards[0].args);
    expect(value.after[1].startTime).toBe('23:10');
    expect(value.label).toBe('1 項提前 30 分鐘');
    expect(() => buildShiftPlanRevision(source, { mutationIds: ['a'], offsetMinutes: 30 }, [0])).toThrow(/保留原樣/);
  });

  it.each([[], ['a', 'a'], ['old-a'], ['a', 'b', 'c']].map(mutationIds => ({ mutationIds })))('rejects empty, repeated or non-source choices $mutationIds', ({ mutationIds }) => {
    expect(() => buildShiftPlanRevision(turn(), { mutationIds, offsetMinutes: 30 })).toThrow();
  });

  it('rejects a different school or non-calendar source, rather than shifting a partial plan', () => {
    const source = turn(); source.reply.cards[1].schoolId = 'other-school';
    expect(() => buildShiftPlanRevision(source, { mutationIds: ['a'], offsetMinutes: 30 })).toThrow(/原提議/);
    source.reply.cards[1].schoolId = 'pu'; source.reply.cards[1].tool = 'place_order';
    expect(() => buildShiftPlanRevision(source, { mutationIds: ['a'], offsetMinutes: 30 })).toThrow(/原提議/);
  });
});
