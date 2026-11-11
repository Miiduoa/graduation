import { classMeetingKey, type PersonalImportRecord } from '@campus/shared';
import { currentSavedClasses, nextSavedClasses, savedClassGaps } from '../../services/nextSavedClasses';

function meeting(id: string, startTime: string, endTime: string, dayOfWeek = 5): PersonalImportRecord {
  return {
    id, title: id, schoolId: 'pu', kind: 'timetable', academicYear: '115', semester: '1',
    dayOfWeek, startTime, endTime, batchId: 'import', importedAt: '2026-11-01T00:00:00Z',
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

test.each([
  ['missing', undefined], ['zero', 0], ['NaN', Number.NaN], ['negative', -1],
  ['fractional', 2.5], ['out of range', 8],
] as const)('a current-term meeting with a %s weekday cannot establish a gap', (_label, dayOfWeek) => {
  const unplaced = { ...meeting('待確認課程', '11:00', '12:00'), dayOfWeek };
  expect(gaps([first, unplaced, last])).toBeUndefined();
  expect(gaps([unplaced])).toBeUndefined();
});

test.each([
  { startTime: undefined }, { endTime: undefined }, { startTime: '25:00' },
  { endTime: '11:60' }, { startTime: '12:00' }, { startTime: '13:00' },
])('an incomplete or invalid current-term meeting time blocks gap assertions: %j', (change) => {
  expect(gaps([first, { ...meeting('待確認時間', '11:00', '12:00'), ...change }, last])).toBeUndefined();
});

test('scope normalization cannot hide a current-term meeting without a weekday', () => {
  expect(gaps([first, last, {
    ...meeting('待確認課程', '11:00', '12:00'), academicYear: '2026', semester: '上學期', dayOfWeek: undefined,
  }])).toBeUndefined();
});

test('unplaced or malformed records from other terms and scopes do not invalidate known gaps', () => {
  const unplaced = { ...meeting('待確認課程', '11:00', '12:00'), dayOfWeek: undefined };
  expect(gaps([
    first, last, { ...unplaced, academicYear: '114' },
    { ...first, academicYear: '114', endTime: '25:00' },
    { ...unplaced, semester: '2' }, { ...unplaced, schoolId: 'nthu' },
    { ...unplaced, kind: 'grades' }, { ...unplaced, kind: 'events' },
  ])).toEqual([{ startAt: at('09:00'), endAt: at('14:00') }]);
});

test('current and next class queries keep their existing handling of unscheduled courses', () => {
  const rows = [first, last, { ...meeting('未排課課程', '11:00', '12:00'), dayOfWeek: undefined }];
  const now = new Date(at('08:30'));
  expect(currentSavedClasses(rows, 'pu', now)?.map((entry) => entry.courseId)).toEqual([first.id]);
  expect(nextSavedClasses(rows, 'pu', now)?.map((entry) => entry.courseId)).toEqual([last.id]);
  expect(savedClassGaps(rows, 'pu', now, 'today')).toBeUndefined();
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

test('a previous-term makeup on the second day of the new term splits the free period', () => {
  const makeup = meeting('前學期補課', '08:00', '09:00');
  const rows: PersonalImportRecord[] = [
    { ...meeting('上午課', '09:00', '10:00', 2), semester: '2' },
    { ...meeting('下午課', '14:00', '15:00', 2), semester: '2' },
    { ...makeup, classExceptions: [{
      id: 'makeup', kind: 'move', original: makeup, originalDate: '2027-01-29',
      courseKey: classMeetingKey(makeup), createdAt: makeup.importedAt,
      date: '2027-02-02', startTime: '11:00', endTime: '12:00',
    }] },
  ];
  expect(savedClassGaps(rows, 'pu', new Date('2027-02-02T08:00:00+08:00'), 'today')).toEqual([
    { startAt: Date.parse('2027-02-02T10:00:00+08:00'), endAt: Date.parse('2027-02-02T11:00:00+08:00') },
    { startAt: Date.parse('2027-02-02T12:00:00+08:00'), endAt: Date.parse('2027-02-02T14:00:00+08:00') },
  ]);
});

test('the day after tomorrow uses the Taiwan date and retains Sunday meetings', () => {
  const sunday = [meeting('週日上午', '09:00', '10:00', 7), meeting('週日下午', '14:00', '15:00', 7)];
  expect(savedClassGaps([first, last, ...sunday], 'pu', new Date('2026-11-05T16:30:00Z'), 'day-after-tomorrow')).toEqual([{
    startAt: Date.parse('2026-11-08T10:00:00+08:00'), endAt: Date.parse('2026-11-08T14:00:00+08:00'),
  }]);
});

test('the day after tomorrow preserves overnight changes when the semester changes', () => {
  const rows: PersonalImportRecord[] = [{ ...first, classExceptions: [{
    id: 'move', kind: 'move', original: first, originalDate: '2027-01-29',
    courseKey: classMeetingKey(first), createdAt: first.importedAt,
    date: '2027-01-31', startTime: '23:00', endDate: '2027-02-01', endTime: '01:15',
  }] }, { ...last, dayOfWeek: 1, semester: '2' },
  { ...meeting('前學期未排課', '11:00', '12:00'), dayOfWeek: undefined }];
  expect(savedClassGaps(rows, 'pu', new Date('2027-01-30T23:30:00+08:00'), 'day-after-tomorrow')).toEqual([{
    startAt: Date.parse('2027-02-01T01:15:00+08:00'), endAt: Date.parse('2027-02-01T14:00:00+08:00'),
  }]);
  expect(savedClassGaps([...rows, {
    ...meeting('新學期未排課', '11:00', '12:00'), semester: '2', dayOfWeek: undefined,
  }], 'pu', new Date('2027-01-30T23:30:00+08:00'), 'day-after-tomorrow')).toBeUndefined();
});

test('a previous weekday cannot invent a free period before the first class or on a single-class day', () => {
  const thursday = meeting('週四', '14:00', '15:00', 4);
  const fridayMorning = meeting('週五上午', '10:00', '11:00');
  const fridayAfternoon = meeting('週五下午', '14:00', '15:00');
  expect(savedClassGaps([thursday, fridayMorning, fridayAfternoon], 'pu', new Date(at('08:00')), 'today')).toEqual([
    { startAt: at('11:00'), endAt: at('14:00') },
  ]);
  expect(savedClassGaps(
    [first, last, meeting('週六專題', '10:00', '12:00', 6)],
    'pu', new Date(at('10:00')), 'tomorrow',
  )).toEqual([]);
});

test('Friday-to-Saturday and Sunday-to-Monday gaps stay on the requested weekday', () => {
  const saturday = [
    meeting('週六上午', '10:00', '11:00', 6), meeting('週六下午', '14:00', '15:00', 6),
  ];
  expect(savedClassGaps([first, last, ...saturday], 'pu', new Date(at('10:00')), 'tomorrow')).toEqual([
    { startAt: Date.parse('2026-11-07T11:00:00+08:00'), endAt: Date.parse('2026-11-07T14:00:00+08:00') },
  ]);
  const sundayNight = new Date('2026-11-08T21:00:00+08:00');
  expect(savedClassGaps([
    meeting('週日', '09:00', '12:00', 7),
    meeting('週一上午', '09:00', '10:00', 1), meeting('週一下午', '13:00', '15:00', 1),
  ], 'pu', sundayNight, 'tomorrow')).toEqual([{
    startAt: Date.parse('2026-11-09T10:00:00+08:00'), endAt: Date.parse('2026-11-09T13:00:00+08:00'),
  }]);
});
