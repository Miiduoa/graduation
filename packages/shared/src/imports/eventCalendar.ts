import { validatePersonalImportRow } from './validation';
import type { PersonalImportRecord } from './types';

const TAIPEI = 'Asia/Taipei';

export type PersonalEventsCalendarExport = {
  content: string;
  eventCount: number;
  skipped: number;
};

function utf8Bytes(value: string): number {
  // Avoid depending on TextEncoder so React Native Jest can import this module.
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function escapeIcsText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- ICS text must omit non-text control bytes.
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
    const size = utf8Bytes(character);
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

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

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
  const generatedAt = utcStamp(now);
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
    content: lines.map(foldLine).join('\r\n') + '\r\n',
    eventCount,
    skipped,
  };
}
