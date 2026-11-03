import { sha256 } from 'js-sha256';
import type { PersonalImportRecord } from '../imports/types';
import { buildPersonalToday } from '../imports/today';
import { escapeIcsText, foldIcsLine, utcIcsStamp } from '../imports/icalendarSerialization';
import { classDate, classMeetingKey, classMeetingTimes, validClassDate } from './classExceptions';

export const personalCalendarSnapshotCopy =
  '這是目前課表的快照，不會自動更新。課表調整後請重新匯出；重複匯入可能產生重複行程。';
export function calendarRangeEnd(start: string, days = 7): string {
  return validClassDate(start)
    ? classDate(new Date(Date.parse(`${start}T00:00:00+08:00`) + (days - 1) * 86400000))
    : '';
}

export function previewPersonalCalendar(
  records: readonly PersonalImportRecord[],
  options: {
    schoolId: string;
    termKey: string;
    start: string;
    end: string;
  },
) {
  const { schoolId, termKey, start, end } = options;
  if (!validClassDate(start) || !validClassDate(end))
    throw new Error('請填寫有效的開始與結束日期。');
  const from = Date.parse(`${start}T00:00:00+08:00`);
  const until = Date.parse(`${end}T00:00:00+08:00`) + 86400000;
  if (until <= from || until - from > 56 * 86400000)
    throw new Error('請選擇一至五十六天，最多匯出八週。');
  // Filter first so a missing selected term never falls back to a different semester.
  const rows = records.filter(
    (row) =>
      row.schoolId === schoolId &&
      row.kind === 'timetable' &&
      `${row.academicYear}|${row.semester}` === termKey,
  );
  const skipped = rows.filter((row) => {
    const [a, b] = classMeetingTimes(row);
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    return (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek! < 1 ||
      row.dayOfWeek! > 7 ||
      !a ||
      !b ||
      !clock.test(a) ||
      !clock.test(b) ||
      a >= b
    );
  });
  const entries = new Map<string, ReturnType<typeof buildPersonalToday>['today'][number]>();
  for (let day = from; day < until; day += 86400000) {
    for (const entry of buildPersonalToday(rows, {
      schoolId,
      termKey,
      now: new Date(day + 43200000),
    }).today) {
      if (entry.startAt < from || entry.startAt >= until) continue;
      // Meeting identity excludes generated import ids, file names and import time.
      const identity = JSON.stringify([
        classMeetingKey(entry.row),
        entry.originalDate,
        entry.startAt,
        entry.endAt,
      ]);
      entries.set(identity, entry);
    }
  }
  const events = [...entries]
    .sort((a, b) => a[1].startAt - b[1].startAt)
    .map(([, entry]) => {
      // Retain the original meeting date when a single occurrence is rescheduled.
      const identity = JSON.stringify([classMeetingKey(entry.row), entry.originalDate]);
      return {
        ...entry,
        uid: `personal-${sha256(identity)}@nuni.tw`,
      };
    });
  return { events, skipped };
}

export function serializePersonalCalendar(
  preview: ReturnType<typeof previewPersonalCalendar>,
  now = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nuni//Personal timetable//TW',
    'CALSCALE:GREGORIAN',
    'X-WR-TIMEZONE:Asia/Taipei',
  ];
  for (const event of preview.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${utcIcsStamp(now)}`,
      `DTSTART:${utcIcsStamp(new Date(event.startAt))}`,
      `DTEND:${utcIcsStamp(new Date(event.endAt))}`,
      `SUMMARY:${escapeIcsText(event.row.title)}`,
      `LOCATION:${escapeIcsText(event.row.location || '')}`,
      `DESCRIPTION:${escapeIcsText(personalCalendarSnapshotCopy)}`,
      'END:VEVENT',
    );
  }
  return [...lines, 'END:VCALENDAR'].map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Explicit Taiwan dates, including the end date for overnight meetings. */
export function personalCalendarEventLabel(
  event: ReturnType<typeof previewPersonalCalendar>['events'][number],
): string {
  const stamp = (time: number) =>
    new Date(time + 28800000).toISOString().slice(0, 16).replace('T', ' ');
  return `${stamp(event.startAt)} ～ ${stamp(event.endAt)} ${event.row.title}｜${event.row.location || '未填教室'}${event.conflict ? '（時段重疊，仍保留此堂）' : ''}`;
}
