import { buildPersonalToday, classDate, validClassDate, type PersonalImportRecord, type PersonalTodayEntry } from '@campus/shared';
import { courseScope } from '@campus/shared/src/courseAccess';
import { currentSemesterStartUtc, rocSchoolYear } from '@campus/shared/src/campusAnnouncementQuality';
import { assertClassExceptions, matchesClassException } from '@campus/shared/src/timetable/classExceptions';

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

function timetableGroups(records: readonly PersonalImportRecord[]) {
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
    // A course with no assigned weekday has no scheduled occurrence.
    if (row.dayOfWeek) group.rows.push(row);
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

/** Actual meetings on one Taiwan date. Incomplete relevant terms cannot establish an available gap. */
export function scheduledSavedClasses(
  records: readonly PersonalImportRecord[], schoolId: string, date: string,
): PersonalTodayEntry[] | undefined {
  if (!validClassDate(date) || !Array.isArray(records) ||
      Array.from(records).some((row) => !row || typeof row !== 'object')) return undefined;
  const scoped = records.filter((row) => row.kind === 'timetable' && row.schoolId === schoolId);
  if (!scoped.length) return [];
  const day = new Date(`${date}T12:00:00+08:00`);
  const dayStart = Date.parse(`${date}T00:00:00+08:00`);
  const relevantTerms = new Set([academicTerm(day), academicTerm(new Date(day.getTime() - DAY))]);
  try {
    for (const row of scoped) {
      const scope = courseScope(row);
      const rowTerm = `${scope.academicYear}|${scope.semester}`;
      assertClassExceptions(row.classExceptions);
      const changes = row.classExceptions ?? [];
      if (new Set(changes.map((change) => change.originalDate)).size !== changes.length ||
          new Set(changes.map((change) => change.id)).size !== changes.length ||
          changes.some((change) => !matchesClassException(row, change.original))) return undefined;
      // A dated makeup meeting cannot disappear because scheduledDay excludes
      // its term or its start belongs to another term. Keep a valid prior-night
      // carryover, whose start still belongs to the original course's term.
      if (changes.some((change) => {
        if (change.kind !== 'move') return false;
        const start = Date.parse(`${change.date}T${change.startTime}:00+08:00`);
        const end = Date.parse(`${change.endDate || change.date}T${change.endTime}:00+08:00`);
        return !Number.isFinite(start) || !Number.isFinite(end) ||
          (start < dayStart + DAY && end > dayStart &&
            (!relevantTerms.has(rowTerm) || academicTerm(new Date(start)) !== rowTerm));
      })) return undefined;
      if (!relevantTerms.has(rowTerm)) continue;
      // Named class lookups may omit an unplaced course; availability cannot.
      if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek! < 1 || row.dayOfWeek! > 7) return undefined;
    }
    const groups = timetableGroups(scoped);
    return groups ? scheduledDay(groups, schoolId, day, true) : undefined;
  } catch {
    // buildPersonalToday skips malformed exceptions for display. A preparation
    // suggestion must instead preserve the distinction between unknown and free.
    return undefined;
  }
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
