import {
  inspectCampusClockAvailability, selectCampusClockStudySlot,
  type CampusClockAvailability, type CampusClockInterval, type CampusClockClass,
} from '../../services/campusClockAvailability';
import { classMeetingKey, type ClassException, type PersonalImportRecord } from '@campus/shared';
import { scheduledSavedClasses, nextSavedClasses } from '../../services/nextSavedClasses';

const date = '2026-11-08'; // Sunday in Taiwan; results never depend on the device's timezone.
const at = (clock: string, day = date) => Date.parse(`${day}T${clock}+08:00`);
const iso = (clock: string, day = date) => new Date(at(clock, day)).toISOString();
const range = (start: string, end: string, day = date): CampusClockInterval => ({ startAt: iso(start, day), endAt: iso(end, day) });
const course = (start: string, end: string, patch: Partial<CampusClockClass> = {}): CampusClockClass => ({
  name: '資料庫', room: '', ...range(start, end), ...patch,
});
const read = (...courses: CampusClockClass[]) => inspectCampusClockAvailability(courses, date);
const known = (...gaps: CampusClockInterval[]): CampusClockAvailability => ({ valid: true, gaps, conflicts: [] });

test.each([null, undefined])('an unavailable source never becomes an empty day or a free period: %s', (courses) => {
  const result = inspectCampusClockAvailability(courses, date);
  expect(result).toEqual({ valid: false, reason: 'unavailable', gaps: [], conflicts: [] });
  expect(selectCampusClockStudySlot(result, at('08:00'))).toBeNull();
});

test('empty and single-meeting days provide no gap before the first or after the last class', () => {
  expect(read()).toEqual({ valid: true, gaps: [], conflicts: [] });
  expect(read(course('10:00', '11:00'))).toEqual({ valid: true, gaps: [], conflicts: [] });
  expect(selectCampusClockStudySlot(read(), at('08:00'))).toBeNull();
  expect(selectCampusClockStudySlot(read(course('10:00', '11:00')), at('12:00'))).toBeNull();
});

test('nested, overlapping and adjacent meetings are unioned before between-class gaps are found', () => {
  const result = read(course('14:00', '15:00'), course('09:00', '10:00'), course('12:30', '13:00'),
    course('08:00', '12:00'), course('11:30', '12:30'));
  expect(result).toEqual({ valid: true,
    gaps: [range('13:00', '14:00')],
    conflicts: [range('09:00', '10:00'), range('11:30', '12:00')],
  });
});

test('half-open adjacent meetings create neither a gap nor a conflict', () => {
  expect(read(course('09:00', '10:00'), course('10:00', '11:00'))).toEqual({ valid: true, gaps: [], conflicts: [] });
});

test('duplicate meetings retain their overlap count, even with identical names and rooms', () => {
  const repeated = course('09:00', '10:00');
  expect(read(repeated, { ...repeated }, { ...repeated }, course('11:00', '12:00'))).toEqual({
    valid: true, gaps: [range('10:00', '11:00')], conflicts: [range('09:00', '10:00')],
  });
});

test('adjacent conflict segments merge even when a different pair of classes causes each segment', () => {
  expect(read(course('09:00', '10:00'), course('09:30', '10:30'), course('10:00', '11:00'))).toEqual({
    valid: true, gaps: [], conflicts: [range('09:30', '10:30')],
  });
});

test('second and millisecond boundaries are not rounded into fictitious gaps or overlaps', () => {
  expect(read(course('09:00', '10:00:00.001'), course('10:00', '11:00'))).toEqual({
    valid: true, gaps: [], conflicts: [range('10:00', '10:00:00.001')],
  });
  expect(read(course('09:00', '10:00'), course('10:00:00.001', '11:00'))).toEqual({
    valid: true, gaps: [range('10:00', '10:00:00.001')], conflicts: [],
  });
});

test('equivalent Z and explicit offsets represent the same meeting instant', () => {
  expect(read(
    course('09:00', '10:00', { startAt: '2026-11-07T20:00:00-05:00', endAt: '2026-11-08T10:00:00+08:00' }),
    course('09:00', '10:00'),
  )).toEqual({ valid: true, gaps: [], conflicts: [range('09:00', '10:00')] });
});

test('overnight meetings are clipped to this Taiwan day while retaining their conflict multiplicity', () => {
  const previous = course('00:00', '01:00', { startAt: iso('23:00', '2026-11-07') });
  const next = course('23:00', '23:59', { endAt: iso('01:00', '2026-11-09') });
  const result = read(previous, { ...previous }, next);
  expect(result).toEqual({ valid: true,
    gaps: [range('01:00', '23:00')],
    conflicts: [range('00:00', '01:00')],
  });
  expect(read(next, { ...next })).toEqual({ valid: true, gaps: [], conflicts: [{
    startAt: iso('23:00'), endAt: iso('00:00', '2026-11-09'),
  }] });
});

test('calendar year crossings and an exactly 24-hour meeting preserve half-open day boundaries', () => {
  const overnight = { name: '跨年實作', room: 'B201', startAt: '2026-12-31T23:00:00+08:00', endAt: '2027-01-01T01:00:00+08:00' };
  expect(inspectCampusClockAvailability([overnight, { ...overnight }], '2027-01-01')).toEqual({
    valid: true, gaps: [], conflicts: [range('00:00', '01:00', '2027-01-01')],
  });
  const fullDay = course('00:00', '23:59', { endAt: iso('00:00', '2026-11-09') });
  expect(read(fullDay, { ...fullDay })).toEqual({ valid: true, gaps: [], conflicts: [{
    startAt: iso('00:00'), endAt: iso('00:00', '2026-11-09'),
  }] });
});

test('the occupancy calculation does not apply preparation hours or buffers to the saved evidence', () => {
  expect(read(course('01:00', '02:00'), course('23:00', '23:30'))).toEqual({
    valid: true, gaps: [range('02:00', '23:00')], conflicts: [],
  });
});

test.each([
  '', '2026-1-1', ' 2026-11-08', '2026-11-08T00:00:00Z',
  '2026-02-29', '2026-02-30', '2100-02-29', '2026-11-31', '2026-13-01', '2026-00-01', '2026-11-00',
])('rejects an invalid or normalized calendar date: %s', (day) => {
  expect(inspectCampusClockAvailability([], day)).toEqual({ valid: false, reason: 'invalid-date', gaps: [], conflicts: [] });
});

test.each(['2000-02-29', '2028-02-29'])('accepts real leap days: %s', (day) => {
  expect(inspectCampusClockAvailability([{ name: '課一', room: '', ...range('09:00', '10:00', day) },
    { name: '課二', room: '', ...range('11:00', '12:00', day) }], day)).toEqual({
    valid: true, gaps: [range('10:00', '11:00', day)], conflicts: [],
  });
});

test.each([
  ['date-only', { startAt: '2026-11-08' }],
  ['offset-free', { startAt: '2026-11-08T09:00:00' }],
  ['normalized invalid day', { startAt: '2026-02-30T09:00:00+08:00' }],
  ['normalized 24-hour clock', { startAt: '2026-11-07T24:00:00+08:00' }],
  ['invalid minute', { startAt: '2026-11-08T09:60:00+08:00' }],
  ['invalid second', { startAt: '2026-11-08T09:00:60+08:00' }],
  ['overprecise fraction', { startAt: '2026-11-08T09:00:00.0001+08:00' }],
  ['invalid timezone hours', { startAt: '2026-11-08T09:00:00+15:00' }],
  ['invalid timezone minutes', { startAt: '2026-11-08T09:00:00+08:60' }],
  ['offset over positive 14 hours', { startAt: '2026-11-08T09:00:00+14:01' }],
  ['offset over negative 14 hours', { startAt: '2026-11-08T09:00:00-14:01' }],
  ['zero duration', { endAt: iso('09:00') }],
  ['reversed duration', { endAt: iso('08:59') }],
  ['over 24 hours', { endAt: iso('09:00:00.001', '2026-11-09') }],
  ['blank title', { name: '   ' }],
  ['oversized title', { name: '課'.repeat(241) }],
  ['oversized room', { room: '室'.repeat(241) }],
  ['missing room', { room: undefined }],
] as const)('one invalid meeting makes the whole day unverifiable instead of inventing a gap: %s', (_label, patch) => {
  const result = read(course('08:00', '09:00'), course('12:00', '13:00'), course('09:00', '10:00', patch));
  expect(result).toEqual({ valid: false, reason: 'invalid-course', gaps: [], conflicts: [] });
  expect(selectCampusClockStudySlot(result, at('08:00'))).toBeNull();
});

test.each([
  { startAt: iso('23:00', '2026-11-07'), endAt: iso('00:00') },
  { startAt: iso('00:00', '2026-11-09'), endAt: iso('01:00', '2026-11-09') },
  { startAt: iso('09:00', '2026-11-07'), endAt: iso('10:00', '2026-11-07') },
])('out-of-day evidence, including a touching midnight endpoint, invalidates rather than silently disappearing: %j', (patch) => {
  expect(read(course('08:00', '09:00'), course('12:00', '13:00'), course('09:00', '10:00', patch))).toEqual({
    valid: false, reason: 'out-of-day', gaps: [], conflicts: [],
  });
});

test('valid extreme offsets are accepted when their instants fall on the requested Taiwan date', () => {
  expect(read(course('09:00', '10:00', { startAt: '2026-11-08T15:00:00+14:00', endAt: '2026-11-07T12:00:00-14:00' }),
    course('11:00', '12:00'))).toEqual({ valid: true, gaps: [range('10:00', '11:00')], conflicts: [] });
});

test('missing rows, sparse arrays, nonarrays and nonstring clocks fail closed', () => {
  const invalidRows: unknown[] = [[null], [undefined], new Array(1), {}, [course('09:00', '10:00', { startAt: 1 as never })]];
  for (const rows of invalidRows) expect(inspectCampusClockAvailability(rows as CampusClockClass[], date)).toEqual({
    valid: false, reason: 'invalid-course', gaps: [], conflicts: [],
  });
  expect(inspectCampusClockAvailability([], null as never).valid).toBe(false);
});

test('all 80 allowed occurrences participate; overflow is unknown rather than a truncated empty interval', () => {
  const rows = Array.from({ length: 80 }, () => course('09:00', '10:00'));
  expect(inspectCampusClockAvailability(rows, date)).toEqual({ valid: true, gaps: [], conflicts: [range('09:00', '10:00')] });
  expect(inspectCampusClockAvailability([...rows, course('11:00', '12:00')], date)).toEqual({
    valid: false, reason: 'too-many-courses', gaps: [], conflicts: [],
  });
});

test('sorting and output changes never mutate the caller snapshot or another result', () => {
  const rows = Object.freeze([Object.freeze(course('11:00', '12:00')), Object.freeze(course('09:00', '10:00'))]);
  const result = inspectCampusClockAvailability(rows, date);
  expect(rows[0].startAt).toBe(iso('11:00'));
  result.gaps[0].startAt = 'changed';
  expect(inspectCampusClockAvailability(rows, date).gaps).toEqual([range('10:00', '11:00')]);
});

test('derived intervals agree with an independent occupancy reference over 150 deterministic schedules', () => {
  let seed = 70921;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 150; run++) {
    const minutes = Array.from({ length: 1 + Math.floor(random() * 15) }, () => {
      const start = Math.floor(random() * 60);
      return { start, end: start + 1 + Math.floor(random() * 30) };
    });
    const rows = minutes.map(({ start, end }, index) => ({ name: '課 ' + index, room: '',
      startAt: new Date(at('09:00') + start * 60_000).toISOString(),
      endAt: new Date(at('09:00') + end * 60_000).toISOString() }));
    const result = inspectCampusClockAvailability(rows, date);
    expect(result.valid).toBe(true);
    const first = Math.min(...minutes.map((row) => row.start));
    const last = Math.max(...minutes.map((row) => row.end));
    const counts = Array.from({ length: 90 }, (_, minute) => minutes.filter((row) => row.start <= minute && row.end > minute).length);
    const contains = (ranges: CampusClockInterval[], minute: number) => {
      const instant = at('09:00') + (minute + 0.5) * 60_000;
      return ranges.some((range) => Date.parse(range.startAt) <= instant && Date.parse(range.endAt) > instant);
    };
    expect(counts.map((_, minute) => contains(result.gaps, minute))).toEqual(counts.map((count, minute) => minute >= first && minute < last && count === 0));
    expect(counts.map((_, minute) => contains(result.conflicts, minute))).toEqual(counts.map((count) => count >= 2));
  }
});

test('a study suggestion starts at or after now, rounded upward to the next five-minute boundary', () => {
  const availability = read(course('09:00', '10:00'), course('11:00', '12:00'));
  expect(selectCampusClockStudySlot(availability, at('10:07:32'))).toEqual(range('10:10', '10:40'));
  expect(selectCampusClockStudySlot(availability, at('10:05'))).toEqual(range('10:05', '10:35'));
  expect(selectCampusClockStudySlot(availability, at('09:00'))).toEqual(range('10:00', '10:30'));
});

test('rounds a fractional gap start upward before checking the full duration, without rounding the gap wider', () => {
  const availability = read(course('09:00', '10:00:00.001'), course('10:35', '11:00'));
  expect(selectCampusClockStudySlot(availability, at('08:00'))).toEqual(range('10:05', '10:35'));
  expect(selectCampusClockStudySlot(read(course('09:00', '10:00:00.001'), course('10:34:59.999', '11:00')), at('08:00'))).toBeNull();
  expect(selectCampusClockStudySlot(read(course('09:00', '10:00'), course('10:30', '11:00')), at('10:00:00.001'))).toBeNull();
});

test('keeps exactly 30 minutes inside the gap and on or before the deadline, including millisecond boundaries', () => {
  const availability = read(course('09:00', '10:00'), course('10:35', '11:00'));
  expect(selectCampusClockStudySlot(availability, at('10:00:01'), at('10:35'))).toEqual(range('10:05', '10:35'));
  expect(selectCampusClockStudySlot(availability, at('10:00:01'), at('10:34:59.999'))).toBeNull();
  expect(selectCampusClockStudySlot(availability, at('10:00'), at('10:30'))).toEqual(range('10:00', '10:30'));
  expect(selectCampusClockStudySlot(availability, at('10:00'), at('09:59'))).toBeNull();
});

test('skips elapsed or too-short gaps and never extends a suggestion outside the saved between-class intervals', () => {
  const availability = read(course('08:00', '09:00'), course('09:20', '10:00'),
    course('10:30', '11:00'), course('11:35', '12:00'));
  expect(selectCampusClockStudySlot(availability, at('08:00'))).toEqual(range('10:00', '10:30'));
  expect(selectCampusClockStudySlot(availability, at('10:00:00.001'))).toEqual(range('11:00', '11:30'));
  expect(selectCampusClockStudySlot(availability, at('12:00'))).toBeNull();
  expect(selectCampusClockStudySlot(availability, at('10:00:00.001'), at('10:30'))).toBeNull();
});

test('chooses the earliest fitting gap across days without mutating or reserving caller intervals', () => {
  const availability = known(range('10:00', '11:00', '2026-11-09'), range('10:00', '11:00'));
  const before = JSON.stringify(availability);
  const slot = selectCampusClockStudySlot(availability, at('08:00'))!;
  expect(slot).toEqual(range('10:00', '10:30'));
  slot.endAt = 'changed';
  expect(JSON.stringify(availability)).toBe(before);
  expect(selectCampusClockStudySlot(availability, at('12:00'))).toEqual(range('10:00', '10:30', '2026-11-09'));
});

test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '2026-11-08' as never])('invalid now or deadline never permits a suggested slot: %s', (instant) => {
  const availability = known(range('10:00', '11:00'));
  expect(selectCampusClockStudySlot(availability, instant)).toBeNull();
  expect(selectCampusClockStudySlot(availability, at('08:00'), instant)).toBeNull();
});

test('invalid, sparse or contradictory caller-narrowed intervals never produce a study slot', () => {
  const invalidSources: unknown[] = [
    null, { valid: 'yes', gaps: [range('10:00', '11:00')], conflicts: [] },
    { valid: false, reason: 'unavailable', gaps: [range('10:00', '11:00')], conflicts: [] },
    { valid: true, gaps: new Array(1), conflicts: [] },
    { valid: true, gaps: [range('10:00', '11:00')], conflicts: new Array(1) },
    { valid: true, gaps: 'not a list', conflicts: [] },
    known({ startAt: '2026-11-08T10:00:00', endAt: iso('11:00') }),
    known(range('10:00', '10:00')), known(range('11:00', '10:00')),
    known(range('10:00', '11:00'), range('10:30', '11:30')),
    { ...known(range('10:00', '11:00')), conflicts: [range('10:30', '11:30')] },
  ];
  for (const source of invalidSources) expect(selectCampusClockStudySlot(source as CampusClockAvailability, at('08:00'))).toBeNull();
});

test('half-open conflict endpoints may touch a gap without invalidating it', () => {
  const availability: CampusClockAvailability = { valid: true, gaps: [range('10:00', '11:00')],
    conflicts: [range('09:00', '10:00'), range('11:00', '12:00')] };
  expect(selectCampusClockStudySlot(availability, at('08:00'))).toEqual(range('10:00', '10:30'));
});

describe('complete saved class occurrences for preparation suggestions', () => {
  const row = (id: string, startTime: string, endTime: string,
    patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
    id, kind: 'timetable', schoolId: 'pu', academicYear: '115', semester: '1',
    title: id, location: '', dayOfWeek: 7, startTime, endTime,
    batchId: 'classes', importedAt: '2026-11-01T00:00:00.000Z',
    source: { type: 'paste', line: 1, rawText: '' }, ...patch,
  });
  const change = (original: PersonalImportRecord, patch: Partial<ClassException> = {}): ClassException => ({
    id: `change-${original.id}`, original, courseKey: classMeetingKey(original),
    originalDate: date, kind: 'cancel', createdAt: '2026-11-01T00:00:00.000Z', ...patch,
  });
  const inspect = (records: PersonalImportRecord[], day = date) => {
    const entries = scheduledSavedClasses(records, 'pu', day);
    return inspectCampusClockAvailability(entries?.map((entry) => ({
      name: entry.row.title, room: entry.row.location ?? '',
      startAt: new Date(entry.startAt).toISOString(), endAt: new Date(entry.endAt).toISOString(),
    })), day);
  };
  const knownDay = () => [row('first', '09:00', '10:00'), row('last', '12:00', '13:00')];

  test('reads Sunday clock occurrences and keeps the source records unchanged', () => {
    const records = knownDay();
    const before = JSON.stringify(records);
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
    expect(JSON.stringify(records)).toBe(before);
  });

  test('does not borrow other schools or non-timetable records to establish occupancy', () => {
    expect(inspect([...knownDay(), row('other-campus', '10:00', '12:00', { schoolId: 'ncku' }),
      row('event', '10:00', '12:00', { kind: 'events', date, allDay: false })])).toEqual({
      valid: true, gaps: [range('10:00', '12:00')], conflicts: [],
    });
    expect(scheduledSavedClasses([row('other-campus', '09:00', '12:00', { schoolId: 'ncku' })], 'pu', date)).toEqual([]);
  });

  test.each([undefined, 0, 8, 1.5, NaN])('a missing or invalid current weekday is unknown: %s', (dayOfWeek) => {
    const records = [...knownDay(), row('unplaced', '10:00', '11:00', { dayOfWeek })];
    expect(scheduledSavedClasses(records, 'pu', date)).toBeUndefined();
    expect(inspect(records)).toMatchObject({ valid: false, reason: 'unavailable' });
  });

  test('does not change the existing named-class query behavior for unplaced rows', () => {
    const records = [...knownDay(), row('unplaced', '10:00', '11:00', { dayOfWeek: undefined })];
    expect(scheduledSavedClasses(records, 'pu', date)).toBeUndefined();
    expect(nextSavedClasses(records, 'pu', new Date(at('08:00')))).toEqual([
      expect.objectContaining({ courseId: 'first', date, startTime: '09:00', endTime: '10:00' }),
    ]);
  });

  test.each([
    { startTime: undefined }, { endTime: undefined }, { startTime: '25:00' },
    { startTime: '09:60' }, { startTime: '10:00', endTime: '10:00' },
    { startTime: '11:00', endTime: '10:00' },
  ])('one invalid current course clock prevents a preparation gap: %j', (patch) => {
    expect(scheduledSavedClasses([...knownDay(), row('invalid', '10:00', '11:00', patch)], 'pu', date)).toBeUndefined();
  });

  test('unknown school-term metadata cannot silently disappear from the daily source', () => {
    expect(scheduledSavedClasses([...knownDay(), row('unknown-term', '10:00', '11:00', {
      academicYear: '未填', semester: '',
    })], 'pu', date)).toBeUndefined();
    expect(scheduledSavedClasses([row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2' })], 'pu', date)).toBeUndefined();
  });

  test('unplaced records in an unrelated valid term do not hide this term’s confirmed classes', () => {
    const records = [...knownDay(), row('old-term', '10:00', '11:00', {
      academicYear: '114', semester: '2', dayOfWeek: undefined,
    }), row('future-term', '10:00', '11:00', { semester: '2', dayOfWeek: undefined })];
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
  });

  test('recognizes the existing normalized year and semester aliases without changing returned rows', () => {
    const records = knownDay().map((item) => ({ ...item, academicYear: '2026', semester: '上學期' }));
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
    expect(scheduledSavedClasses(records, 'pu', date)?.[0].row.academicYear).toBe('2026');
  });

  test('unknown input and invalid dates do not become an empty timetable', () => {
    expect(scheduledSavedClasses(knownDay(), 'pu', '2026-02-30')).toBeUndefined();
    for (const records of [null, {}, new Array(1), [null]]) {
      expect(scheduledSavedClasses(records as never, 'pu', date)).toBeUndefined();
    }
    expect(scheduledSavedClasses([], 'pu', date)).toEqual([]);
  });

  test('a validated single-day cancellation removes only the cancelled occurrence', () => {
    const middle = row('middle', '10:30', '11:00');
    const records = [...knownDay(), { ...middle, classExceptions: [change(middle)] }];
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
    expect(scheduledSavedClasses(records, 'pu', '2026-11-15')?.map((item) => item.row.id)).toEqual(['first', 'middle', 'last']);
  });

  test('includes a moved occurrence from a different weekday before selecting any slot', () => {
    const monday = row('monday', '09:00', '10:00', { dayOfWeek: 1 });
    const records = [...knownDay(), { ...monday, classExceptions: [change(monday, {
      originalDate: '2026-11-09', kind: 'move', date, startTime: '10:15', endTime: '10:45',
    })] }];
    const availability = inspect(records);
    expect(availability).toEqual({ valid: true,
      gaps: [range('10:00', '10:15'), range('10:45', '12:00')], conflicts: [],
    });
    expect(selectCampusClockStudySlot(availability, at('08:00'))).toEqual(range('10:45', '11:15'));
  });

  test('a room-only change preserves the clock and returns the changed room', () => {
    const first = row('first', '09:00', '10:00');
    const records = [{ ...first, classExceptions: [change(first, { kind: 'room', location: '新教室' })] },
      row('last', '12:00', '13:00')];
    expect(inspect(records).gaps).toEqual([range('10:00', '12:00')]);
    expect(scheduledSavedClasses(records, 'pu', date)?.[0].row.location).toBe('新教室');
  });

  test('retains an overnight moved class that occupies the start of the requested date', () => {
    const saturday = row('saturday', '09:00', '10:00', { dayOfWeek: 6 });
    const records = [{ ...saturday, classExceptions: [change(saturday, {
      originalDate: '2026-11-07', kind: 'move', date: '2026-11-07', endDate: date,
      startTime: '23:00', endTime: '01:00',
    })] }, row('early', '02:00', '03:00')];
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('01:00', '02:00')], conflicts: [] });
  });

  test('retains the previous term’s overnight occurrence at a semester boundary', () => {
    const friday = row('friday', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [{ ...friday, classExceptions: [change(friday, {
      originalDate: '2026-07-31', kind: 'move', date: '2026-07-31', endDate: '2026-08-01',
      startTime: '23:00', endTime: '01:00',
    })] }, row('new-term', '02:00', '03:00', { dayOfWeek: 6 })];
    expect(inspect(records, '2026-08-01')).toEqual({
      valid: true, gaps: [range('01:00', '02:00', '2026-08-01')], conflicts: [],
    });
  });

  test('a prior-term move starting on the new term’s first day cannot be filtered into a free gap', () => {
    const firstDay = '2026-08-01';
    const friday = row('prior-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay().map((item) => ({ ...item, dayOfWeek: 6 })),
      { ...friday, classExceptions: [change(friday, {
        originalDate: '2026-07-31', kind: 'move', date: firstDay, startTime: '10:15', endTime: '10:45',
      })] }];
    expect(scheduledSavedClasses(records, 'pu', firstDay)).toBeUndefined();
    expect(inspect(records, firstDay)).toMatchObject({ valid: false, reason: 'unavailable' });
  });

  test('a current-term move starting in the previous term’s last night remains unknown', () => {
    const firstDay = '2026-08-01';
    const saturday = row('current-term', '14:00', '15:00', { dayOfWeek: 6 });
    const records = [...knownDay().map((item) => ({ ...item, dayOfWeek: 6 })),
      { ...saturday, classExceptions: [change(saturday, {
        originalDate: firstDay, kind: 'move', date: '2026-07-31', endDate: firstDay,
        startTime: '23:00', endTime: '10:45',
      })] }];
    expect(scheduledSavedClasses(records, 'pu', firstDay)).toBeUndefined();
    expect(inspect(records, firstDay)).toMatchObject({ valid: false, reason: 'unavailable' });
  });

  test('a previous term’s dated move into this day cannot become an available study interval', () => {
    const old = row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay(), { ...old, classExceptions: [change(old, {
      originalDate: '2026-07-24', kind: 'move', date, startTime: '10:15', endTime: '10:45',
    })] }];
    expect(scheduledSavedClasses(records, 'pu', date)).toBeUndefined();
    expect(inspect(records)).toMatchObject({ valid: false, reason: 'unavailable' });
  });

  test('an unrelated term’s moved class spanning last night still makes this date unknown', () => {
    const old = row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay(), { ...old, classExceptions: [change(old, {
      originalDate: '2026-07-24', kind: 'move', date: '2026-11-07', endDate: date,
      startTime: '23:00', endTime: '10:45',
    })] }];
    expect(scheduledSavedClasses(records, 'pu', date)).toBeUndefined();
  });

  test('an old term’s past unrelated move does not hide the current term’s available interval', () => {
    const old = row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay(), { ...old, classExceptions: [change(old, {
      originalDate: '2026-07-24', kind: 'move', date: '2026-07-25', startTime: '10:15', endTime: '10:45',
    })] }];
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
  });

  test('an old term’s moved class ending exactly at midnight does not occupy the following day', () => {
    const old = row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay(), { ...old, classExceptions: [change(old, {
      originalDate: '2026-07-24', kind: 'move', date: '2026-11-07', endDate: date,
      startTime: '23:00', endTime: '00:00',
    })] }];
    expect(inspect(records)).toEqual({ valid: true, gaps: [range('10:00', '12:00')], conflicts: [] });
  });

  test('unreadable exceptions from an old term remain unknown instead of being silently discarded', () => {
    const old = row('old-term', '09:00', '10:00', { academicYear: '114', semester: '2', dayOfWeek: 5 });
    const records = [...knownDay(), { ...old, classExceptions: [change(old, {
      originalDate: '2026-07-24', kind: 'move', date: 'unknown', startTime: '10:15', endTime: '10:45',
    })] }];
    expect(scheduledSavedClasses(records, 'pu', date)).toBeUndefined();
  });

  test('does not silently filter a malformed or ambiguous class exception into free time', () => {
    const middle = row('middle', '10:30', '11:00');
    const malformed: unknown[] = [
      [change(middle, { kind: 'move', date, startTime: '10:00', endTime: '09:00' })],
      [change(middle, { originalDate: '2026-11-09' })],
      [change(middle), change(middle, { id: 'another-change' })],
      [change(middle), change(middle, { originalDate: '2026-11-15' })],
      [null], {},
    ];
    for (const classExceptions of malformed) {
      expect(scheduledSavedClasses([...knownDay(), { ...middle, classExceptions: classExceptions as never }], 'pu', date)).toBeUndefined();
    }
  });

  test('a valid exception for another course cannot remove this course’s occupancy', () => {
    const middle = row('middle', '10:30', '11:00');
    const other = row('different-course', '10:30', '11:00');
    expect(scheduledSavedClasses([...knownDay(), { ...middle, classExceptions: [change(other)] }], 'pu', date)).toBeUndefined();
  });
});
