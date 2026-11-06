import {
  classDate,
  classMeetingTimes,
  displayedClassMeetingKey,
  validateClassException,
} from '../timetable/classExceptions';
import type { PersonalImportRecord } from './types';

export type PersonalTodayEntry = {
  row: PersonalImportRecord;
  originalDate: string;
  startTime: string;
  endTime: string;
  status: 'ongoing' | 'upcoming' | 'ended';
  conflict: boolean;
  startAt: number;
  endAt: number;
};

const DAY_MS = 86_400_000;

function occurrenceKey(entry: PersonalTodayEntry): string {
  return JSON.stringify([
    entry.originalDate, entry.startAt, entry.endAt, displayedClassMeetingKey(entry.row),
  ]);
}

function preferImportedMeetings(entries: PersonalTodayEntry[]): PersonalTodayEntry[] {
  const isManual = (entry: PersonalTodayEntry) => entry.row.id.startsWith('manual:');
  if (!entries.some(isManual)) return entries;
  const imported = new Set(entries.filter((entry) => !isManual(entry)).map(occurrenceKey));
  return entries.filter((entry) => !isManual(entry) || !imported.has(occurrenceKey(entry)));
}

function isClock(clock: string | undefined): clock is string {
  return clock !== undefined && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock);
}

const termKey = (row: PersonalImportRecord) => `${row.academicYear}|${row.semester}`;
const calendarYear = (year: string) =>
  /^\d{2,4}$/.test(year) ? (Number(year) < 1911 ? Number(year) + 1911 : Number(year)) : 0;

export function personalTimetableTerms(records: readonly PersonalImportRecord[], schoolId: string) {
  return [
    ...new Map(
      records
        .filter((row) => row.kind === 'timetable' && row.schoolId === schoolId)
        .map((row) => [
          termKey(row),
          {
            key: termKey(row),
            academicYear: row.academicYear,
            semester: row.semester,
          },
        ]),
    ).values(),
  ].sort(
    (a, b) =>
      calendarYear(b.academicYear) - calendarYear(a.academicYear) ||
      b.semester.localeCompare(a.semester, 'zh-TW', { numeric: true }),
  );
}

/** A view of the user's weekly timetable, not proof a class is running today. */
export function buildPersonalToday(
  records: readonly PersonalImportRecord[],
  options: { schoolId: string; termKey?: string; now: Date },
) {
  if (!Number.isFinite(options.now.getTime())) throw new Error('無法判定目前日期。');
  // Taiwan has no DST. UTC accessors keep this independent of the device timezone.
  const taipei = new Date(options.now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = taipei.getUTCDay() || 7;
  const rows = records.filter(
    (row) => row.kind === 'timetable' && row.schoolId === options.schoolId,
  );
  const terms = personalTimetableTerms(rows, options.schoolId);
  const activeTerm = terms.some((term) => term.key === options.termKey)
    ? options.termKey!
    : (terms[0]?.key ?? '');
  const occurrences: PersonalTodayEntry[] = [];
  let unplacedCount = 0;
  const date = classDate(options.now);
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  const nearbyDays = [-1, 0, 1].map((offset) => {
    const day = new Date(taipei.getTime() + offset * DAY_MS);
    return { date: day.toISOString().slice(0, 10), weekday: day.getUTCDay() || 7 };
  });
  for (const original of rows.filter((row) => termKey(row) === activeTerm)) {
    const [baseStart, baseEnd] = classMeetingTimes(original);
    const courseWeekday = original.dayOfWeek ?? 0;
    if (
      !Number.isInteger(courseWeekday) || courseWeekday < 1 || courseWeekday > 7 ||
      !isClock(baseStart) || !isClock(baseEnd) || baseStart >= baseEnd
    ) {
      unplacedCount++;
      continue;
    }
    const exceptions = (original.classExceptions || []).filter((item) => {
      try { validateClassException(item); return true; } catch { return false; }
    });
    const append = (row: PersonalImportRecord, startTime: string, endTime: string,
      startDate: string, endDate = startDate, originalDate = startDate) => {
      const startAt = Date.parse(`${startDate}T${startTime}:00+08:00`);
      const endAt = Date.parse(`${endDate}T${endTime}:00+08:00`);
      if (startAt >= midnight + 2 * DAY_MS || endAt <= midnight - DAY_MS) return;
      occurrences.push({ row, originalDate, startTime, endTime, startAt, endAt, conflict: false,
        status: options.now.getTime() >= endAt ? 'ended' : options.now.getTime() >= startAt ? 'ongoing' : 'upcoming' });
    };
    for (const day of nearbyDays) {
      if (courseWeekday !== day.weekday) continue;
      const change = exceptions.find((item) => item.originalDate === day.date);
      if (!change || change.kind === 'room') {
        append(change ? { ...original, location: change.location } : original, baseStart, baseEnd, day.date);
      }
    }
    for (const item of exceptions.filter((value) => value.kind === 'move')) {
      append({ ...original, location: item.location ?? original.location },
        item.startTime!, item.endTime!, item.date!, item.endDate || item.date!, item.originalDate);
    }
  }
  const meetings = preferImportedMeetings(occurrences).sort(
    (a, b) =>
      a.startAt - b.startAt ||
      a.endAt - b.endAt ||
      a.row.id.localeCompare(b.row.id),
  );
  // In start order, the latest end seen so far also catches nested meetings.
  let latestEnding: PersonalTodayEntry | undefined;
  for (const entry of meetings) {
    if (latestEnding && entry.startAt < latestEnding.endAt) {
      latestEnding.conflict = true;
      entry.conflict = true;
    }
    if (!latestEnding || entry.endAt > latestEnding.endAt) latestEnding = entry;
  }
  const todayMeetings = meetings.filter(
    (entry) => entry.startAt < midnight + DAY_MS && entry.endAt > midnight,
  );
  return {
    terms,
    termKey: activeTerm,
    today: todayMeetings,
    unplacedCount,
    weekday,
    nextId: todayMeetings.find((entry) => entry.status !== 'ended')?.row.id ?? null,
  };
}
