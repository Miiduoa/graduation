import type {
  AgendaAssignment,
  AgendaCourse,
  AgendaScheduledClass,
  CampusAgendaDay,
  CampusStudyAgenda,
  PeriodInterval,
} from './campusStudyAgenda';
import type {
  CampusEvidencePlan,
  CampusPlanEvidence,
  CampusPlanPriority,
  CampusPlanRoute,
  CampusPlanStep,
} from './offlineCampusPlanner';
import type { CampusPlanComparisonBasis } from './campusPlanComparison';

type Row = Record<string, unknown>;

function invalid(): never { throw new Error('invalid-saved-plan'); }
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Row;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) return invalid();
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return Array.from(value, parse);
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return invalid();
  return value as T;
}

function date(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return invalid();
  const parsed = new Date(result + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) return invalid();
  return result;
}

/** A date-only value never becomes a verified school deadline. */
export function savedPlanTimestamp(value: unknown): string {
  const result = text(value, 40);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(result);
  if (!match || !Number.isFinite(Date.parse(result)) || Number(match[2]) > 23 ||
      Number(match[3]) > 59 || Number(match[4] || 0) > 59 ||
      (match[7] && (Number(match[8]) > 14 || Number(match[9]) > 59 ||
        (Number(match[8]) === 14 && Number(match[9]) !== 0)))) return invalid();
  date(match[1]);
  return result;
}

const ROUTES: Record<CampusPlanEvidence, CampusPlanRoute> = {
  'authorized-assignments': '/classroom',
  'saved-timetable': '/timetable',
  'authorized-announcements': '/announcements',
  verification: '/classroom',
};
const PRIORITIES: CampusPlanPriority[] = ['overdue', 'urgent', 'soon', 'normal', 'verify'];

function step(value: unknown): CampusPlanStep {
  const item = row(value);
  const evidence = choice(item.evidence, Object.keys(ROUTES) as CampusPlanEvidence[]);
  const route = choice(item.route, ['/classroom', '/timetable', '/announcements'] as const);
  if (route !== ROUTES[evidence] || (item.dueAt !== undefined && evidence !== 'authorized-assignments')) return invalid();
  // Deliberately omit runtime nuniSource. A saved plan is display evidence, not an action context.
  return {
    id: text(item.id, 100),
    title: text(item.title, 240),
    detail: text(item.detail, 4000),
    priority: choice(item.priority, PRIORITIES),
    evidence,
    route,
    ...(item.dueAt !== undefined ? { dueAt: savedPlanTimestamp(item.dueAt) } : {}),
    ...(item.groupName !== undefined ? { groupName: text(item.groupName, 160, true) } : {}),
  };
}

function interval(value: unknown): PeriodInterval {
  const item = row(value);
  const start = number(item.start, 1, 288);
  const end = number(item.end, start, 288);
  return { start, end };
}
function course(value: unknown): AgendaCourse {
  const item = row(value);
  return {
    name: text(item.name, 240),
    day: number(item.day, 0, 6),
    ...interval(item),
    ...(item.room !== undefined ? { room: text(item.room, 240, true) } : {}),
  };
}
function assignment(value: unknown, undated = false): AgendaAssignment {
  const item = row(value);
  if (undated && item.dueAt !== null && (typeof item.dueAt !== 'string' || item.dueAt.length > 40)) return invalid();
  // Both dated and outside-window rows discard any live target hint on save and restore.
  return {
    title: text(item.title, 240),
    groupName: text(item.groupName, 160, true),
    // Unconfirmed date text stays unconfirmed when a historical plan is restored.
    dueAt: undated || item.dueAt === null ? null : savedPlanTimestamp(item.dueAt),
  };
}
function scheduledClass(value: unknown, dayDate: string): AgendaScheduledClass {
  const item = row(value);
  const startAt = savedPlanTimestamp(item.startAt);
  const endAt = savedPlanTimestamp(item.endAt);
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const dayStart = Date.parse(dayDate + 'T00:00:00+08:00');
  // A clock occurrence may span two days, but it must intersect this Taiwan day.
  if (end <= start || end - start > 86_400_000 || start >= dayStart + 86_400_000 || end <= dayStart) return invalid();
  return { name: text(item.name, 240), room: text(item.room, 240, true), startAt, endAt };
}
function day(value: unknown): CampusAgendaDay {
  const item = row(value);
  const dayDate = date(item.date);
  const courses = list(item.courses, 80, course);
  const gaps = list(item.gaps, 80, interval);
  const conflicts = list(item.conflicts, 80, interval);
  const scheduledClasses = item.scheduledClasses !== undefined
    ? list(item.scheduledClasses, 80, (value) => scheduledClass(value, dayDate)) : undefined;
  if (scheduledClasses !== undefined && (courses.length || gaps.length || conflicts.length)) return invalid();
  if (courses.some((entry) => entry.day !== new Date(dayDate + 'T00:00:00Z').getUTCDay())) return invalid();
  return {
    date: dayDate,
    label: text(item.label, 80),
    courses,
    gaps,
    conflicts,
    ...(scheduledClasses !== undefined ? { scheduledClasses } : {}),
    deadlines: list(item.deadlines, 400, (value) => {
      const deadline = row(value);
      const timeLabel = text(deadline.timeLabel, 8);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeLabel)) return invalid();
      return { ...assignment(deadline), dueAt: savedPlanTimestamp(deadline.dueAt),
        timeLabel, overdue: bool(deadline.overdue) };
    }),
  };
}
function agenda(value: unknown): CampusStudyAgenda {
  const item = row(value);
  const days = list(item.days, 7, day);
  if (!days.length || days.some((entry, i) => i > 0 &&
      Date.parse(entry.date + 'T00:00:00Z') - Date.parse(days[i - 1].date + 'T00:00:00Z') !== 86_400_000)) return invalid();
  const outsideWindow = list(item.outsideWindow, 400, (value) => {
    const outside = row(value);
    const reason = choice(outside.reason, ['undated', 'before-window', 'after-window'] as const);
    return { ...assignment(outside, reason === 'undated'), reason };
  });
  if (outsideWindow.length + days.reduce((sum, entry) => sum + entry.deadlines.length, 0) > 400) return invalid();
  const timetableAvailable = bool(item.timetableAvailable);
  const assignmentsAvailable = bool(item.assignmentsAvailable);
  const clockFormat = days[0].scheduledClasses !== undefined;
  if (days.some((entry) => (entry.scheduledClasses !== undefined) !== clockFormat)) return invalid();
  if ((!timetableAvailable && (clockFormat || days.some((entry) => entry.courses.length || entry.gaps.length || entry.conflicts.length))) ||
      (!assignmentsAvailable && (outsideWindow.length || days.some((entry) => entry.deadlines.length)))) return invalid();
  return { days, timetableAvailable, assignmentsAvailable,
    ignoredCourses: number(item.ignoredCourses, 0, 80), outsideWindow };
}

function comparisonBasis(value: unknown): CampusPlanComparisonBasis {
  const basis = row(value);
  const assignments = row(basis.assignments);
  const status = choice(assignments.status, ['complete', 'partial', 'unavailable'] as const);
  const checkedAt = assignments.checkedAt === null ? null : savedPlanTimestamp(assignments.checkedAt);
  const total = assignments.total === null ? null : number(assignments.total, 0, Number.MAX_SAFE_INTEGER);
  const items = list(assignments.items, 400, (value) => {
    const item = row(value);
    let identity: [string, string] | null = null;
    if (item.identity !== null) {
      if (!Array.isArray(item.identity) || item.identity.length !== 2) return invalid();
      const parts = Array.from(item.identity, (part) => text(part, 128));
      if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return invalid();
      identity = [parts[0], parts[1]];
    }
    return { identity, ...assignment(item) };
  });
  if (status === 'unavailable') {
    if (checkedAt !== null || total !== null || items.length) return invalid();
  } else if (!checkedAt || (total !== null && total < items.length) ||
      (status === 'complete' && total !== items.length)) return invalid();
  return {
    assignments: { status, checkedAt, total, items },
    timetableUpdatedAt: basis.timetableUpdatedAt === null ? null : savedPlanTimestamp(basis.timetableUpdatedAt),
  };
}

/** Project data rather than restoring arbitrary fields as future tool authority. */
export function copyCampusEvidencePlan(value: unknown): CampusEvidencePlan {
  const item = row(value);
  const steps = list(item.steps, 5, step);
  if (!steps.length || new Set(steps.map((entry) => entry.id)).size !== steps.length) return invalid();
  const checkedAt = savedPlanTimestamp(item.checkedAt);
  const savedAgenda = item.agenda !== undefined ? agenda(item.agenda) : undefined;
  const basis = item.comparisonBasis !== undefined ? comparisonBasis(item.comparisonBasis) : undefined;
  if (basis && ((savedAgenda && savedAgenda.assignmentsAvailable !== (basis.assignments.status !== 'unavailable')) ||
      (basis.assignments.checkedAt && Date.parse(basis.assignments.checkedAt) > Date.parse(checkedAt) + 30_000) ||
      (savedAgenda && !savedAgenda.timetableAvailable && basis.timetableUpdatedAt !== null))) return invalid();
  return {
    title: text(item.title, 240),
    overview: text(item.overview, 4000),
    checkedAt,
    steps,
    limitations: list(item.limitations, 8, (value) => text(value, 2000)),
    ...(savedAgenda ? { agenda: savedAgenda } : {}),
    ...(basis ? { comparisonBasis: basis } : {}),
    content: text(item.content, 120_000),
  };
}
