import { classDate, validateClassException } from '../timetable/classExceptions';
import type { PersonalImportRecord } from './types';
import { periodProfileForSchool, periodTimes } from '../timetable/schoolPeriods';

export type PersonalTodayEntry = {
  row: PersonalImportRecord;
  startTime: string;
  endTime: string;
  status: 'ongoing' | 'upcoming' | 'ended';
  conflict: boolean;
  startAt: number;
  endAt: number;
};

function minutes(clock: string | undefined): number | null {
  if (!clock || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
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
  const profile = periodProfileForSchool(options.schoolId);
  const times = profile ? periodTimes(profile) : [];
  const today: PersonalTodayEntry[] = [];
  let unplacedCount = 0;
  const date = classDate(options.now);
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  for (const original of rows.filter((row) => termKey(row) === activeTerm)) {
    const explicit = !!(original.startTime || original.endTime);
    const baseStart = explicit ? original.startTime : times[(original.startPeriod ?? 0) - 1]?.[0];
    const baseEnd = explicit ? original.endTime : times[(original.endPeriod ?? 0) - 1]?.[1];
    const start = minutes(baseStart), end = minutes(baseEnd);
    if (!Number.isInteger(original.dayOfWeek) || original.dayOfWeek! < 1 ||
      original.dayOfWeek! > 7 || start === null || end === null || start >= end) {
      unplacedCount++;
      continue;
    }
    const exceptions = (original.classExceptions || []).filter((item) => {
      try { validateClassException(item); return true; } catch { return false; }
    });
    const append = (row: PersonalImportRecord, startTime: string, endTime: string,
      startDate: string, endDate = startDate) => {
      const startAt = Date.parse(`${startDate}T${startTime}:00+08:00`);
      const endAt = Date.parse(`${endDate}T${endTime}:00+08:00`);
      if (startAt >= midnight + 86400000 || endAt <= midnight) return;
      today.push({ row, startTime, endTime, startAt, endAt, conflict: false,
        status: options.now.getTime() >= endAt ? 'ended' : options.now.getTime() >= startAt ? 'ongoing' : 'upcoming' });
    };
    const change = exceptions.find((item) => item.originalDate === date);
    if (original.dayOfWeek === weekday && (!change || change.kind === 'room')) {
      append(change ? { ...original, location: change.location } : original, baseStart!, baseEnd!, date);
    }
    for (const item of exceptions.filter((value) => value.kind === 'move')) {
      append({ ...original, location: item.location ?? original.location },
        item.startTime!, item.endTime!, item.date!, item.endDate || item.date!);
    }
  }
  // A course entered by hand and later imported is one class when its complete
  // displayed details agree. Keep the imported record's provenance; differing
  // teachers or rooms still require the user's conflict review.
  const sameText = (left?: string, right?: string) =>
    (left ?? '').trim().normalize('NFKC') === (right ?? '').trim().normalize('NFKC');
  const distinctToday = today.filter((entry) =>
    !entry.row.id.startsWith('manual:') || !today.some((other) =>
      !other.row.id.startsWith('manual:') &&
      entry.startAt === other.startAt &&
      entry.endAt === other.endAt &&
      sameText(entry.row.title, other.row.title) &&
      sameText(entry.row.teacher, other.row.teacher) &&
      sameText(entry.row.location, other.row.location),
    ),
  );
  distinctToday.sort(
    (a, b) =>
      a.startAt - b.startAt ||
      a.endAt - b.endAt ||
      a.row.id.localeCompare(b.row.id),
  );
  for (const entry of distinctToday) {
    entry.conflict = distinctToday.some(
      (other) =>
        other !== entry && entry.startAt < other.endAt && other.startAt < entry.endAt,
    );
  }
  return {
    terms,
    termKey: activeTerm,
    today: distinctToday,
    unplacedCount,
    weekday,
    nextId: distinctToday.find((entry) => entry.status !== 'ended')?.row.id ?? null,
  };
}
