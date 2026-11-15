import { expect, it, vi } from 'vitest';
import { buildPrecisePlanRevision, type PrecisePlanRevisionChange } from './precisePlanRevision';
import type { V2Card, V2Turn } from './types';

const event = { title: '英文複習', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00' };
function card(id = 'calendar-1', args: Record<string, unknown> = event): V2Card {
  return { tool: 'propose_personal_event', args: { ...args }, token: 'PRIVATE_SIGNED_TOKEN', mutationId: id,
    schoolId: 'fixture-school', destination: 'PRIVATE_DESTINATION', conversationId: 'PRIVATE_CONVERSATION' };
}
function turn(cards: V2Card[] = [card()]): V2Turn {
  return { question: 'PRIVATE_QUESTION', reply: { answer: 'PRIVATE_ANSWER',
    steps: [{ name: 'PRIVATE_STEP', status: 'ok', summary: 'PRIVATE_SUMMARY' }], cards } };
}
function change(patch: Partial<PrecisePlanRevisionChange> = {}): PrecisePlanRevisionChange {
  return { mutationId: 'calendar-1', date: event.date, startTime: '21:00', endTime: '22:00', ...patch };
}

it('changes only the selected timed event and returns complete raw before/after snapshots', () => {
  const others = [card('calendar-2', { ...event, title: '程式練習', startTime: '18:00', endTime: '19:00', endDate: event.date }),
    card('calendar-3', { title: '全天閱讀', date: '2030-11-05', allDay: true })];
  const result = buildPrecisePlanRevision(turn([card(), ...others]), change());
  expect(result.before).toEqual([event, ...others.map(value => value.args)]);
  expect(result.after).toEqual([{ ...event, startTime: '21:00', endTime: '22:00' }, ...others.map(value => value.args)]);
  expect(result.index).toBe(0);
  expect(result.changed).toBe(true);
  expect(result.label).toBe('第 1 項 · 英文複習');
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|token|conversationId|mutationId|destination|schoolId/);
  expect(Object.hasOwn(result.after[0], 'endDate')).toBe(false);
  expect(Object.hasOwn(result.after[1], 'endDate')).toBe(true);
  expect(Object.hasOwn(result.after[2], 'endDate')).toBe(false);
});

it('reports an unchanged interval as a no-op without adding an implicit endDate', () => {
  const result = buildPrecisePlanRevision(turn(), change({ startTime: event.startTime, endTime: event.endTime }));
  expect(result.before).toEqual([event]);
  expect(result.after).toEqual([event]);
  expect(result.changed).toBe(false);
  expect(Object.hasOwn(result.after[0], 'endDate')).toBe(false);
});

it('does not turn an explicitly entered same-day end into a raw-field change when the source omitted it', () => {
  const result = buildPrecisePlanRevision(turn(), change({ endDate: event.date, startTime: event.startTime, endTime: event.endTime }));
  expect(result.after).toEqual([event]);
  expect(result.changed).toBe(false);
  expect(Object.hasOwn(result.after[0], 'endDate')).toBe(false);
});

it('preserves an originally explicit same-day endDate when the edit omits it', () => {
  const original = { ...event, endDate: event.date };
  const result = buildPrecisePlanRevision(turn([card('calendar-1', original)]), change({ startTime: event.startTime, endTime: event.endTime }));
  expect(result.after).toEqual([original]);
  expect(result.changed).toBe(false);
  expect(Object.hasOwn(result.after[0], 'endDate')).toBe(true);
});

it('moves an interval to another same-day date without carrying the old date forward', () => {
  const result = buildPrecisePlanRevision(turn(), change({ date: '2030-11-08' }));
  expect(result.after).toEqual([{ ...event, date: '2030-11-08', startTime: '21:00', endTime: '22:00' }]);
  expect(result.changed).toBe(true);
});

it('creates an explicit cross-day endDate and preserves the event title and allDay flag', () => {
  const result = buildPrecisePlanRevision(turn(), change({ date: '2030-11-30', endDate: '2030-12-01', startTime: '23:30', endTime: '00:30' }));
  expect(result.after).toEqual([{ ...event, date: '2030-11-30', endDate: '2030-12-01', startTime: '23:30', endTime: '00:30' }]);
  expect(result.changed).toBe(true);
});

it('returns a cross-day source to one day while keeping its explicit endDate field', () => {
  const original = { ...event, endDate: '2030-11-05', startTime: '23:00', endTime: '01:00' };
  const result = buildPrecisePlanRevision(turn([card('calendar-1', original)]), change({ date: '2030-11-07' }));
  expect(result.before).toEqual([original]);
  expect(result.after).toEqual([{ ...event, date: '2030-11-07', endDate: '2030-11-07', startTime: '21:00', endTime: '22:00' }]);
});

it('accepts a valid leap-day interval and the exact 31 calendar-day limit', () => {
  const leap = buildPrecisePlanRevision(turn(), change({ date: '2032-02-29', endDate: '2032-03-01', startTime: '23:59', endTime: '00:00' }));
  expect(leap.after[0]).toMatchObject({ date: '2032-02-29', endDate: '2032-03-01' });
  // Calendar-date difference is 31, even though elapsed duration exceeds 31 * 24 hours.
  const longest = buildPrecisePlanRevision(turn(), change({ endDate: '2030-12-05', startTime: '20:00', endTime: '21:00' }));
  expect(longest.after[0].endDate).toBe('2030-12-05');
});

it('rejects a date span beyond 31 days instead of shortening or splitting the proposal', () => {
  const original = turn();
  expect(() => buildPrecisePlanRevision(original, change({ endDate: '2030-12-06' }))).toThrow();
  expect(original.reply.cards[0].args).toEqual(event);
});

it.each([
  { date: '2030-02-29' }, { date: '2030-11-31' }, { date: '2030-1-04' }, { date: '2030-11-04T00:00:00Z' },
  { endDate: '2030-11-03' }, { endDate: '2030-11-31' }, { startTime: '24:00' }, { endTime: '21:60' },
  { startTime: '9:00' }, { startTime: '21:00:00' }, { startTime: '22:00', endTime: '22:00' },
  { startTime: '23:00', endTime: '01:00' },
])('rejects malformed or nonpositive intervals: %j', patch => {
  expect(() => buildPrecisePlanRevision(turn(), change(patch))).toThrow();
});

it('selects the exact mutation ID when titles are equal', () => {
  const first = card('calendar-1', { ...event, startTime: '18:00', endTime: '19:00' });
  const second = card('calendar-2');
  const result = buildPrecisePlanRevision(turn([first, second]), change({ mutationId: 'calendar-2' }));
  expect(result.index).toBe(1);
  expect(result.label).toBe('第 2 項 · 英文複習');
  expect(result.after[0]).toEqual(first.args);
  expect(result.after[1]).toEqual({ ...event, startTime: '21:00', endTime: '22:00' });
});

it('can change one of two exact duplicate rows by its own mutation ID without silently changing both', () => {
  const original = turn([card('calendar-1'), card('calendar-2')]);
  const result = buildPrecisePlanRevision(original, change({ mutationId: 'calendar-2' }));
  expect(result.index).toBe(1);
  expect(result.before).toEqual([event, event]);
  expect(result.after).toEqual([event, { ...event, startTime: '21:00', endTime: '22:00' }]);
  expect(original.reply.cards.map(value => value.args)).toEqual([event, event]);
});

it('rejects an unknown target rather than matching the same title or selecting the first row', () => {
  expect(() => buildPrecisePlanRevision(turn([card(), card('calendar-2')]), change({ mutationId: 'missing' }))).toThrow();
});

it('rejects an all-day target while allowing an untouched all-day row in the plan', () => {
  const allDay = card('all-day', { title: '全天閱讀', date: event.date, allDay: true });
  expect(() => buildPrecisePlanRevision(turn([allDay]), change({ mutationId: 'all-day' }))).toThrow();
  expect(buildPrecisePlanRevision(turn([allDay, card()]), change()).after[0]).toEqual(allDay.args);
});

it.each([
  { title: '未經要求重新命名' }, { allDay: true }, { token: 'PRIVATE_TOKEN' }, { endDate: undefined }, { endDate: null },
])('rejects extra or explicitly invalid change fields: %j', patch => {
  expect(() => buildPrecisePlanRevision(turn(), { ...change(), ...patch } as never)).toThrow();
});

it('rejects accessors in change or source details without invoking them', () => {
  const changeGetter = vi.fn(() => event.date);
  const edited = Object.defineProperty(change(), 'date', { enumerable: true, get: changeGetter });
  expect(() => buildPrecisePlanRevision(turn(), edited)).toThrow();
  expect(changeGetter).not.toHaveBeenCalled();
  const sourceGetter = vi.fn(() => event.title);
  const value = card();
  Object.defineProperty(value.args, 'title', { enumerable: true, get: sourceGetter });
  expect(() => buildPrecisePlanRevision(turn([value]), change())).toThrow();
  expect(sourceGetter).not.toHaveBeenCalled();
});

it('rejects inherited or missing required change fields and non-object changes', () => {
  const inherited = Object.assign(Object.create({ date: event.date }), {
    mutationId: 'calendar-1', startTime: '21:00', endTime: '22:00',
  });
  expect(() => buildPrecisePlanRevision(turn(), inherited)).toThrow();
  expect(() => buildPrecisePlanRevision(turn(), { date: event.date, startTime: '21:00', endTime: '22:00' } as never)).toThrow();
  expect(() => buildPrecisePlanRevision(turn(), null as never)).toThrow();
  expect(() => buildPrecisePlanRevision(turn(), [] as never)).toThrow();
});

it.each([
  { name: 'empty', cards: [] },
  { name: 'duplicate mutation IDs', cards: [card(), card()] },
  { name: 'mixed schools', cards: [card(), { ...card('calendar-2'), schoolId: 'another-school' }] },
  { name: 'mixed tools', cards: [card(), { ...card('calendar-2'), tool: 'propose_open_page' }] },
  { name: 'more than sixteen rows', cards: Array.from({ length: 17 }, (_, index) => card('calendar-' + index)) },
  { name: 'invalid original date', cards: [card('calendar-1', { ...event, date: '2030-02-30' })] },
  { name: 'unknown signed argument', cards: [card('calendar-1', { ...event, location: 'PRIVATE_LOCATION' })] },
  { name: 'undefined raw optional field', cards: [card('calendar-1', { ...event, endDate: undefined })] },
])('rejects $name before producing a candidate', ({ cards }) => {
  expect(() => buildPrecisePlanRevision(turn(cards), change())).toThrow();
});

it('accepts exactly sixteen valid rows and leaves every other raw event intact', () => {
  const original = turn(Array.from({ length: 16 }, (_, index) => card('calendar-' + index,
    index % 2 ? { ...event, endDate: event.date } : event)));
  const result = buildPrecisePlanRevision(original, change({ mutationId: 'calendar-15' }));
  expect(result.index).toBe(15);
  expect(result.after.slice(0, 15)).toEqual(original.reply.cards.slice(0, 15).map(value => value.args));
  expect(result.after[15]).toEqual({ ...event, endDate: event.date, startTime: '21:00', endTime: '22:00' });
});

it('does not mutate frozen signed cards, the turn, or the submitted change, and returns detached snapshots', () => {
  const original = turn([card(), card('calendar-2')]);
  const edited = change();
  const originalJson = JSON.stringify(original), editedJson = JSON.stringify(edited);
  for (const value of original.reply.cards) { Object.freeze(value.args); Object.freeze(value); }
  Object.freeze(original.reply.cards); Object.freeze(original.reply); Object.freeze(original); Object.freeze(edited);
  const result = buildPrecisePlanRevision(original, edited);
  expect(JSON.stringify(original)).toBe(originalJson);
  expect(JSON.stringify(edited)).toBe(editedJson);
  result.before[0].title = '修改回傳副本';
  result.after[1].title = '修改其他回傳副本';
  expect(JSON.stringify(original)).toBe(originalJson);
});
