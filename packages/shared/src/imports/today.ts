import type { PersonalImportRecord } from './types';
import { periodProfileForSchool, periodTimes } from '../timetable/schoolPeriods';

export type PersonalTodayEntry = {
  row: PersonalImportRecord;
  startTime: string;
  endTime: string;
  status: 'ongoing' | 'upcoming' | 'ended';
  conflict: boolean;
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
  const currentMinute = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
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
  for (const row of rows.filter((row) => termKey(row) === activeTerm)) {
    // Never fill half an explicit range from a possibly different period table.
    const explicit = !!(row.startTime || row.endTime);
    const startTime = explicit ? row.startTime : times[(row.startPeriod ?? 0) - 1]?.[0];
    const endTime = explicit ? row.endTime : times[(row.endPeriod ?? 0) - 1]?.[1];
    const start = minutes(startTime);
    const end = minutes(endTime);
    if (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek! < 1 ||
      row.dayOfWeek! > 7 ||
      start === null ||
      end === null ||
      start >= end
    ) {
      unplacedCount++;
      continue;
    }
    if (row.dayOfWeek !== weekday) continue;
    today.push({
      row,
      startTime: startTime!,
      endTime: endTime!,
      conflict: false,
      status: currentMinute >= end ? 'ended' : currentMinute >= start ? 'ongoing' : 'upcoming',
    });
  }
  // A course entered by hand and later imported is one class when its complete
  // displayed details agree. Keep the imported record's provenance; differing
  // teachers or rooms still require the user's conflict review.
  const sameText = (left?: string, right?: string) =>
    (left ?? '').trim().normalize('NFKC') === (right ?? '').trim().normalize('NFKC');
  const distinctToday = today.filter((entry) =>
    !entry.row.id.startsWith('manual:') || !today.some((other) =>
      !other.row.id.startsWith('manual:') &&
      entry.startTime === other.startTime &&
      entry.endTime === other.endTime &&
      sameText(entry.row.title, other.row.title) &&
      sameText(entry.row.teacher, other.row.teacher) &&
      sameText(entry.row.location, other.row.location),
    ),
  );
  distinctToday.sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime) ||
      a.row.id.localeCompare(b.row.id),
  );
  for (const entry of distinctToday) {
    entry.conflict = distinctToday.some(
      (other) =>
        other !== entry && entry.startTime < other.endTime && other.startTime < entry.endTime,
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
