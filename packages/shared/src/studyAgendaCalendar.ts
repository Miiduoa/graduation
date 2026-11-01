import type { NuniStudyTask } from './nuniStudyAgenda';
import { escapeIcsText, foldIcsLine, utcIcsStamp } from './imports/icalendarSerialization';
import { parseTaipeiInstant } from './taipeiTime';

export const studyCalendarNotice =
  '這是目前資料的快照；繳交後，外部事件不會自動刪除或更新。重複匯入可能產生重複事件。';
export const studyCalendarPartial =
  '部分課程讀取失敗或達到來源上限；只能匯出已載入項目，請更新待辦或進入課程確認。';
export const studyCalendarKey = (task: NuniStudyTask) =>
  [task.courseId, task.kind, task.id].map(encodeURIComponent).join(':');

/** Date-only and permissively parsed dates cannot establish an exact deadline. */
export function studyDeadline(task: NuniStudyTask): number | null {
  const value = task.dueAt?.trim();
  if (!value) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day] = match;
  const check = new Date(Date.UTC(+year, +month - 1, +day));
  if (
    check.getUTCFullYear() !== +year ||
    check.getUTCMonth() !== +month - 1 ||
    check.getUTCDate() !== +day
  )
    return null;
  return parseTaipeiInstant(value);
}

export function studyCalendarCandidates(tasks: readonly NuniStudyTask[]) {
  return Array.from(
    new Map(
      tasks
        .filter(
          (task) =>
            task.submittedAt === null && task.state === 'open' && studyDeadline(task) !== null,
        )
        .map((task) => [studyCalendarKey(task), task]),
    ).values(),
  );
}

export function studyCalendarTaskUrl(task: NuniStudyTask): string {
  const view = task.kind === 'assignment' ? 'assignments' : 'quizzes';
  return `https://nuni.tw/classroom/course/${encodeURIComponent(task.courseId)}?view=${view}#${task.kind}-${encodeURIComponent(task.id)}`;
}

export function buildStudyCalendar(
  tasks: readonly NuniStudyTask[],
  selected: readonly string[],
  now = new Date(),
): string {
  const keys = new Set(selected);
  const chosen = studyCalendarCandidates(tasks).filter((task) => keys.has(studyCalendarKey(task)));
  if (!chosen.length) throw new Error('請先勾選至少一項有明確期限的未繳項目。');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nuni//Study deadlines//TW',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:未繳課業期限',
    'X-WR-TIMEZONE:Asia/Taipei',
  ];
  for (const task of chosen) {
    const stamp = utcIcsStamp(new Date(studyDeadline(task)!));
    lines.push(
      'BEGIN:VEVENT',
      `UID:study-${studyCalendarKey(task)}@nuni.tw`,
      `DTSTAMP:${utcIcsStamp(now)}`,
      `DTSTART:${stamp}`,
      // Point-in-time deadline: DTEND matches DTSTART so clients that require an end stay stable.
      `DTEND:${stamp}`,
      `SUMMARY:${escapeIcsText(`[${task.kind === 'assignment' ? '作業' : '測驗'}] ${task.title}`)}`,
      `DESCRIPTION:${escapeIcsText(`課程：${task.courseTitle}\n參考期限，以老師收件狀態為準。\n${studyCalendarNotice}`)}`,
      `URL:${studyCalendarTaskUrl(task)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
