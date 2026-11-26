import type { AgendaScheduledClass } from './campusStudyAgenda';
import { savedPlanTimestamp } from './savedCampusPlanValidation';

/** The same dated clock evidence used by the nuni planner; no account data is retained here. */
export type CampusClockClass = AgendaScheduledClass;
/** Half-open clock intervals; derived results use ISO timestamps with an explicit Z offset. */
export type CampusClockInterval = { startAt: string; endAt: string };
type InvalidReason = 'unavailable' | 'invalid-date' | 'invalid-course' | 'out-of-day' | 'too-many-courses';
export type CampusClockAvailability =
  | { valid: true; gaps: CampusClockInterval[]; conflicts: CampusClockInterval[] }
  | { valid: false; reason: InvalidReason; gaps: []; conflicts: [] };

type Interval = { start: number; end: number };
const DAY = 86_400_000;
const GRID = 5 * 60_000;
const STUDY_DURATION = 30 * 60_000;
const MAX_DAILY_CLASSES = 80;

function invalid(reason: InvalidReason): CampusClockAvailability {
  return { valid: false, reason, gaps: [], conflicts: [] };
}

function timestamp(value: unknown): number | null {
  // Share the persisted schema's calendar, clock and offset checks; Date.parse alone normalizes invalid dates.
  try { return Date.parse(savedPlanTimestamp(value)); } catch { return null; }
}

function interval(value: unknown): Interval | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const start = timestamp(row.startAt);
  const end = timestamp(row.endAt);
  if (start === null || end === null || end <= start || end - start > DAY) return null;
  return { start, end };
}

function clockInterval(value: Interval): CampusClockInterval {
  return { startAt: new Date(value.start).toISOString(), endAt: new Date(value.end).toISOString() };
}

function appendUnion(result: Interval[], value: Interval): void {
  const previous = result[result.length - 1];
  if (previous && value.start <= previous.end) previous.end = Math.max(previous.end, value.end);
  else result.push({ ...value });
}

/**
 * Inspect an already scoped daily snapshot, never school authority or the user's whole calendar.
 * Pass null when the timetable is unavailable or incomplete. Any malformed row invalidates the day.
 * Only gaps bounded by saved meetings are returned; a blank or single-meeting day establishes none.
 */
export function inspectCampusClockAvailability(
  courses: readonly CampusClockClass[] | null | undefined,
  date: string,
): CampusClockAvailability {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid('invalid-date');
  const dayStart = timestamp(date + 'T00:00:00+08:00');
  if (dayStart === null) return invalid('invalid-date');
  if (courses === null || courses === undefined) return invalid('unavailable');
  if (!Array.isArray(courses)) return invalid('invalid-course');
  if (courses.length > MAX_DAILY_CLASSES) return invalid('too-many-courses');

  const dayEnd = dayStart + DAY;
  const meetings: Interval[] = [];
  for (const course of courses) {
    const time = interval(course);
    if (!time || typeof course.name !== 'string' || !course.name.trim() || course.name.length > 240 ||
        typeof course.room !== 'string' || course.room.length > 240) return invalid('invalid-course');
    if (time.start >= dayEnd || time.end <= dayStart) return invalid('out-of-day');
    meetings.push({ start: Math.max(dayStart, time.start), end: Math.min(dayEnd, time.end) });
  }
  meetings.sort((a, b) => a.start - b.start || a.end - b.end);

  const occupied: Interval[] = [];
  const events = new Map<number, number>();
  for (const meeting of meetings) {
    appendUnion(occupied, meeting);
    // Retain every occurrence: duplicate classes still count as a conflict.
    events.set(meeting.start, (events.get(meeting.start) ?? 0) + 1);
    events.set(meeting.end, (events.get(meeting.end) ?? 0) - 1);
  }
  const gaps = occupied.slice(1).map((meeting, index) => ({ start: occupied[index].end, end: meeting.start }));
  const points = [...events.keys()].sort((a, b) => a - b);
  const conflicts: Interval[] = [];
  let active = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    // Applying net changes at the endpoint makes adjacent [a,b) and [b,c) non-overlapping.
    active += events.get(points[index]) ?? 0;
    if (active >= 2) appendUnion(conflicts, { start: points[index], end: points[index + 1] });
  }
  return { valid: true, gaps: gaps.map(clockInterval), conflicts: conflicts.map(clockInterval) };
}

function finiteInstant(value: number): boolean {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

/**
 * Pick a complete future 30-minute suggestion on a five-minute grid, without mutating or reserving it.
 * Callers may combine days or narrow gaps for preparation policies before calling this helper.
 * This does not add calendar events, infer free time outside gaps, or claim the work will be finished.
 */
export function selectCampusClockStudySlot(
  availability: CampusClockAvailability,
  now: number,
  deadline?: number,
): CampusClockInterval | null {
  if (!availability || availability.valid !== true || !finiteInstant(now) ||
      (deadline !== undefined && !finiteInstant(deadline)) || !Array.isArray(availability.gaps) ||
      !Array.isArray(availability.conflicts)) return null;
  const gaps: Interval[] = [];
  const conflicts: Interval[] = [];
  for (const value of availability.gaps) {
    const time = interval(value);
    if (!time) return null;
    gaps.push(time);
  }
  for (const value of availability.conflicts) {
    const time = interval(value);
    if (!time) return null;
    conflicts.push(time);
  }
  gaps.sort((a, b) => a.start - b.start || a.end - b.end);
  // Fail closed if a caller accidentally combines incompatible or overlapping derived evidence.
  if (gaps.some((gap, index) => (index > 0 && gap.start < gaps[index - 1].end) ||
      conflicts.some((conflict) => gap.start < conflict.end && gap.end > conflict.start))) return null;
  for (const gap of gaps) {
    const start = Math.ceil(Math.max(gap.start, now) / GRID) * GRID;
    const end = start + STUDY_DURATION;
    if (end <= gap.end && (deadline === undefined || end <= deadline)) return clockInterval({ start, end });
  }
  return null;
}
