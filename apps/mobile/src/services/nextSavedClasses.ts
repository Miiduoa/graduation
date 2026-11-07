import { buildPersonalToday, classDate, validClassDate, type PersonalImportRecord, type PersonalTodayEntry } from '@campus/shared';
import { courseScope } from '@campus/shared/src/courseAccess';
import { currentSemesterStartUtc, rocSchoolYear } from '@campus/shared/src/campusAnnouncementQuality';

export type SavedClassOccurrence = {
  courseId: string;
  name: string;
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  term: string;
};

const DAY = 86_400_000;

function academicTerm(date: Date) {
  const semester = currentSemesterStartUtc(date).getUTCMonth() === 7 ? '1' : '2';
  return `${rocSchoolYear(date)}|${semester}`;
}

function classOccurrence({ row, startAt, startTime, endTime }: PersonalTodayEntry): SavedClassOccurrence {
  return {
    courseId: row.id, name: row.title, room: row.location || '',
    term: `${row.academicYear}|${row.semester}`, date: classDate(new Date(startAt)), startTime, endTime,
  };
}

/** Resolve the requested source row before the daily view deduplicates manual/imported copies. */
export function findSavedClassOccurrences(records: readonly PersonalImportRecord[], target: {
  schoolId: string; term?: string; courseId: string; date: string; startAt?: number;
}): PersonalTodayEntry[] {
  if (!validClassDate(target.date)) return [];
  const rows = records.filter((row) => row.id === target.courseId &&
    row.schoolId === target.schoolId && `${row.academicYear}|${row.semester}` === target.term);
  return buildPersonalToday(rows, {
    schoolId: target.schoolId, termKey: target.term, now: new Date(`${target.date}T12:00:00+08:00`),
  }).today.filter((entry) => target.startAt === undefined || entry.startAt === target.startAt);
}

function refreshSavedClasses(records: PersonalImportRecord[], schoolId: string, now: Date, prior: readonly SavedClassOccurrence[], current = false) {
  const classes: SavedClassOccurrence[] = [];
  for (const item of prior) {
    const startAt = Date.parse(`${item.date}T${item.startTime}:00+08:00`);
    const matches = findSavedClassOccurrences(records, { ...item, schoolId, startAt });
    const entry = matches[0];
    if (matches.length !== 1 || !entry || entry.endAt <= now.getTime() || entry.startAt > now.getTime() + 7 * DAY) return [];
    if (current && entry.startAt > now.getTime()) return [];
    const { academicYear, semester } = courseScope(entry.row);
    if (`${academicYear}|${semester}` !== academicTerm(new Date(entry.startAt))) return [];
    classes.push(classOccurrence(entry));
  }
  return classes;
}

type TimetableGroup = { term: string; rows: PersonalImportRecord[] };

function timetableGroups(records: readonly PersonalImportRecord[], requirePlacedTerm?: string) {
  const groups = new Map<string, TimetableGroup>();
  for (const row of records) {
    const key = `${row.academicYear}|${row.semester}`;
    let group = groups.get(key);
    if (!group) {
      try {
        const { academicYear, semester } = courseScope(row);
        group = { term: `${academicYear}|${semester}`, rows: [] };
        groups.set(key, group);
      } catch {
        // An undated timetable may contain an earlier class.
        return undefined;
      }
    }
    // Named class queries can skip unscheduled courses. Gaps need every row in the requested term.
    if (row.dayOfWeek || group.term === requirePlacedTerm) group.rows.push(row);
  }

  return [...groups.values()];
}

function scheduledDay(groups: TimetableGroup[], schoolId: string, date: Date, includeOvernight = false) {
  const term = academicTerm(date);
  const active = groups.filter((group) => group.term === term);
  if (!active.length) return undefined;
  // A moved class can start on the last evening of the preceding term.
  const previousTerm = includeOvernight ? academicTerm(new Date(date.getTime() - DAY)) : term;
  if (previousTerm !== term) active.push(...groups.filter((group) => group.term === previousTerm));
  const entries: PersonalTodayEntry[] = [];
  for (const group of active) {
    const plan = buildPersonalToday(group.rows, { schoolId, now: date });
    if (plan.unplacedCount) return undefined;
    entries.push(...plan.today.filter((entry) =>
      previousTerm === term || academicTerm(new Date(entry.startAt)) === group.term));
  }
  return entries;
}

/** Remaining time between saved meetings on one Taiwan date. An unknown timetable cannot establish a gap. */
export function savedClassGaps(
  records: readonly PersonalImportRecord[], schoolId: string, now: Date, day: 'today' | 'tomorrow' | 'day-after-tomorrow',
): { startAt: number; endAt: number }[] | undefined {
  const offset = day === 'today' ? 0 : day === 'tomorrow' ? 1 : 2;
  const date = new Date(now.getTime() + offset * DAY);
  const groups = timetableGroups(
    records.filter((row) => row.kind === 'timetable' && row.schoolId === schoolId), academicTerm(date),
  );
  if (!groups) return undefined;
  const entries = scheduledDay(groups, schoolId, date, true);
  if (!entries) return undefined;
  const midnight = Date.parse(`${classDate(date)}T00:00:00+08:00`);
  // buildPersonalToday also lists the previous weekday; gaps only use meetings that occupy this date.
  const onDay = entries.filter((entry) => entry.endAt > midnight && entry.startAt < midnight + DAY);
  if (onDay.length < 2) return [];

  onDay.sort((a, b) => a.startAt - b.startAt);
  const gaps: { startAt: number; endAt: number }[] = [];
  let busyUntil = onDay[0].endAt;
  for (let i = 1; i < onDay.length; i++) {
    const entry = onDay[i];
    const startAt = Math.max(busyUntil, now.getTime());
    if (startAt < entry.startAt) gaps.push({ startAt, endAt: entry.startAt });
    busyUntil = Math.max(busyUntil, entry.endAt);
  }
  return gaps;
}

/** Actual meetings intersecting this Taiwan date, including saved single-day changes. */
export function scheduledSavedClasses(
  records: readonly PersonalImportRecord[], schoolId: string, date: string,
): PersonalTodayEntry[] | undefined {
  if (!validClassDate(date)) return undefined;
  const scoped = records.filter((row) => row.kind === 'timetable' && row.schoolId === schoolId);
  if (!scoped.length) return [];
  const groups = timetableGroups(scoped);
  if (!groups) return undefined;
  return scheduledDay(groups, schoolId, new Date(`${date}T12:00:00+08:00`), true);
}

function addressableClasses(entries: PersonalTodayEntry[]) {
  const classes = entries.map(classOccurrence);
  // Separate makeup meetings may have the same deep link and cannot be selected reliably.
  const distinct = new Set(classes.map((item) => JSON.stringify([item.term, item.courseId, item.date, item.startTime])));
  return distinct.size === classes.length ? classes : undefined;
}

/** All saved meetings covering this instant, including staggered overlaps and overnight adjustments. */
export function currentSavedClasses(records: PersonalImportRecord[], schoolId: string, now: Date, prior?: readonly SavedClassOccurrence[]): SavedClassOccurrence[] | undefined {
  if (prior) return refreshSavedClasses(records, schoolId, now, prior, true);
  const groups = timetableGroups(records);
  if (!groups) return undefined;
  const entries = scheduledDay(groups, schoolId, now, true);
  return entries && addressableClasses(entries.filter((entry) => entry.status === 'ongoing'));
}

/** The earliest start within the requested window, including all classes starting together. */
export function nextSavedClasses(
  records: PersonalImportRecord[], schoolId: string, now: Date, prior?: readonly SavedClassOccurrence[], horizonMs = 7 * DAY,
): SavedClassOccurrence[] | undefined {
  if (prior) return refreshSavedClasses(records, schoolId, now, prior);
  if (!records.length) return [];
  const groups = timetableGroups(records);
  if (!groups) return undefined;
  const until = now.getTime() + Math.min(horizonMs, 7 * DAY);
  const midnight = Date.parse(`${classDate(now)}T00:00:00+08:00`);
  for (let time = midnight; time <= until; time += DAY) {
    const entries = scheduledDay(groups, schoolId, new Date(time));
    if (!entries) return undefined;
    const upcoming = entries.filter((entry) => entry.startAt >= now.getTime() && entry.startAt <= until);
    if (upcoming.length) {
      const first = Math.min(...upcoming.map((entry) => entry.startAt));
      return addressableClasses(upcoming.filter((entry) => entry.startAt === first));
    }
  }
  return [];
}
