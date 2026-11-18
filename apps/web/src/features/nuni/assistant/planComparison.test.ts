import { describe, expect, it, vi } from 'vitest';
import { comparePlanRevision, type PlanComparison, type PlanComparisonEvent } from './planComparison';

const event = (title = '微積分複習', startTime = '19:00', endTime = '19:30', extra: Record<string, unknown> = {}) =>
  ({ title, date: '2030-11-12', allDay: false, startTime, endTime, ...extra });
function available(before: unknown, after: unknown): Extract<PlanComparison, { kind: 'available' }> {
  const result = comparePlanRevision(before, after);
  if (result.kind !== 'available') throw new Error(result.message);
  return result;
}
const normalized = (value: ReturnType<typeof event>): PlanComparisonEvent => ({ ...value, endDate: String(('endDate' in value && value.endDate) || value.date) });

describe('proposal content comparison', () => {
  it('reports only changed time fields and keeps unchanged rows as a count', () => {
    const a = event(), b = event('英文閱讀', '20:00', '20:30');
    const changed = event('英文閱讀', '21:00', '21:30');
    const result = available([a, b], [a, changed]);
    expect(result).toMatchObject({ unchanged: 1, added: [], removed: [], ambiguous: { before: [], after: [] }, orderChanged: false });
    expect(result.modified).toEqual([{ before: normalized(b), after: normalized(changed), basis: 'title', fields: [
      { field: 'startTime', before: '20:00', after: '21:00' }, { field: 'endTime', before: '20:30', after: '21:30' },
    ] }]);
  });

  it('uses an exact unique schedule to identify a title-only proposal change', () => {
    const result = available([event()], [event('資料結構複習')]);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]).toMatchObject({ basis: 'schedule', fields: [{ field: 'title', before: '微積分複習', after: '資料結構複習' }] });
  });

  it('keeps cross-day endpoint dates exact and excludes unchanged endpoint fields', () => {
    const before = event('跨日複習', '23:30', '00:30', { endDate: '2030-11-13' });
    const after = event('跨日複習', '00:15', '01:30', { date: '2030-11-13', endDate: '2030-11-13' });
    const result = available([before], [after]);
    expect(result.modified[0].fields).toEqual([
      { field: 'date', before: '2030-11-12', after: '2030-11-13' },
      { field: 'startTime', before: '23:30', after: '00:15' },
      { field: 'endTime', before: '00:30', after: '01:30' },
    ]);
  });

  it('normalizes omitted end dates using existing timed and exclusive all-day semantics', () => {
    const timed = event();
    const allDay = { title: '全天活動', date: '2030-12-31', allDay: true };
    expect(available([timed], [{ ...timed, endDate: timed.date }])).toMatchObject({ unchanged: 1, modified: [] });
    expect(available([allDay], [{ ...allDay, endDate: '2031-01-01' }])).toMatchObject({ unchanged: 1, modified: [] });
    const extended = available([allDay], [{ ...allDay, endDate: '2031-01-02' }]);
    expect(extended.modified[0].fields).toEqual([{ field: 'endDate', before: '2031-01-01', after: '2031-01-02' }]);
    expect(extended.modified[0].before.endDate).toBe('2031-01-01');
  });

  it('reports the all-day transition and removed times as actual field differences', () => {
    const before = event();
    const after = { title: before.title, date: before.date, allDay: true };
    expect(available([before], [after]).modified[0].fields).toEqual([
      { field: 'endDate', before: '2030-11-12', after: '2030-11-13' },
      { field: 'allDay', before: false, after: true },
      { field: 'startTime', before: '19:00', after: null }, { field: 'endTime', before: '19:30', after: null },
    ]);
  });

  it('distinguishes pure additions and removals without mistaking an index shift for reorder', () => {
    const a = event(), b = event('英文閱讀', '20:00', '20:30');
    expect(available([a], [b, a])).toMatchObject({ unchanged: 1, added: [normalized(b)], removed: [], modified: [], orderChanged: false });
    expect(available([a, b], [b])).toMatchObject({ unchanged: 1, added: [], removed: [normalized(a)], modified: [], orderChanged: false });
    expect(available([], [a])).toMatchObject({ unchanged: 0, added: [normalized(a)], removed: [] });
    expect(available([a], [])).toMatchObject({ unchanged: 0, added: [], removed: [normalized(a)] });
    expect(available([], [])).toEqual({ kind: 'available', unchanged: 0, modified: [], added: [], removed: [], ambiguous: { before: [], after: [] }, orderChanged: false });
  });

  it('reports a proven reorder without matching by array position or changing field values', () => {
    const a = event(), b = event('英文閱讀', '20:00', '20:30');
    expect(available([a, b], [b, a])).toMatchObject({ unchanged: 2, modified: [], added: [], removed: [], orderChanged: true });
    expect(available([a, a, b], [b, a, a])).toMatchObject({ unchanged: 3, modified: [], orderChanged: true });
    expect(available([a, a], [a, a])).toMatchObject({ unchanged: 2, modified: [], orderChanged: false });
    const changedB = event('英文閱讀', '21:00', '21:30');
    expect(available([a, b], [changedB, a])).toMatchObject({ unchanged: 1, modified: [{ basis: 'title' }], orderChanged: true });
  });

  it.each([
    { name: 'proves reorder when every copy of A follows B', order: ['B', 'A', 'A'], changed: true },
    { name: 'allows the original order when an extra A follows A and B', order: ['A', 'B', 'A'], changed: false },
  ])('$name', ({ order, changed }) => {
    const a = event('A'), b = event('B', '20:00', '20:30');
    const result = available([a, b], order.map(title => title === 'A' ? a : b));
    expect(result).toMatchObject({ unchanged: 2, modified: [], added: [normalized(a)], removed: [],
      ambiguous: { before: [], after: [] }, orderChanged: changed });
  });

  it('lists modified rows in new-card order when changed events are also reordered', () => {
    const before = [event('A'), event('B', '20:00', '20:30')];
    const after = [event('B', '21:00', '21:30'), event('A', '22:00', '22:30')];
    const result = available(before, after);
    expect(result.orderChanged).toBe(true);
    expect(result.modified.map(change => change.after.title)).toEqual(['B', 'A']);
    expect(result.modified.map(change => change.before.startTime)).toEqual(['20:00', '19:00']);
    expect(result.modified.every(change => change.basis === 'title')).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('counts exact duplicates with multiplicity rather than collapsing them', () => {
    const a = event();
    expect(available([a, a, a], [a, a])).toMatchObject({ unchanged: 2, removed: [normalized(a)], modified: [], ambiguous: { before: [], after: [] } });
    expect(available([a], [a, a])).toMatchObject({ unchanged: 1, added: [normalized(a)], modified: [] });
  });

  it('does not use title uniqueness created only after an unchanged duplicate was removed', () => {
    const first = event('複習'), second = event('複習', '20:00', '20:30'), changed = event('複習', '21:00', '21:30');
    expect(available([first, second], [first, changed])).toMatchObject({ unchanged: 1, modified: [], added: [], removed: [],
      ambiguous: { before: [normalized(second)], after: [normalized(changed)] }, orderChanged: false });
  });

  it('does not use schedule uniqueness created only after an unchanged same-time row was removed', () => {
    const a = event(), b = event('英文閱讀'), renamed = event('新的複習');
    expect(available([a, b], [renamed, b])).toMatchObject({ unchanged: 1, modified: [], added: [], removed: [],
      ambiguous: { before: [normalized(a)], after: [normalized(renamed)] } });
  });

  it('leaves conflicting title and schedule anchors independent rather than choosing either', () => {
    const a = event('A'), b = event('B', '20:00', '20:30');
    const newA = event('A', '20:00', '20:30'), newB = event('B');
    expect(available([a, b], [newA, newB])).toMatchObject({ unchanged: 0, modified: [], added: [], removed: [],
      ambiguous: { before: [normalized(a), normalized(b)], after: [normalized(newA), normalized(newB)] }, orderChanged: false });
  });

  it('requires uniqueness at both ends when two old events point to the same new event', () => {
    const a = event('A'), b = event('B', '20:00', '20:30'), newA = event('A', '20:00', '20:30');
    expect(available([a, b], [newA])).toMatchObject({ modified: [], added: [], removed: [],
      ambiguous: { before: [normalized(a), normalized(b)], after: [normalized(newA)] } });
  });

  it('does not guess a renamed and rescheduled event, or call it a definite remove/add', () => {
    const before = event('英文閱讀'), after = event('英文閱讀進階', '20:00', '20:30');
    expect(available([before], [after])).toMatchObject({ unchanged: 0, modified: [], added: [], removed: [],
      ambiguous: { before: [normalized(before)], after: [normalized(after)] } });
  });

  it('never pairs two same-name moved rows by index or nearest time', () => {
    const before = [event('複習'), event('複習', '20:00', '20:30')];
    const after = [event('複習', '19:15', '19:45'), event('複習', '21:00', '21:30')];
    expect(available(before, after)).toMatchObject({ unchanged: 0, modified: [], added: [], removed: [],
      ambiguous: { before: before.map(normalized), after: after.map(normalized) }, orderChanged: false });
  });

  it('ignores execution metadata without mutating input or exposing private fields', () => {
    const privateGetter = vi.fn(() => 'private-source');
    const before = { ...event(), mutationId: 'old-mutation', token: 'old-secret', schoolId: 'private-school', location: 'private-location' };
    Object.defineProperty(before, 'source', { enumerable: true, get: privateGetter });
    const after = { ...event(), mutationId: 'new-mutation', token: 'new-secret' };
    const result = available([Object.freeze(before)], [Object.freeze(after)]);
    expect(result).toMatchObject({ unchanged: 1, modified: [], added: [], removed: [] });
    expect(privateGetter).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/mutation|secret|private/);
    expect(before.mutationId).toBe('old-mutation');
  });
});

describe('missing or invalid comparison snapshots', () => {
  it.each([undefined, null, {}, 'not-a-list'])('reports unavailable for missing/nonarray %j', value => {
    expect(comparePlanRevision(value, [event()])).toMatchObject({ kind: 'unavailable' });
    expect(comparePlanRevision([event()], value)).toMatchObject({ kind: 'unavailable' });
  });
  it.each([
    { row: {} }, { row: { ...event(), date: '2030-02-30' } }, { row: { ...event(), endTime: '18:00' } },
    { row: { ...event(), allDay: true } }, { row: { ...event(), endDate: null } }, { row: { ...event(), title: undefined } },
  ])('does not discard an invalid row and call the rest unchanged', ({ row }) => {
    expect(comparePlanRevision([event(), row], [event()])).toMatchObject({ kind: 'unavailable' });
  });
  it('does not evaluate field or array-entry getters, and rejects holes', () => {
    const getter = vi.fn(() => 'secret');
    const row = { ...event() };
    Object.defineProperty(row, 'title', { enumerable: true, get: getter });
    expect(comparePlanRevision([row], [event()])).toMatchObject({ kind: 'unavailable' });
    const rows: unknown[] = [];
    Object.defineProperty(rows, '0', { get: getter });
    expect(comparePlanRevision(rows, [])).toMatchObject({ kind: 'unavailable' });
    expect(comparePlanRevision(new Array(1), [])).toMatchObject({ kind: 'unavailable' });
    expect(getter).not.toHaveBeenCalled();
  });
});
