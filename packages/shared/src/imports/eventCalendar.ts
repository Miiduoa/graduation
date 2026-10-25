import { validatePersonalImportRow } from './validation';
import type { PersonalImportRecord } from './types';
import { escapeIcsText, foldIcsLine, utcIcsStamp } from './icalendarSerialization';

const TAIPEI = 'Asia/Taipei';

export type PersonalEventsCalendarExport = {
  content: string;
  eventCount: number;
  skipped: number;
};

function compactDate(value: string): string {
  return value.replace(/-/g, '');
}

/** All-day DTEND is exclusive (iCalendar). Missing endDate → next calendar day. */
export function exclusiveAllDayEnd(date: string, endDate?: string): string | undefined {
  if (endDate) return endDate;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function timedStamp(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    return undefined;
  return `${compactDate(date)}T${time.replace(':', '')}00`;
}

/**
 * One-shot ICS snapshot of personal event records.
 * Exporting is not RSVP, enrollment, or automatic reminders.
 */
export function buildPersonalEventsCalendar(
  records: readonly PersonalImportRecord[],
  options: { now?: Date; calendarName?: string } = {},
): PersonalEventsCalendarExport {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('無法判定目前時間');
  const generatedAt = utcIcsStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus One//Personal Events//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:' + TAIPEI,
    'X-WR-CALNAME:' + escapeIcsText(options.calendarName || 'Campus One 個人行程'),
  ];
  let eventCount = 0;
  let skipped = 0;

  for (const row of records) {
    if (row.kind !== 'events') {
      skipped += 1;
      continue;
    }
    if (validatePersonalImportRow(row).some((issue) => issue.severity === 'error')) {
      skipped += 1;
      continue;
    }
    const eventLines = ['BEGIN:VEVENT', 'UID:' + escapeIcsText(`${row.id}@campus-one.local`), 'DTSTAMP:' + generatedAt];
    if (row.allDay) {
      const end = exclusiveAllDayEnd(row.date!, row.endDate);
      if (!end) {
        skipped += 1;
        continue;
      }
      eventLines.push(
        'DTSTART;VALUE=DATE:' + compactDate(row.date!),
        'DTEND;VALUE=DATE:' + compactDate(end),
      );
    } else {
      const start = timedStamp(row.date!, row.startTime!);
      const end = timedStamp(row.endDate || row.date!, row.endTime!);
      if (!start || !end) {
        skipped += 1;
        continue;
      }
      eventLines.push(
        `DTSTART;TZID=${TAIPEI}:` + start,
        `DTEND;TZID=${TAIPEI}:` + end,
      );
    }
    eventLines.push('SUMMARY:' + escapeIcsText(row.title));
    if (row.location?.trim()) eventLines.push('LOCATION:' + escapeIcsText(row.location));
    eventLines.push(
      'DESCRIPTION:' +
        escapeIcsText(
          'Campus One 個人行程快照。匯出不是報名或 RSVP，也不會自動設定提醒。',
        ),
      'END:VEVENT',
    );
    lines.push(...eventLines);
    eventCount += 1;
  }

  lines.push('END:VCALENDAR');
  return {
    content: lines.map(foldIcsLine).join('\r\n') + '\r\n',
    eventCount,
    skipped,
  };
}
