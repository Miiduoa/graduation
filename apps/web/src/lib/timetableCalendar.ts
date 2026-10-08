import type { AcademicCourse } from './academicRecords';

const DAYS_AHEAD = 28;
const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_HOURS = 8;
const UTF8 = new TextEncoder();

export interface TimetableCalendarExport {
  content: string;
  eventCount: number;
  includedCourses: number;
  skippedCourses: number;
  firstDate: string;
  lastDate: string;
}

function clockMinutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function hasExportableSchedule(course: AcademicCourse): boolean {
  if (course.scheduleWarning || !Number.isInteger(course.dayOfWeek)) return false;
  if (course.dayOfWeek === null || course.dayOfWeek < 1 || course.dayOfWeek > 7) return false;
  if (
    course.periods.some(
      (period, index) => index > 0 && period !== course.periods[index - 1] + 1,
    )
  ) {
    return false;
  }
  const start = clockMinutes(course.startTime);
  const end = clockMinutes(course.endTime);
  return start !== null && end !== null && start < end;
}

function taipeiCalendarDate(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'));
}

function isoDate(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function classTimeUtc(day: Date, clock: string): Date {
  const [hours, minutes] = clock.split(':').map(Number);
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hours - TAIPEI_OFFSET_HOURS,
      minutes,
    ),
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(value: string): string {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of value) {
    const size = UTF8.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ' + character;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  lines.push(current);
  return lines.join('\r\n');
}

function eventUid(course: AcademicCourse, day: Date): string {
  const key = [
    course.id,
    course.code,
    course.name,
    course.dayOfWeek,
    course.startTime,
    course.endTime,
    course.location,
    isoDate(day),
  ].join('\u0000');
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + '-' +
    isoDate(day).replace(/-/g, '') + '@campus-one.local';
}

/**
 * Export a bounded, one-time calendar snapshot. School records do not provide
 * verified term dates or cancellation dates, so this is not a semester feed.
 */
export function buildUpcomingTimetableCalendar(
  courses: readonly AcademicCourse[],
  now: Date = new Date(),
): TimetableCalendarExport {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('無法判定目前日期');
  }
  const eligible = courses.filter(hasExportableSchedule);
  const firstDay = taipeiCalendarDate(now);
  const lastDay = firstDay + (DAYS_AHEAD - 1) * DAY_MS;
  const generatedAt = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus One//Timetable//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcsText('Campus One 課表（未來四週）'),
  ];
  let eventCount = 0;

  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    const day = new Date(firstDay + offset * DAY_MS);
    const dayOfWeek = day.getUTCDay() || 7;
    for (const course of eligible) {
      if (course.dayOfWeek !== dayOfWeek) continue;
      const details = [
        '課程代碼：' + course.code,
        course.teacherName ? '授課教師：' + course.teacherName : '',
        '來源：靜宜大學 e 校園課表（匯出時快照）',
      ].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + eventUid(course, day),
        'DTSTAMP:' + generatedAt,
        'DTSTART:' + utcStamp(classTimeUtc(day, course.startTime!)),
        'DTEND:' + utcStamp(classTimeUtc(day, course.endTime!)),
        'SUMMARY:' + escapeIcsText(course.name),
        'DESCRIPTION:' + escapeIcsText(details),
      );
      if (course.location) {
        lines.push('LOCATION:' + escapeIcsText(course.location));
      }
      lines.push('END:VEVENT');
      eventCount += 1;
    }
  }
  lines.push('END:VCALENDAR');

  return {
    content: lines.map(foldLine).join('\r\n') + '\r\n',
    eventCount,
    includedCourses: eligible.length,
    skippedCourses: courses.length - eligible.length,
    firstDate: isoDate(new Date(firstDay)),
    lastDate: isoDate(new Date(lastDay)),
  };
}
