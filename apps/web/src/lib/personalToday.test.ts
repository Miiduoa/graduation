import { describe, expect, it } from 'vitest';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';

const row = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'course',
  kind: 'timetable',
  title: '資料庫',
  schoolId: 'ncku',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startPeriod: 2,
  endPeriod: 3,
  source: { type: 'paste', line: 1, rawText: '' },
  batchId: 'batch',
  importedAt: '2026-10-17T12:00:00Z',
  ...overrides,
});
const view = (
  records: PersonalImportRecord[],
  now = '2026-10-19T00:30:00Z',
  schoolId = 'ncku',
  termKey?: string,
) => buildPersonalToday(records, { now: new Date(now), schoolId, termKey });

describe('personal timetable on Today', () => {
  it('uses Taipei weekday even when UTC is still Sunday, and includes weekends', () => {
    expect(view([row()], '2026-10-18T16:30:00Z').weekday).toBe(1);
    expect(view([row({ dayOfWeek: 7 })], '2026-10-18T01:00:00Z').today).toHaveLength(1);
  });
  it('uses the selected school period table, including NCKU period zero', () => {
    expect(view([row()]).today[0]).toMatchObject({
      startTime: '08:00',
      endTime: '09:50',
      status: 'ongoing',
    });
    expect(view([row({ startPeriod: 1, endPeriod: 1 })]).today[0]).toMatchObject({
      startTime: '07:00',
      endTime: '07:50',
      status: 'ended',
    });
    expect(
      view([row({ schoolId: 'ntpu', startPeriod: 10, endPeriod: 10 })], undefined, 'ntpu').today[0]
        .startTime,
    ).toBe('18:30');
  });
  it('never applies PU periods to an unknown school or fills half an explicit clock range', () => {
    expect(view([row({ schoolId: 'other' })], undefined, 'other')).toMatchObject({
      today: [],
      unplacedCount: 1,
    });
    expect(view([row({ startTime: '08:00' })])).toMatchObject({ today: [], unplacedCount: 1 });
    expect(view([row({ startTime: '25:00', endTime: '26:00' })]).unplacedCount).toBe(1);
    expect(
      view([row({ schoolId: 'other', startTime: '08:00', endTime: '09:00' })], undefined, 'other')
        .today,
    ).toHaveLength(1);
  });
  it('isolates school, record type and selected term, normalizing ROC/Gregorian years for sorting', () => {
    const records = [
      row({ id: 'old', academicYear: '2025' }),
      row(),
      row({ id: 'other', schoolId: 'ntpu' }),
      row({ id: 'grade', kind: 'grades' }),
    ];
    expect(view(records).today.map((entry) => entry.row.id)).toEqual(['course']);
    expect(view(records, undefined, 'ncku', '2025|1').today.map((entry) => entry.row.id)).toEqual([
      'old',
    ]);
  });
  it('marks only overlaps, not consecutive classes, and advances after the exact end time', () => {
    const records = [
      row({ id: 'first', startTime: '08:00', endTime: '09:00' }),
      row({ id: 'overlap', startTime: '08:30', endTime: '09:30' }),
      row({ id: 'next', startTime: '09:30', endTime: '10:30' }),
    ];
    const result = view(records, '2026-10-19T01:30:00Z');
    expect(result.today.map((entry) => [entry.row.id, entry.status, entry.conflict])).toEqual([
      ['first', 'ended', true],
      ['overlap', 'ended', true],
      ['next', 'ongoing', false],
    ]);
    expect(result.nextId).toBe('next');
    expect(view(records, '2026-10-19T03:00:00Z').nextId).toBeNull();
  });
  it('keeps unknown weekdays and invalid ranges visible as incomplete instead of free time', () => {
    const records = [
      row({ id: 'unknown', dayOfWeek: undefined }),
      row({ id: 'bad', startTime: '10:00', endTime: '09:00' }),
    ];
    expect(view(records)).toMatchObject({ today: [], unplacedCount: 2 });
  });
  it('does not report a manual copy of an imported class as a timetable conflict', () => {
    const manual = row({ id: 'manual:course', teacher: '王老師', location: '教室 303' });
    const imported = row({
      id: 'imported', teacher: '王老師', location: '教室 303',
      startPeriod: undefined, endPeriod: undefined, startTime: '08:00', endTime: '09:50',
    });
    expect(view([manual, imported])).toMatchObject({
      nextId: 'imported',
      today: [{ row: { id: 'imported' }, conflict: false }],
    });
    expect(view([imported, manual]).today).toHaveLength(1);
  });
  it('still reports same-name classes with different teachers or rooms as conflicts', () => {
    for (const details of [{ teacher: '另一位老師' }, { location: '另一間教室' }]) {
      const result = view([row({ id: 'manual:course' }), row({ id: 'imported', ...details })]);
      expect(result.today).toHaveLength(2);
      expect(result.today.every((entry) => entry.conflict)).toBe(true);
    }
  });
});
