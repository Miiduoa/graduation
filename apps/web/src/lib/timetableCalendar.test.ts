import { describe, expect, it } from 'vitest';
import type { AcademicCourse } from './academicRecords';
import { buildUpcomingTimetableCalendar } from './timetableCalendar';

function course(overrides: Partial<AcademicCourse> = {}): AcademicCourse {
  return {
    id: 'course-db',
    semester: '1151',
    code: 'IM201',
    name: '資料庫系統',
    nameEn: '',
    classOffered: '資管二A',
    courseType: '必修',
    credits: 3,
    dayOfWeek: 4,
    periods: [3, 4],
    startTime: '10:10',
    endTime: '12:00',
    location: '主顧 301',
    timePlaceRaw: '',
    teacherName: '王老師',
    teacherEmail: '',
    scheduleWarning: null,
    ...overrides,
  };
}

const THURSDAY_IN_TAIWAN = new Date('2026-10-07T16:30:00Z');

describe('timetable calendar export', () => {
  it('exports four occurrences in Taiwan time rather than the device timezone', () => {
    const result = buildUpcomingTimetableCalendar([course()], THURSDAY_IN_TAIWAN);
    expect(result).toMatchObject({
      eventCount: 4,
      includedCourses: 1,
      skippedCourses: 0,
      firstDate: '2026-10-08',
      lastDate: '2026-11-04',
    });
    expect(result.content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(result.content).toContain('DTSTART:20261008T021000Z');
    expect(result.content).toContain('DTEND:20261008T040000Z');
    expect(result.content).toContain('DTSTART:20261029T021000Z');
    expect(result.content).not.toContain('DTSTART:20261105');
    expect(result.content).toMatch(/\r\nEND:VCALENDAR\r\n$/);
  });

  it('rolls through year boundaries and keeps stable event identities', () => {
    const monday = course({
      code: 'A100',
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '09:00',
    });
    const first = buildUpcomingTimetableCalendar([monday], new Date('2026-12-27T16:20:00Z'));
    const second = buildUpcomingTimetableCalendar([monday], new Date('2026-12-27T23:50:00Z'));
    expect(first.eventCount).toBe(4);
    expect(first.firstDate).toBe('2026-12-28');
    expect(first.lastDate).toBe('2027-01-24');
    expect(first.content).toContain('DTSTART:20270118T000000Z');
    expect(first.content.match(/UID:[^\r]+/g)).toEqual(second.content.match(/UID:[^\r]+/g));
  });

  it('omits uncertain and discontinuous schedules rather than fabricating class hours', () => {
    const result = buildUpcomingTimetableCalendar(
      [
        course({ code: 'A' }),
        course({ code: 'B', dayOfWeek: null }),
        course({ code: 'C', startTime: null }),
        course({ code: 'D', startTime: '25:00' }),
        course({ code: 'E', endTime: '10:00' }),
        course({ code: 'F', periods: [1, 3] }),
        course({ code: 'G', scheduleWarning: '待確認' }),
      ],
      THURSDAY_IN_TAIWAN,
    );
    expect(result).toMatchObject({
      includedCourses: 1,
      skippedCourses: 6,
      eventCount: 4,
    });
    expect(result.content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
  });

  it('escapes injected lines, commas and semicolons and folds Chinese UTF-8 safely', () => {
    const longTitle = '資訊安全課程'.repeat(20) + '\nBEGIN:VEVENT\nSUMMARY:偽造活動,;\\';
    const result = buildUpcomingTimetableCalendar(
      [
        course({
          name: longTitle,
          location: '教室,1;2\nDTSTART:19990101T000000Z',
        }),
      ],
      THURSDAY_IN_TAIWAN,
    );
    expect(result.content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(result.content).not.toContain('\r\nDTSTART:19990101');
    expect(result.content).toContain('\\nBEGIN:VEVENT\\nSUMMARY:偽造活動\\,\\;\\\\');
    expect(result.content).toContain('LOCATION:教室\\,1\\;2\\nDTSTART:19990101T000000Z');
    expect(result.content.split('\r\n').filter(Boolean).every(
      (line) => new TextEncoder().encode(line).length <= 75,
    )).toBe(true);
    expect(result.content).toMatch(/\r\n /);
  });

  it('preserves source records and produces an empty valid calendar with no known times', () => {
    const input = [course({ periods: [1, 3] })];
    const original = JSON.stringify(input);
    const result = buildUpcomingTimetableCalendar(input, THURSDAY_IN_TAIWAN);
    expect(result).toMatchObject({
      includedCourses: 0,
      skippedCourses: 1,
      eventCount: 0,
    });
    expect(result.content).toContain('BEGIN:VCALENDAR\r\n');
    expect(result.content).not.toContain('BEGIN:VEVENT');
    expect(JSON.stringify(input)).toBe(original);
  });

  it('rejects an invalid reference date', () => {
    expect(() => buildUpcomingTimetableCalendar([course()], new Date(NaN))).toThrow(
      '無法判定目前日期',
    );
  });
});
