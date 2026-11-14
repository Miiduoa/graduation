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
const { nthuCourseIdentity, nthuCourseMeetings, nthuTimetableImportCsv } = require('../src/nthuCourseSchedule.ts');
const { isPublicCourseCatalog, isNcnuPublicCourseCatalog } = require('../src/publicCourseCatalog.ts');
const { parsePersonalImport } = require('../src/imports/parser.ts');
require.extensions['.ts'] = original;

// Exact room/time pairs and identity from the public 115-1 JSON, retrieved 2026-11-06.
const chemistry = {
  code: '11510AES 520300', title: '環境化學', section: '00', department: 'AES',
  teacher: '董瑞安\tDOONG, RUEY-AN', credits: '3', semester: '1151',
  time: 'M3M4\nF3F4', room: 'BMES醫環618\nBMES醫環501',
  meetings: [{ room: 'BMES醫環618', time: 'M3M4' }, { room: 'BMES醫環501', time: 'F3F4' }],
};

test('official padded course codes distinguish the academic year, semester and two-digit section', () => {
  assert.deepEqual(nthuCourseIdentity('11510CS  772000'), {
    academicYear: '115', semester: '1151', term: '1', departmentCode: 'CS', section: '00',
  });
  assert.deepEqual(nthuCourseIdentity('11520MATH101001'), {
    academicYear: '115', semester: '1152', term: '2', departmentCode: 'MATH', section: '01',
  });
  assert.equal(nthuCourseIdentity('11530PHYS541000').semester, '1153');
  for (const code of ['11510CS772000', '11540AES 520300', '11510aeS 520300', '11510C S 772000', '130032', ' 11510AES 520300']) {
    assert.equal(nthuCourseIdentity(code), null, code);
  }
});

test('every clock boundary matches the official NTHU period table for 115-1', () => {
  const periods = [
    ['1', '08:00', '08:50'], ['2', '09:00', '09:50'], ['3', '10:10', '11:00'],
    ['4', '11:10', '12:00'], ['n', '12:10', '13:00'], ['5', '13:20', '14:10'],
    ['6', '14:20', '15:10'], ['7', '15:30', '16:20'], ['8', '16:30', '17:20'],
    ['9', '17:30', '18:20'], ['a', '18:30', '19:20'], ['b', '19:30', '20:20'],
    ['c', '20:30', '21:20'], ['d', '21:30', '22:20'],
  ];
  for (const [period, startTime, endTime] of periods) {
    const [meeting] = nthuCourseMeetings([{ time: 'M' + period, room: '教室' }], '1151');
    assert.deepEqual([meeting.periodLabel, meeting.startTime, meeting.endTime], [period, startTime, endTime]);
  }
});

test('all seven weekday codes and nonadjacent periods remain separate meetings', () => {
  const meetings = nthuCourseMeetings([{ time: 'M1M3M4T1T2W3R4F5S6UnUaUb', room: '教室' }], '1151');
  assert.deepEqual(meetings.map(({ dayOfWeek, periodLabel }) => [dayOfWeek, periodLabel]), [
    [1, '1'], [1, '34'], [2, '12'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, 'n'], [7, 'ab'],
  ]);
});

test('a real two-room course keeps each room, weekday and verified clock through the CSV importer', () => {
  const csv = nthuTimetableImportCsv(chemistry);
  const parsed = parsePersonalImport(csv, { kind: 'timetable', schoolId: 'nthu', academicYear: '', semester: '' });
  assert.deepEqual(parsed.rows.map(row => ({
    code: row.courseCode, section: row.className, room: row.location,
    day: row.dayOfWeek, start: row.startTime, end: row.endTime, period: row.periodLabel,
    school: row.schoolId, year: row.academicYear, semester: row.semester, credits: row.credits,
  })), [
    { code: chemistry.code, section: '00', room: 'BMES醫環618', day: 1, start: '10:10', end: '12:00', period: '34', school: 'nthu', year: '115', semester: '1', credits: 3 },
    { code: chemistry.code, section: '00', room: 'BMES醫環501', day: 5, start: '10:10', end: '12:00', period: '34', school: 'nthu', year: '115', semester: '1', credits: 3 },
  ]);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.ok(parsed.rows.every(row => row.startPeriod === undefined));
});

test('missing, partially missing and unfamiliar times cannot produce a partial timetable', () => {
  for (const meetings of [[], [{ room: 'SINICA中  研院', time: '' }],
    [{ room: '教室', time: 'M3M4' }, { room: '教室', time: '' }],
    [{ room: '教室', time: '4efg' }], [{ room: '教室', time: 'Tz' }], [{ room: '教室', time: 'M3 M4' }]]) {
    assert.equal(nthuCourseMeetings(meetings, '1151'), null);
    assert.equal(nthuTimetableImportCsv({ ...chemistry, meetings }), null);
  }
  assert.equal(nthuTimetableImportCsv({ ...chemistry, meetings: undefined }), null);
});

test('unverified terms retain original NTHU periods without clock assumptions', () => {
  for (const semester of [undefined, '', '1141', '1152', '1153', '1161']) {
    assert.deepEqual(nthuCourseMeetings([{ time: 'TnT5R7R8', room: '教室' }], semester), [
      { dayOfWeek: 2, periodLabel: 'n5', room: '教室', label: '星期二 n、5 節' },
      { dayOfWeek: 4, periodLabel: '78', room: '教室', label: '星期四 7、8 節' },
    ]);
  }
});

test('the CSV handoff rejects mismatched course identities and preserves zero credits', () => {
  for (const override of [{ code: '130032' }, { section: '01' }, { semester: '1152' }]) {
    assert.equal(nthuTimetableImportCsv({ ...chemistry, ...override }), null);
  }
  const options = { kind: 'timetable', schoolId: 'nthu', academicYear: '', semester: '' };
  assert.equal(parsePersonalImport(nthuTimetableImportCsv({ ...chemistry, credits: '0' }), options).rows[0].credits, 0);
  assert.equal(parsePersonalImport(nthuTimetableImportCsv({ ...chemistry, credits: '' }), options).rows[0].credits, undefined);
});

test('catalog responses require the expected campus and valid bounded room/time pairs', () => {
  const response = { schoolId: 'nthu', sourceUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json', courses: [chemistry], truncated: false };
  assert.equal(isPublicCourseCatalog(response, 'nthu'), true);
  assert.equal(isPublicCourseCatalog(response, 'ncnu'), false);
  assert.equal(isNcnuPublicCourseCatalog(response), false);
  assert.equal(isPublicCourseCatalog({ ...response, schoolId: 'constructor' }, 'constructor'), false);
  for (const meetings of [null, {}, [null], [{ time: 1, room: '' }], [{ time: '', room: 1 }], Array(33).fill({ time: '', room: '' })]) {
    assert.equal(isPublicCourseCatalog({ ...response, courses: [{ ...chemistry, meetings }] }, 'nthu'), false);
  }
  assert.equal(isPublicCourseCatalog({ ...response, courses: Array(51).fill(chemistry) }, 'nthu'), false);
  assert.equal(isPublicCourseCatalog({ ...response, courses: [{ ...chemistry, code: '' }] }, 'nthu'), false);
  const ncnu = { ...response, schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall', courses: [{ ...chemistry, meetings: undefined }] };
  assert.equal(isNcnuPublicCourseCatalog(ncnu), true);
  assert.equal(isPublicCourseCatalog(ncnu, 'ncnu'), true);
});

test('duplicate weekday-periods across official room/time pairs require manual review', () => {
  for (const meetings of [
    [{ time: 'M3M4', room: 'A' }, { time: 'M4M5', room: 'B' }],
    [{ time: 'M3M3', room: 'A' }],
    [{ time: 'S6S7', room: 'A' }, { time: 'S7', room: 'B' }],
  ]) {
    for (const semester of ['1151', '1161']) {
      assert.ok(nthuCourseMeetings(meetings, semester));
      assert.equal(nthuTimetableImportCsv({ ...chemistry, meetings, semester,
        code: semester === '1161' ? '11610AES 520300' : chemistry.code }), null);
    }
  }
  const disjoint = [{ time: 'M3M4', room: 'A' }, { time: 'M5', room: 'B' }, { time: 'T3M3', room: 'C' }];
  // M3 is already occupied in the first pair, even if it appears after T3.
  assert.equal(nthuTimetableImportCsv({ ...chemistry, meetings: disjoint }), null);
  const valid = [{ time: 'M3M4', room: 'A' }, { time: 'M5', room: 'B' }, { time: 'T3', room: 'C' }];
  assert.deepEqual(nthuCourseMeetings(valid, '1151').map(({ dayOfWeek, room }) => [dayOfWeek, room]),
    [[1, 'A'], [1, 'B'], [2, 'C']]);
  assert.equal(parsePersonalImport(nthuTimetableImportCsv({ ...chemistry, meetings: valid }), {
    kind: 'timetable', schoolId: 'nthu', academicYear: '', semester: '',
  }).rows.length, 3);
});
