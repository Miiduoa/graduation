import { afterEach, expect, it, vi } from 'vitest';
import { buildPlanShift } from './assistantPlanShift';
import type { PlanProtectionEvent } from './assistantPlanProtection';

const first: PlanProtectionEvent = { title: '同名讀書', date: '2026-11-06', allDay: false, startTime: '18:00', endTime: '19:00' };
const second: PlanProtectionEvent = { ...first, endDate: first.date, startTime: '20:00', endTime: '21:00' };
const holiday: PlanProtectionEvent = { title: '不移動的全天', date: '2026-11-10', allDay: true };
const endpoints = (event: PlanProtectionEvent) => [
  Date.parse(`${event.date}T${event.startTime}:00+08:00`),
  Date.parse(`${event.endDate ?? event.date}T${event.endTime}:00+08:00`),
];
afterEach(() => vi.unstubAllEnvs());

it.each([90, -90, 1440, -1440])('translates the selected group by %i minutes with exact durations, spacing, source order and fixed rows', offset => {
  const source = [Object.freeze({ ...first }), Object.freeze({ ...second }), Object.freeze({ ...holiday })];
  const result = buildPlanShift(Object.freeze(source), [1, 0], offset, [2]);
  expect(result.selectedIndices).toEqual([0, 1]);
  expect(result.protectedIndices).toEqual([2]);
  expect(result.before).toEqual(source);
  expect(result.after[2]).toEqual(holiday);
  expect(Object.hasOwn(result.after[0], 'endDate')).toBe(false);
  expect(Object.hasOwn(result.after[1], 'endDate')).toBe(true);
  for (const index of [0, 1]) {
    const before = endpoints(source[index]), after = endpoints(result.after[index]);
    expect(after).toEqual(before.map(value => value + offset * 60000));
    expect(after[1] - after[0]).toBe(before[1] - before[0]);
    expect(result.after[index].title).toBe(source[index].title);
    expect(result.after[index].allDay).toBe(false);
  }
  expect(endpoints(result.after[1])[0] - endpoints(result.after[0])[1]).toBe(3600000);
});

it('uses signed positions rather than names for a locked item and a selected same-name item', () => {
  const result = buildPlanShift([first, second], [1], 60, [0]);
  expect(result.after).toEqual([first, { ...second, startTime: '21:00', endTime: '22:00' }]);
});

it('adds endDate only when needed by a new cross-day interval and preserves originally explicit presence', () => {
  expect(buildPlanShift([{ ...first, date: '2027-01-01', startTime: '00:15', endTime: '01:00' }], [0], -30).after)
    .toEqual([{ ...first, date: '2026-12-31', endDate: '2027-01-01', startTime: '23:45', endTime: '00:30' }]);
  expect(buildPlanShift([{ ...first, date: '2026-12-31', startTime: '23:30', endTime: '23:45' }], [0], 60).after)
    .toEqual([{ ...first, date: '2027-01-01', startTime: '00:30', endTime: '00:45' }]);
  expect(buildPlanShift([{ ...first, date: '2026-12-31', endDate: '2027-01-01', startTime: '23:30', endTime: '00:30' }], [0], 60).after)
    .toEqual([{ ...first, date: '2027-01-01', endDate: '2027-01-01', startTime: '00:30', endTime: '01:30' }]);
});

it.each(['UTC', 'America/New_York', 'Asia/Taipei'])('keeps leap-day arithmetic independent of host TZ %s', timezone => {
  vi.stubEnv('TZ', timezone);
  const event = { ...first, date: '2028-02-28', endDate: '2028-02-29', startTime: '23:30', endTime: '00:30' };
  expect(buildPlanShift([event], [0], 1440).after).toEqual([
    { ...event, date: '2028-02-29', endDate: '2028-03-01' },
  ]);
});

it.each([0, -0, 1441, -1441, 1.5, NaN, Infinity, '30', null, undefined])('rejects invalid offset %s', offset => {
  expect(() => buildPlanShift([first], [0], offset)).toThrow('非零整數');
});
it.each([[], [0, 0], [-1], [2], [0.5], ['0'], new Array(1), Array(17).fill(0)].map(selected => ({ selected })))('rejects invalid selected indices $selected', ({ selected }) => {
  expect(() => buildPlanShift([first, second], selected, 30)).toThrow();
});
it.each([[0, 0], [2], ['0'], new Array(1)].map(protectedIndices => ({ protectedIndices })))('rejects invalid protected indices $protectedIndices', ({ protectedIndices }) => {
  expect(() => buildPlanShift([first, second], [1], 30, protectedIndices)).toThrow();
});
it('rejects overlapping protected selection and selected all-day events as whole operations', () => {
  expect(() => buildPlanShift([first, second], [0, 1], 30, [1])).toThrow('保留原樣');
  expect(() => buildPlanShift([first, holiday], [0, 1], 30)).toThrow('全天');
});
it('rejects out-of-range dates and a translated calendar span exceeding 31 days', () => {
  expect(() => buildPlanShift([{ ...first, date: '1900-01-01', startTime: '00:00', endTime: '00:30' }], [0], -1)).toThrow();
  expect(() => buildPlanShift([{ ...first, date: '2200-12-31', startTime: '23:00', endTime: '23:30' }], [0], 60)).toThrow();
  const long = { ...first, date: '2026-01-01', endDate: '2026-02-01', startTime: '00:30', endTime: '23:30' };
  expect(() => buildPlanShift([long], [0], 60)).toThrow('31 天');
});
it('accepts at most sixteen source items without calling index accessors', () => {
  const source = Array.from({ length: 16 }, (_, index) => ({ ...first, title: `項目${index}` }));
  expect(buildPlanShift(source, [15], 1).after).toHaveLength(16);
  expect(() => buildPlanShift([...source, first], [0], 1)).toThrow();
  const getter = vi.fn(() => 0), selected: number[] = [];
  Object.defineProperty(selected, '0', { get: getter, enumerable: true });
  expect(() => buildPlanShift([first], selected, 1)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
