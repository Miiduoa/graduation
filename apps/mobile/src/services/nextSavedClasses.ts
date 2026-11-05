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

function refreshSavedClasses(records: PersonalImportRecord[], schoolId: string, now: Date, prior: readonly SavedClassOccurrence[]) {
  const classes: SavedClassOccurrence[] = [];
  for (const item of prior) {
    const startAt = Date.parse(`${item.date}T${item.startTime}:00+08:00`);
    const matches = findSavedClassOccurrences(records, { ...item, schoolId, startAt });
    const entry = matches[0];
    if (matches.length !== 1 || !entry || entry.endAt <= now.getTime() || entry.startAt > now.getTime() + 7 * DAY) return [];
    const { academicYear, semester } = courseScope(entry.row);
    if (`${academicYear}|${semester}` !== academicTerm(new Date(entry.startAt))) return [];
    classes.push(classOccurrence(entry));
  }
  return classes;
}

/** The earliest start within the next 168 hours, including all classes starting together. */
export function nextSavedClasses(records: PersonalImportRecord[], schoolId: string, now: Date, prior?: readonly SavedClassOccurrence[]): SavedClassOccurrence[] | undefined {
  if (prior) return refreshSavedClasses(records, schoolId, now, prior);
  if (!records.length) return [];
  const groups = new Map<string, { term: string; rows: PersonalImportRecord[] }>();
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

  const until = now.getTime() + 7 * DAY;
  for (let time = now.getTime(); time <= until; time += DAY) {
    const date = new Date(time);
    const term = academicTerm(date);
    const active = [...groups.values()].filter((group) => group.term === term);
    if (!active.length) return undefined;
    const upcoming: PersonalTodayEntry[] = [];
    for (const group of active) {
      const plan = buildPersonalToday(group.rows, { schoolId, now: date });
      if (plan.unplacedCount) return undefined;
      upcoming.push(...plan.today.filter((entry) => entry.startAt >= now.getTime() && entry.startAt <= until));
    }
    if (upcoming.length) {
      const first = Math.min(...upcoming.map((entry) => entry.startAt));
      const classes = upcoming.filter((entry) => entry.startAt === first).map(classOccurrence);
      // Two adjustments can move separate meetings to the same start; the course link then cannot distinguish them.
      const distinct = new Set(classes.map((item) => JSON.stringify([item.term, item.courseId])));
      return distinct.size === classes.length ? classes : undefined;
    }
  }
  return [];
}
