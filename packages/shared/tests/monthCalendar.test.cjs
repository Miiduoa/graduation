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
