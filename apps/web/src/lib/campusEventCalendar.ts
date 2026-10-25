import { escapeIcsText, foldIcsLine, utcIcsStamp } from '@campus/shared/src/imports/icalendarSerialization';
import type { CampusEvent } from './campusEvents';

function calendarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999
    ? date : null;
}

export function canExportCampusEvent(event: Pick<CampusEvent, 'startsAt'>): boolean {
  return calendarDate(event.startsAt) !== null;
}

/** A single event snapshot. Downloading it does not create a registration or a subscription. */
export function buildCampusEventCalendar(event: CampusEvent, detailUrl: string, now = new Date()): {
  content: string;
  filename: string;
  hasEndTime: boolean;
} {
  const start = calendarDate(event.startsAt);
  if (!start) throw new Error('活動尚未提供有效的開始時間。');
  if (!Number.isFinite(now.getTime()) || !calendarDate(now.toISOString())) throw new Error('無法判定目前時間。');
  const candidateEnd = calendarDate(event.endsAt);
  const end = candidateEnd && candidateEnd > start ? candidateEnd : null;
  const url = new URL(detailUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('無法建立活動連結。');
  }
  const id = [event.schoolId, event.source, event.id].map(encodeURIComponent).join(':');
  const description = [
    event.description,
    event.organizer ? `主辦：${event.organizer}` : '',
    !end ? '主辦單位未提供有效的結束時間，請自行確認活動長度。' : '',
    '這是下載當下的活動資訊；報名與時間異動請回到活動頁確認。',
    url.href,
  ].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus One//Campus Events//ZH-TW',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${id}@campus-one.local`,
    `DTSTAMP:${utcIcsStamp(now)}`,
    `DTSTART:${utcIcsStamp(start)}`,
    ...(end ? [`DTEND:${utcIcsStamp(end)}`] : []),
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `URL:${url.href}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return {
    content: lines.map(foldIcsLine).join('\r\n') + '\r\n',
    filename: `campus-event-${utcIcsStamp(start).slice(0, 8)}.ics`,
    hasEndTime: end !== null,
  };
}
