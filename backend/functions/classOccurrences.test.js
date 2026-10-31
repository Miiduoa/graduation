'use strict';
const { buildPersonalToday } = require('./generated/shared/imports/today');
const {
  classMeetingKey,
  withClassExceptions,
  saveClassException,
} = require('./generated/shared/timetable/classExceptions');

const row = {
  id: 'synthetic',
  kind: 'timetable',
  schoolId: 'pu',
  title: '合成課程',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startPeriod: 2,
  endPeriod: 4,
  location: '原教室',
  batchId: 'batch',
  importedAt: '',
  source: { type: 'paste', line: 1, rawText: '合成來源' },
};
test('server runtime preserves a dated exception across a reimport without changing source data', () => {
  const value = {
    id: 'stop',
    original: row,
    courseKey: classMeetingKey(row),
    originalDate: '2026-11-02',
    kind: 'cancel',
    createdAt: '',
  };
  const exceptions = saveClassException([], value);
  const imported = {
    ...row,
    id: 'new-row',
    batchId: 'new-batch',
    source: { ...row.source, rawText: '新來源' },
  };
  const records = withClassExceptions([imported], exceptions);
  expect(
    buildPersonalToday(records, { schoolId: 'pu', now: new Date('2026-11-02T08:00:00+08:00') })
      .today,
  ).toEqual([]);
  expect(
    buildPersonalToday(records, { schoolId: 'pu', now: new Date('2026-11-09T08:00:00+08:00') })
      .today,
  ).toHaveLength(1);
  expect(exceptions[0].original.source.rawText).toBe('合成來源');
});
