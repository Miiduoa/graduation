/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
let nthuCourseMeetings;
let nthuTimetableImportCsv;
try {
  require.extensions['.ts'] = (module, filename) => {
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    module._compile(source, filename);
  };
  ({ nthuCourseMeetings, nthuTimetableImportCsv } = require('../src/nthuCourseSchedule.ts'));
} finally {
  require.extensions['.ts'] = original;
}

// Independent oracle from the official NTHU clock table, checked 2026-11-13:
// https://curricul.site.nthu.edu.tw/p/406-1208-290466,r7880.php?Lang=zh-tw
// Explicit blocks avoid repeating the production gap-comparison algorithm.
const blocks = ['12', '34n', '56', '789abcd'];
const periods = blocks.join('');
const days = 'MTWRFSU';
const clocks = [
  ['08:00', '08:50'], ['09:00', '09:50'], ['10:10', '11:00'],
  ['11:10', '12:00'], ['12:10', '13:00'], ['13:20', '14:10'],
  ['14:20', '15:10'], ['15:30', '16:20'], ['16:30', '17:20'],
  ['17:30', '18:20'], ['18:30', '19:20'], ['19:30', '20:20'],
  ['20:30', '21:20'], ['21:30', '22:20'],
];
const header = 'schoolId,academicYear,semester,courseCode,className,title,teacher,location,credits,dayOfWeek,periodLabel,startTime,endTime';
function courseFor(time, meetings, semester = '1151') {
  return {
    code: semester + '0CS  101001', section: '01', title: '測試課程',
    department: 'CS', teacher: '測試教師', credits: '3', semester, time,
    room: '教室甲', meetings,
  };
}

for (const [dayIndex, day] of [...days].entries()) {
  test(`${day}: all 105 contiguous period ranges preserve verified breaks and CSV identity`, () => {
    let checked = 0;
    for (let start = 0; start < periods.length; start++) {
      for (let end = start + 1; end <= periods.length; end++) {
        const selected = periods.slice(start, end);
        const time = [...selected].map(period => day + period).join('');
        const input = [{ time, room: '教室甲' }];
        const expected = blocks.map(block => [...block].filter(period => selected.includes(period)).join(''))
          .filter(Boolean).map(periodLabel => ({
            dayOfWeek: dayIndex + 1,
            periodLabel,
            room: '教室甲',
            startTime: clocks[periods.indexOf(periodLabel[0])][0],
            endTime: clocks[periods.indexOf(periodLabel.slice(-1))][1],
          }));
        const actual = nthuCourseMeetings(input, '1151');
        assert.deepEqual(actual.map(({ dayOfWeek, periodLabel, room, startTime, endTime }) =>
          ({ dayOfWeek, periodLabel, room, startTime, endTime })), expected, time);
        assert.equal(actual.map(row => row.periodLabel).join(''), selected, time);
        const course = courseFor(time, input);
        // Every fixture cell is plain text with no embedded quote/newline. Compare
        // the complete real serializer output, not a second call to that serializer.
        const csvRows = expected.map(row => [
          'nthu', '115', '1', course.code, '01', course.title, course.teacher,
          row.room, '3', String(row.dayOfWeek), row.periodLabel, row.startTime, row.endTime,
        ].map(value => `"${value}"`).join(','));
        assert.equal(nthuTimetableImportCsv(course), '\uFEFF' + [header, ...csvRows].join('\r\n'), time);
        checked++;
      }
    }
    assert.equal(checked, 105);
  });
}

test('breaks preserve different rooms and both weekend days without merging meeting pairs', () => {
  const input = [
    { time: 'S2S3', room: '教室甲' }, { time: 'S4SnS5', room: '教室乙' },
    { time: 'U6U7U8', room: '教室丙' },
  ];
  assert.deepEqual(nthuCourseMeetings(input, '1151').map(row =>
    [row.dayOfWeek, row.periodLabel, row.room, row.startTime, row.endTime]), [
    [6, '2', '教室甲', '09:00', '09:50'], [6, '3', '教室甲', '10:10', '11:00'],
    [6, '4n', '教室乙', '11:10', '13:00'], [6, '5', '教室乙', '13:20', '14:10'],
    [7, '6', '教室丙', '14:20', '15:10'], [7, '78', '教室丙', '15:30', '17:20'],
  ]);
});

test('verified breaks cannot enable duplicate-period imports at any boundary or weekday', () => {
  for (const day of days) {
    for (const [before, after] of [['2', '3'], ['n', '5'], ['6', '7']]) {
      const input = [
        { time: day + before + day + after, room: '教室甲' },
        { time: day + after, room: '教室乙' },
      ];
      assert.equal(nthuTimetableImportCsv(courseFor('', input)), null, day + before + after);
    }
  }
});

test('unknown terms keep their own labels and never receive the 115-1 clock table', () => {
  for (const semester of [undefined, '', '1141', '1152', '1153', '1161']) {
    for (const day of days) {
      const input = [{ time: [...periods].map(period => day + period).join(''), room: '教室甲' }];
      const rows = nthuCourseMeetings(input, semester);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].periodLabel, periods);
      assert.equal(rows[0].startTime, undefined);
      assert.equal(rows[0].endTime, undefined);
    }
  }
});
