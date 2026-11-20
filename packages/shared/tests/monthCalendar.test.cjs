/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const {
  buildMonthCalendar,
  shiftCalendarMonth,
  personalEventsOnDate,
} = require('../src/imports/monthCalendar.ts');
require.extensions['.ts'] = original;

test('閏年、跨年與週日起始欄位', () => {
  assert.equal(shiftCalendarMonth('2024-12', 1), '2025-01');
  assert.equal(shiftCalendarMonth('2025-01', -1), '2024-12');
  const cells = buildMonthCalendar([], '2024-02');
  assert.equal(cells.filter(Boolean).length, 29);
  assert.equal(cells[4].date, '2024-02-01');
  assert.equal(buildMonthCalendar([], '2023-02').filter(Boolean).length, 28);
  assert.equal(buildMonthCalendar([], '2026-11')[0].date, '2026-11-01');
});

test('全天跨月不依環境時區轉日，也不改起訖', () => {
  const row = Object.freeze({
    id: 'synthetic',
    kind: 'events',
    title: '合成活動',
    date: '2024-02-29',
    endDate: '2024-03-02',
    allDay: true,
  });
  assert.equal(personalEventsOnDate([row], '2024-02-29')[0], row);
  assert.equal(personalEventsOnDate([row], '2024-03-01')[0], row);
  assert.deepEqual(personalEventsOnDate([row], '2024-03-02'), []);
  assert.equal(row.date, '2024-02-29');
  assert.equal(row.endDate, '2024-03-02');
  assert.equal(
    buildMonthCalendar([row], '2024-03').find((day) => day?.date === '2024-03-01').events[0],
    row,
  );
});

test('排序後直接分桶與逐日查詢一致，保留順序與事件物件', () => {
  const rows = [
    { id: 'late', date: '2024-03-12', startTime: '18:00' },
    { id: 'all-day', date: '2024-02-28', endDate: '2024-03-03', allDay: true },
    { id: 'midnight', date: '2024-02-29', endDate: '2024-03-02', endTime: '00:00' },
    { id: 'timed', date: '2024-03-01', endDate: '2024-03-04', endTime: '10:00' },
    { id: 'early', date: '2024-03-12', startTime: '08:00' },
    { id: 'next-month', date: '2024-03-30', endDate: '2024-04-02', allDay: true },
    { id: 'invalid', date: '2024-02-30' },
    { id: 'same-day', date: '2024-03-05', endDate: '2024-03-05', allDay: true },
  ].map((row) => Object.freeze({ kind: 'events', title: row.id, ...row }));
  const records = Object.freeze(rows);
  for (const month of ['2024-02', '2024-03', '2024-04']) {
    for (const day of buildMonthCalendar(records, month).filter(Boolean)) {
      const expected = personalEventsOnDate(records, day.date);
      assert.deepEqual(day.events, expected);
      day.events.forEach((event, i) => assert.equal(event, expected[i]));
    }
  }
});
