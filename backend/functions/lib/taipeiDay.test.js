'use strict';

const { taipeiDateKey, taipeiDayStart, shiftDateKey } = require('./taipeiDay');

test('台灣早上 7:59 和 8:01 是同一天（UTC 在這中間換日）', () => {
  expect(taipeiDateKey(new Date('2026-10-12T23:59:00Z'))).toBe('2026-10-13');
  expect(taipeiDateKey(new Date('2026-10-13T00:01:00Z'))).toBe('2026-10-13');
});

test('台灣 23:59 和 00:01 分在兩天', () => {
  expect(taipeiDateKey(new Date('2026-10-13T15:59:00Z'))).toBe('2026-10-13');
  expect(taipeiDateKey(new Date('2026-10-13T16:01:00Z'))).toBe('2026-10-14');
});

test('台灣某天 00:00 是 UTC 前一天 16:00', () => {
  expect(taipeiDayStart('2026-10-13').toISOString()).toBe('2026-10-12T16:00:00.000Z');
});

test('日期鍵加減天數會跨月、跨年', () => {
  expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  expect(shiftDateKey('2026-10-18', -6)).toBe('2026-10-12');
});

test('時間讀不出來就丟錯，不默默給錯的日期', () => {
  expect(() => taipeiDateKey('not a date')).toThrow(RangeError);
});
