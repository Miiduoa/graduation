import { currentSemesterStartUtc, rocSchoolYear } from './campusAnnouncementQuality';
import { courseScope } from './courseAccess';
import { buildPersonalToday } from './imports/today';
import type { PersonalImportRecord } from './imports/types';
import { validatePersonalImportRow } from './imports/validation';
import { formatClock } from './pickNextAction';
import { classDate } from './timetable/classExceptions';

type ClassMeeting = { id: string; title: string; startAt: number; endAt: number };

export type ClassCalendarOverlap = {
  classId: string;
  classTitle: string;
  eventId: string;
  eventTitle: string;
  startAt: number;
  endAt: number;
};

/** The general timetable can display an older saved term. Only today's term can produce a nudge. */
export function currentTermClassCalendarMeetings(
  records: readonly PersonalImportRecord[], schoolId: string, now: Date,
) {
  if (!Number.isFinite(now.getTime())) return { classes: [], hasCurrentTerm: false, unplacedCount: 0 };
  const year = String(rocSchoolYear(now));
  const semester = currentSemesterStartUtc(now).getUTCMonth() === 7 ? '1' : '2';
  const current = records.flatMap((row) => {
    if (row.kind !== 'timetable' || row.schoolId !== schoolId) return [];
    try {
      const term = courseScope(row);
      if (term.academicYear === year && term.semester === semester) {
        return [{ ...row, academicYear: year, semester }];
      }
    } catch {
      // A timetable without a recognized term cannot establish a class today.
    }
    return [];
  });
  const day = buildPersonalToday(current, { schoolId, now });
  return {
    classes: day.today.map(({ row, startAt, endAt }) => ({ id: row.id, title: row.title, startAt, endAt })),
    hasCurrentTerm: current.length > 0,
    unplacedCount: day.unplacedCount,
  };
}

/** Intersect confirmed meeting times with timed events in the same owner's calendar. */
export function findClassCalendarOverlaps(
  classes: readonly ClassMeeting[], records: readonly PersonalImportRecord[], schoolId: string, nowMs: number,
): ClassCalendarOverlap[] {
  if (!classes.length || !Number.isFinite(nowMs)) return [];
  const dayStart = Date.parse(classDate(new Date(nowMs)) + 'T00:00:00+08:00');
  const dayEnd = dayStart + 86_400_000;
  const overlaps: ClassCalendarOverlap[] = [];
  for (const event of records) {
    if (event.kind !== 'events' || event.schoolId !== schoolId || event.allDay) continue;
    if (validatePersonalImportRow(event).some((issue) => issue.severity === 'error')) continue;
    const eventStart = Date.parse(`${event.date}T${event.startTime}:00+08:00`);
    const eventEnd = Date.parse(`${event.endDate || event.date}T${event.endTime}:00+08:00`);
    if (eventStart >= dayEnd || eventEnd <= nowMs) continue;
    for (const meeting of classes) {
      const startAt = Math.max(dayStart, meeting.startAt, eventStart);
      const endAt = Math.min(dayEnd, meeting.endAt, eventEnd);
      if (startAt < endAt && endAt > nowMs) {
        overlaps.push({
          classId: meeting.id, classTitle: meeting.title, eventId: event.id, eventTitle: event.title,
          startAt, endAt,
        });
      }
    }
  }
  return overlaps.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt ||
    a.eventId.localeCompare(b.eventId) || a.classId.localeCompare(b.classId));
}

/** A local answer names its evidence and never treats a missing collection as an empty schedule. */
export function formatTodayClassCalendarOverlapAnswer(
  records: readonly PersonalImportRecord[], schoolId: string, now: Date, deviceLabel: '這台手機' | '這個瀏覽器',
) {
  const day = currentTermClassCalendarMeetings(records, schoolId, now);
  const events = records.filter((row) => row.kind === 'events' && row.schoolId === schoolId);
  const overlaps = findClassCalendarOverlaps(day.classes, events, schoolId, now.getTime());
  const lines: string[] = [];
  if (!day.hasCurrentTerm) lines.push('還沒有可核對的本學期課表。請先匯入課表，或確認已保存課程的學年與學期。');
  if (!events.length) lines.push('還沒有可核對的個人行程。你可以在個人行事曆新增或匯入行程。');
  if (overlaps.length) {
    lines.push('今天進行中或接下來的重疊時段（台灣時間）：');
    for (const row of overlaps.slice(0, 3)) {
      lines.push(`• ${formatClock(row.startAt)}–${formatClock(row.endAt)}  「${row.classTitle}」和「${row.eventTitle}」`);
    }
    if (overlaps.length > 3) lines.push(`另有 ${overlaps.length - 3} 組重疊，可在課表與個人行事曆核對。`);
  } else if (day.hasCurrentTerm && events.length) {
    lines.push('今天進行中和接下來的已知課程，和有起訖時間的個人行程沒有重疊。');
  }
  if (day.unplacedCount) lines.push(`有 ${day.unplacedCount} 筆本學期課程缺少可判定的上課時間，未列入比對。`);
  lines.push(`根據${deviceLabel}裡目前帳號與校園的課表及個人行事曆。全天事項沒有指定時段，已略過。`);
  return { content: lines.join('\n'), overlaps };
}
