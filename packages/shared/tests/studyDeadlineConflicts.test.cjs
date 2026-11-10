/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
};
const {
  studyDeadlineConflicts,
  studyDeadlineConflictText,
  personalImportDeadlineSources,
} = require('../src/studyDeadlineConflicts.ts');
const {
  studyCalendarCandidates,
  studyCalendarKey,
  buildStudyCalendar,
} = require('../src/studyAgendaCalendar.ts');
const { classMeetingKey } = require('../src/timetable/classExceptions.ts');
require.extensions['.ts'] = original;
const task = {
  id: 'a',
  courseId: 'c',
  title: '作業',
  courseTitle: '課程',
  kind: 'assignment',
  state: 'open',
  submittedAt: null,
  dueAt: '2026-11-10T00:30:00+08:00',
};
const row = {
  id: 'e',
  batchId: 'b',
  importedAt: '',
  kind: 'events',
  title: '活動',
  schoolId: 's',
  academicYear: '115',
  semester: '1',
  source: { type: 'paste', line: 1, rawText: '' },
  date: '2026-11-09',
  endDate: '2026-11-10',
  startTime: '23:00',
  endTime: '01:00',
};
const source = (kind, records, extra = {}) => ({
  kind,
  records,
  schoolId: 's',
  termKey: '115|1',
  start: '2026-11-01',
  end: '2026-11-30',
  status: 'complete',
  ...extra,
});
const eventResult = (records, extra) =>
  studyDeadlineConflicts(task, [source('events', records, extra)])[1];
test('cross-day and exclusive all-day intervals contain the deadline point', () => {
  assert.deepEqual(eventResult([row]), { kind: 'events', titles: ['活動'], unknown: false });
  assert.deepEqual(
    eventResult([{ ...row, allDay: true, date: '2026-11-10', endDate: '2026-11-11' }]).titles,
    ['活動'],
  );
  assert.deepEqual(eventResult([{ ...row, allDay: true }]).titles, []);
  assert.deepEqual(eventResult([{ ...row, endTime: '00:30' }]).titles, []);
});
test('missing coverage, unsynced, partial and malformed rows stay unknown', () => {
  assert.ok(studyDeadlineConflicts(task).every((r) => r.unknown));
  for (const status of ['partial', 'unsynced']) {
    const result = eventResult([row], { status });
    assert.equal(result.unknown, true);
    assert.deepEqual(result.titles, ['活動']);
  }
  assert.equal(eventResult([], { end: '2026-11-09' }).unknown, true);
  assert.equal(eventResult([{ ...row, startTime: undefined }]).unknown, true);
  assert.match(studyDeadlineConflictText(task), /未知/);
  assert.equal(eventResult([]).unknown, false);
});
test('uses shared cancellations and overnight make-up meetings, scoped to school and term', () => {
  const course = { ...row, kind: 'timetable', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' };
  const exception = {
    id: 'x',
    courseKey: classMeetingKey(course),
    original: course,
    originalDate: '2026-11-09',
    kind: 'cancel',
    createdAt: '',
  };
  const monday = { ...task, dueAt: '2026-11-09T09:30:00+08:00' };
  const check = (t, r) => studyDeadlineConflicts(t, [source('timetable', [r])])[0];
  assert.deepEqual(check(monday, course).titles, ['活動']);
  assert.deepEqual(check(monday, { ...course, classExceptions: [exception] }).titles, []);
  const moved = {
    ...course,
    classExceptions: [
      {
        ...exception,
        kind: 'move',
        date: '2026-11-09',
        endDate: '2026-11-10',
        startTime: '23:00',
        endTime: '01:00',
      },
    ],
  };
  assert.deepEqual(check(task, moved).titles, ['活動']);
  assert.deepEqual(check(monday, moved).titles, []);
  assert.deepEqual(check(task, { ...moved, semester: '2' }).titles, []);
  assert.deepEqual(check(task, { ...moved, schoolId: 'other' }).titles, []);
});
test('submitted and non-open tasks cannot export, and preview preserves ICS identity and point times', () => {
  const tasks = [
    task,
    { ...task, id: 'submitted', submittedAt: '2026-11-01' },
    { ...task, id: 'closed', state: 'closed' },
  ];
  assert.deepEqual(studyCalendarCandidates(tasks), [task]);
  const now = new Date('2026-11-01T00:00:00Z');
  const before = buildStudyCalendar(tasks, tasks.map(studyCalendarKey), now);
  studyDeadlineConflicts(task, [source('events', [row])]);
  assert.equal(buildStudyCalendar(tasks, tasks.map(studyCalendarKey), now), before);
  assert.match(before, /UID:study-c:assignment:a@nuni.tw/);
  assert.match(before, /DTSTART:20261109T163000Z\r\nDTEND:20261109T163000Z/);
  assert.doesNotMatch(before, /study-c:assignment:(submitted|closed)/);
});

test('local records reveal clashes without inventing coverage or synchronization', () => {
  const rows = [
    row,
    {
      ...row,
      id: 't',
      kind: 'timetable',
      dayOfWeek: 2,
      title: '課堂',
      startTime: '00:00',
      endTime: '01:00',
    },
  ];
  const sources = personalImportDeadlineSources(rows, 's');
  const result = studyDeadlineConflicts(task, sources);
  assert.deepEqual(
    result.map((r) => r.titles),
    [['課堂'], ['活動']],
  );
  assert.ok(result.every((r) => r.unknown));
  assert.ok(sources.every((s) => s.status === 'partial'));
  assert.equal(sources[1].start, undefined);
  assert.ok(
    studyDeadlineConflicts({ ...task, dueAt: '2026-12-10T00:30:00+08:00' }, sources).every(
      (r) => r.unknown,
    ),
  );
  assert.ok(
    studyDeadlineConflicts(task, personalImportDeadlineSources(rows, 'other')).every(
      (r) => r.unknown,
    ),
  );
  assert.ok(
    studyDeadlineConflicts(task, personalImportDeadlineSources([], 's')).every((r) => r.unknown),
  );
});
