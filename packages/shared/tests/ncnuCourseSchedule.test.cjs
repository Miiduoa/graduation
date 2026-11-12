/* eslint-disable @typescript-eslint/no-require-imports */
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
const { ncnuCourseMeetings, ncnuTimetableImportCsv } = require('../src/ncnuCourseSchedule.ts');
const { parsePersonalImport } = require('../src/imports/parser.ts');
require.extensions['.ts'] = original;

test('the verified 114-2 and 115-1 timetable keeps the revised afternoon and night hours', () => {
  for (const semester of ['1142', '1151']) {
    assert.deepEqual(ncnuCourseMeetings('4efg7m', semester).map(({ startTime, endTime }) => [startTime, endTime]), [
      ['13:30', '16:20'], ['21:30', '22:20'],
    ]);
    assert.deepEqual(ncnuCourseMeetings('1xya2z', semester).map(({ startTime, endTime }) => [startTime, endTime]), [
      ['06:10', '09:00'], ['12:10', '13:00'],
    ]);
  }
});

test('nonadjacent periods and the lunch break are separate meetings', () => {
  assert.deepEqual(ncnuCourseMeetings('1ac2dzef', '1151').map(({ dayOfWeek, periodLabel, startTime, endTime }) => (
    [dayOfWeek, periodLabel, startTime, endTime]
  )), [
    [1, 'a', '08:10', '09:00'], [1, 'c', '10:10', '11:00'],
    [2, 'dz', '11:10', '13:00'], [2, 'ef', '13:30', '15:20'],
  ]);
});

test('historical and future unverified terms retain the original period labels without invented clocks', () => {
  for (const semester of [undefined, '1141', '1152', '1161', '']) {
    assert.deepEqual(ncnuCourseMeetings('2def', semester), [{
      dayOfWeek: 2, periodLabel: 'def', label: '星期二 d、e、f 節',
    }]);
  }
});

test('clock times, separate meetings, course identity and raw labels survive the real CSV import', () => {
  const csv = ncnuTimetableImportCsv({
    code: '130032', section: '0', title: '資料庫管理系統', department: '資管系',
    teacher: '授課教師', time: '4efg', room: '管268', semester: '1151', credits: '3.0',
  });
  const parsed = parsePersonalImport(csv, { kind: 'timetable', schoolId: 'ncnu', academicYear: '', semester: '' });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].startTime, '13:30');
  assert.equal(parsed.rows[0].endTime, '16:20');
  assert.equal(parsed.rows[0].periodLabel, 'efg');
  assert.equal(parsed.rows[0].startPeriod, undefined);
  assert.equal(parsed.rows[0].courseCode, '130032');
  assert.equal(parsed.rows[0].className, '0');
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
});

test('duplicate weekday-periods in the same public course require manual review, not a CSV import', () => {
  const sample = {
    code: '130032', section: '0', title: '資料庫管理系統', department: '資管系',
    teacher: '教師', time: '1ab1bc', room: '管268', semester: '1151', credits: '3',
  };
  for (const time of ['1ab1bc', '1abb', '1ab1ab']) {
    for (const semester of ['1151', '1161']) {
      assert.ok(ncnuCourseMeetings(time, semester));
      assert.equal(ncnuTimetableImportCsv({ ...sample, time, semester }), null);
    }
  }
  // Adjacent groups without repeated periods, and identical periods on another
  // weekday, remain valid instead of over-blocking normal split sessions.
  assert.deepEqual(ncnuCourseMeetings('1ab1cd', '1151').map(({ periodLabel }) => periodLabel), ['ab', 'cd']);
  assert.deepEqual(ncnuCourseMeetings('1ab2ab', '1151').map(({ dayOfWeek }) => dayOfWeek), [1, 2]);
  assert.equal(parsePersonalImport(ncnuTimetableImportCsv({ ...sample, time: '1ab1cd' }), {
    kind: 'timetable', schoolId: 'ncnu', academicYear: '', semester: '',
  }).rows.length, 2);
});
