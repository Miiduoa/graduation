import { expect, it } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { classMeetingKey } from '@campus/shared/src/timetable/classExceptions';
import {
  currentTermClassCalendarMeetings, findClassCalendarOverlaps, formatTodayClassCalendarOverlapAnswer,
} from '@campus/shared/src/classCalendarOverlap';

const today = '2026-11-24'; // Tuesday in Taipei
const at = (time: string) => Date.parse(`${today}T${time}:00+08:00`);
const course: PersonalImportRecord = {
  kind: 'timetable', id: 'course-1', schoolId: 'nchu', title: '資料庫', academicYear: '2026',
  semester: '上學期', dayOfWeek: 2, startTime: '10:00', endTime: '12:00', batchId: 'batch',
  importedAt: '2026-10-01T00:00:00Z', source: { type: 'paste', line: 1, rawText: '' },
};
const event: PersonalImportRecord = { ...course, kind: 'events', id: 'event-1', title: '小組討論',
  date: today, startTime: '11:00', endTime: '13:00' };
const meetings = (records: PersonalImportRecord[], time = '08:00') =>
  currentTermClassCalendarMeetings(records, course.schoolId, new Date(at(time)));

it('keeps original IDs and the full ongoing common interval until the exact end', () => {
  const { classes } = meetings([course]);
  const before = { ...event, startTime: '08:00', endTime: '10:00' };
  const after = { ...event, startTime: '12:00', endTime: '13:00' };
  const records = [before, after, event, { ...event, schoolId: 'nthu' }];
  expect(findClassCalendarOverlaps(classes, records, 'nchu', at('11:30'))).toEqual([{
    classId: 'course-1', classTitle: '資料庫', eventId: 'event-1', eventTitle: '小組討論',
    startAt: at('11:00'), endAt: at('12:00'),
  }]);
  expect(findClassCalendarOverlaps(classes, records, 'nchu', at('12:00'))).toEqual([]);
});

it('handles overnight events, same-title distinct IDs, and excludes all-day and invalid dates', () => {
  const { classes } = meetings([course]);
  const overnight = { ...event, id: 'event-2', date: '2026-11-23', endDate: today, startTime: '21:00', endTime: '10:30' };
  const invalid = { ...event, date: '2026-10-32', endDate: today };
  const rows = [event, { ...event, allDay: true }, invalid, overnight];
  expect(findClassCalendarOverlaps(classes, rows, 'nchu', at('08:00'))
    .map(({ eventId, startAt, endAt }) => [eventId, startAt, endAt])).toEqual([
    ['event-2', at('10:00'), at('10:30')], ['event-1', at('11:00'), at('12:00')],
  ]);
});

it('limits cross-midnight class and event intersections to today in Taipei', () => {
  const crossDay = { ...event, startTime: '23:30', endDate: '2026-11-25', endTime: '01:00' };
  const midnight = Date.parse('2026-11-25T00:00:00+08:00');
  const meeting = { id: 'm', title: '夜間課', startAt: at('23:00'), endAt: midnight + 3600000 };
  expect(findClassCalendarOverlaps([meeting], [crossDay], 'nchu', at('23:45'))[0])
    .toMatchObject({ startAt: at('23:30'), endAt: midnight });
});

it('uses the current Taiwan term and applied cancellation even for a noncanonical saved term label', () => {
  const stale = { ...course, academicYear: '114' };
  const future = { ...course, semester: '下學期' };
  expect(meetings([stale, future, { ...course, schoolId: 'nthu' }]).hasCurrentTerm).toBe(false);
  const cancelled = { ...course, classExceptions: [{ id: 'c', courseKey: classMeetingKey(course),
    original: course, originalDate: today, createdAt: course.importedAt, kind: 'cancel' as const }] };
  expect(meetings([cancelled, stale, future])).toEqual({ classes: [], hasCurrentTerm: true, unplacedCount: 0 });
  expect(currentTermClassCalendarMeetings([course], 'nchu', new Date('2027-01-31T16:00:00Z')).hasCurrentTerm).toBe(false);
  expect(currentTermClassCalendarMeetings([course], 'nchu', new Date('2027-01-31T15:59:59Z')).hasCurrentTerm).toBe(true);
});

it('distinguishes missing inputs, incomplete times, and the absence of a known timed overlap', () => {
  const answer = (records: PersonalImportRecord[]) =>
    formatTodayClassCalendarOverlapAnswer(records, 'nchu', new Date(at('08:00')), '這台手機').content;
  expect(answer([event])).toContain('還沒有可核對的本學期課表');
  expect(answer([course])).toContain('還沒有可核對的個人行程');
  expect(answer([])).not.toContain('沒有重疊');
  expect(answer([event, { ...course, dayOfWeek: undefined }])).toContain('1 筆本學期課程缺少');
  expect(answer([course, { ...event, startTime: '17:00', endTime: '18:00' }])).toContain('沒有重疊');
});
