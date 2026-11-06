import { classMeetingKey, type PersonalImportRecord } from '@campus/shared';
import { savedClassGaps } from '../../services/nextSavedClasses';

function meeting(id: string, startTime: string, endTime: string): PersonalImportRecord {
  return {
    id, title: id, schoolId: 'pu', kind: 'timetable', academicYear: '115', semester: '1',
    dayOfWeek: 5, startTime, endTime, batchId: 'import', importedAt: '2026-11-01T00:00:00Z',
    source: { type: 'paste', rawText: '', line: 1 },
  };
}

const first = meeting('資料庫', '08:00', '09:00');
const last = meeting('統計', '14:00', '15:00');
const at = (clock: string) => Date.parse(`2026-11-06T${clock}+08:00`);
const gaps = (rows: PersonalImportRecord[], clock = '07:00') =>
  savedClassGaps(rows, 'pu', new Date(at(clock)), 'today');

test('reports only gaps bounded by saved meetings, merging touching and nested classes', () => {
  const rows = [last, meeting('網路', '10:30', '11:30'), first,
    meeting('專題', '10:00', '12:00'), meeting('討論', '12:00', '12:30')];
  expect(gaps(rows)).toEqual([
    { startAt: at('09:00'), endAt: at('10:00') }, { startAt: at('12:30'), endAt: at('14:00') },
  ]);
  expect(gaps(rows, '09:14:53')).toEqual([
    { startAt: at('09:14:53'), endAt: at('10:00') }, { startAt: at('12:30'), endAt: at('14:00') },
  ]);
  expect(gaps(rows, '10:00')).toEqual([{ startAt: at('12:30'), endAt: at('14:00') }]);
  expect(gaps(rows, '15:00')).toEqual([]);
  expect(gaps([first])).toEqual([]);
});

test('a missing timetable or unplaceable meeting cannot establish a free period', () => {
  expect(gaps([])).toBeUndefined();
  expect(gaps([{ ...first, schoolId: 'nthu' }])).toBeUndefined();
  expect(gaps([{ ...first, academicYear: '114' }])).toBeUndefined();
  expect(gaps([first, last, { ...first, endTime: undefined }])).toBeUndefined();
  expect(gaps([first, last, { ...first, academicYear: '未填' }])).toBeUndefined();
  expect(gaps([first, last, { ...first, schoolId: 'nthu', academicYear: '未填' },
    { ...first, academicYear: '114', endTime: undefined }])).toEqual([{ startAt: at('09:00'), endAt: at('14:00') }]);
});

test('tomorrow follows the Taiwan date and respects single-day cancellations', () => {
  const cancelled = meeting('國文', '10:00', '12:00');
  const rows = [first, { ...cancelled, classExceptions: [{
    id: 'cancel', kind: 'cancel' as const, original: cancelled, originalDate: '2026-11-06',
    courseKey: classMeetingKey(cancelled), createdAt: first.importedAt,
  }] }, last];
  expect(savedClassGaps(rows, 'pu', new Date('2026-11-04T18:00:00Z'), 'tomorrow')).toEqual([
    { startAt: at('09:00'), endAt: at('14:00') },
  ]);
  expect(savedClassGaps(rows, 'pu', new Date('2026-11-05T18:00:00Z'), 'tomorrow')).toEqual([]);
});

test('a previous-term class ending after midnight bounds the first gap of the new term', () => {
  const rows = [{ ...first, classExceptions: [{
    id: 'move', kind: 'move' as const, original: first, originalDate: '2027-01-29',
    courseKey: classMeetingKey(first), createdAt: first.importedAt,
    date: '2027-01-31', startTime: '23:00', endDate: '2027-02-01', endTime: '01:15',
  }] }, { ...last, dayOfWeek: 1, semester: '2' }];
  const now = new Date('2027-01-31T23:30:00+08:00');
  expect(savedClassGaps(rows, 'pu', now, 'tomorrow')).toEqual([{
    startAt: Date.parse('2027-02-01T01:15:00+08:00'), endAt: Date.parse('2027-02-01T14:00:00+08:00'),
  }]);
});
