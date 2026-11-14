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
const { publicCourseWeekdays, evaluatePublicCourseFilters } = require('../src/publicCourseFilters.ts');
const { nthuTimetableImportCsv } = require('../src/nthuCourseSchedule.ts');
const { ncnuTimetableImportCsv } = require('../src/ncnuCourseSchedule.ts');
require.extensions['.ts'] = original;

const course = {
  code: '11510AES 520300', section: '00', title: '重複節次', department: 'AES',
  teacher: '', credits: '3', room: 'A', semester: '1151', time: '',
};

test('duplicate periods retain weekday filter evidence while CSV import stays blocked', () => {
  for (const semester of ['1151', '1161']) {
    for (const [schoolId, times] of [
      ['ncnu', ['1ab1bc', '1abb', '1ab2ab1bc']],
      ['nthu', ['M3M4/M4M5', 'M3M3', 'M3M4/T3M4']],
    ]) {
      for (const time of times) {
        const sample = { ...course, semester, code: semester.slice(0, 3) + '10AES 520300', time,
          meetings: time.split('/').map(time => ({ time, room: 'A' })) };
        const days = time.includes('2') || time.includes('T') ? [1, 2] : [1];
        assert.deepEqual(publicCourseWeekdays(sample, schoolId), days);
        assert.equal(evaluatePublicCourseFilters(sample, schoolId, { weekday: 1 }), 'match');
        assert.equal(evaluatePublicCourseFilters(sample, schoolId, { weekday: 7 }), 'exclude');
        assert.equal(evaluatePublicCourseFilters(sample, schoolId, { weekday: 1, credits: 3 }), 'match');
        assert.equal((schoolId === 'nthu' ? nthuTimetableImportCsv : ncnuTimetableImportCsv)(sample), null);
      }
    }
  }
});

test('unrecognizable schedules remain unresolved', () => {
  for (const schoolId of ['ncnu', 'nthu']) {
    const sample = { ...course, time: 'unknown', meetings: [{ time: 'unknown', room: 'A' }] };
    assert.equal(publicCourseWeekdays(sample, schoolId), null);
    assert.equal(evaluatePublicCourseFilters(sample, schoolId, { weekday: 1 }), 'unresolved');
  }
});
