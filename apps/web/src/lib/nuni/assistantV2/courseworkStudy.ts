import { buildPersonalToday } from '@campus/shared/src/imports/today';
import { parsePersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import {
  addDays,
  date,
  eventArgs,
  fail,
  hash,
  id,
  object,
  taipeiDate,
  text,
  type Adapter,
  type Binding,
  type Course,
  type CourseworkStudyGuard,
  type CourseworkStudyTarget,
  type EventArgs,
  type Ledger,
  type Task,
} from './contracts';
import { operationSignal } from './operation';

const MINUTE = 60_000;
const BUFFER = 10 * MINUTE;
const DURATION = 30 * MINUTE;
const GRID = 5 * MINUTE;
type Interval = { start: number; end: number };

export function courseworkStudyTarget(raw: unknown): CourseworkStudyTarget {
  const value = object(raw, ['workspaceId', 'taskId', 'kind', 'date']);
  if (value.kind !== 'assignment' && value.kind !== 'quiz') return fail();
  return {
    workspaceId: id(value.workspaceId),
    taskId: id(value.taskId),
    kind: value.kind,
    ...(value.date === undefined ? {} : { date: date(value.date) }),
  };
}

export function courseworkStudyGuard(raw: unknown): CourseworkStudyGuard {
  const value = object(raw, ['workspaceId', 'taskId', 'kind', 'fingerprint', 'policy']);
  if (
    (value.kind !== 'assignment' && value.kind !== 'quiz') ||
    (value.policy !== 'coursework-gap' && value.policy !== 'study') ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  )
    return fail();
  return {
    workspaceId: id(value.workspaceId),
    taskId: id(value.taskId),
    kind: value.kind,
    fingerprint: value.fingerprint,
    policy: value.policy,
  };
}

function deadline(task: Task): number | null {
  if (task.dueAt === null) return null;
  // A date-only value or a timezone-free clock cannot authorize a timed action.
  if (
    typeof task.dueAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      task.dueAt,
    ) ||
    !Number.isFinite(Date.parse(task.dueAt))
  )
    return fail('COURSEWORK_UNAVAILABLE', 409);
  const day = task.dueAt.slice(0, 10);
  try {
    date(day);
  } catch {
    return fail('COURSEWORK_UNAVAILABLE', 409);
  }
  return Date.parse(task.dueAt);
}

export function studyGuardForTask(
  task: Task,
  policy: CourseworkStudyGuard['policy'],
): CourseworkStudyGuard {
  if (
    task.state !== 'open' ||
    task.submitted !== false ||
    (task.kind !== undefined && task.kind !== 'assignment' && task.kind !== 'quiz')
  )
    return fail('COURSEWORK_CHANGED', 409);
  return {
    workspaceId: id(task.courseId),
    taskId: id(task.id),
    kind: task.kind || 'assignment',
    policy,
    fingerprint: hash({
      title: text(task.title, 1000),
      dueAt: deadline(task),
      state: task.state,
      submitted: task.submitted,
    }),
  };
}

/** Read current source facts, including closed/submitted work, without authorizing an action. */
export async function readCourseworkStudySource(
  adapter: Adapter,
  raw: CourseworkStudyTarget,
): Promise<{ course: Course; task: Task }> {
  const target = courseworkStudyTarget(raw);
  const checkCourse = async () => {
    operationSignal()?.throwIfAborted();
    const course = adapter.course
      ? await adapter.course(target.workspaceId)
      : (await adapter.courses()).courses.find((item) => item.id === target.workspaceId);
    operationSignal()?.throwIfAborted();
    if (!course || course.id !== target.workspaceId) return fail('COURSEWORK_UNAVAILABLE', 403);
    return { id: course.id, title: text(course.title, 1000) };
  };
  await checkCourse();
  const tasks = await adapter.work(target.workspaceId);
  operationSignal()?.throwIfAborted();
  if (!Array.isArray(tasks)) return fail('COURSEWORK_UNAVAILABLE', 502);
  const matches = tasks.filter(
    (task) =>
      task.courseId === target.workspaceId &&
      task.id === target.taskId &&
      (task.kind || 'assignment') === target.kind,
  );
  if (matches.length !== 1) return fail('COURSEWORK_UNAVAILABLE', 409);
  const task = { ...matches[0], title: text(matches[0].title, 1000) };
  if ((task.state !== 'open' && task.state !== 'closed') || typeof task.submitted !== 'boolean')
    return fail('COURSEWORK_UNAVAILABLE', 502);
  deadline(task);
  // Access revoked while work was being read cannot become a new preview.
  const course = await checkCourse();
  return { course, task };
}

/** IDs select a source; current school membership and the source itself remain authoritative. */
export async function readCourseworkStudyTask(
  adapter: Adapter,
  raw: CourseworkStudyTarget,
): Promise<Task> {
  const { task } = await readCourseworkStudySource(adapter, raw);
  studyGuardForTask(task, 'coursework-gap');
  return task;
}

function verifiedLedger(ledger: Ledger, binding: Binding): Ledger {
  if (ledger.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
  try {
    return parsePersonalImportSnapshot(ledger, binding.schoolId);
  } catch {
    return fail('SCHEDULE_INCOMPLETE', 409);
  }
}

function eventSpan(value: EventArgs): Interval {
  return {
    start: Date.parse(`${value.date}T${value.allDay ? '00:00' : value.startTime}:00+08:00`),
    end: Date.parse(
      `${value.endDate || (value.allDay ? addDays(value.date, 1) : value.date)}T${value.allDay ? '00:00' : value.endTime}:00+08:00`,
    ),
  };
}

/** Between known classes only, with the same margins as the native coursework flow. */
export function courseworkStudyWindows(ledger: Ledger, binding: Binding, day: string): Interval[] {
  date(day);
  const checked = verifiedLedger(ledger, binding);
  if (!checked.records.some((row) => row.kind === 'timetable'))
    return fail('SCHEDULE_INCOMPLETE', 409);
  const classes = buildPersonalToday(checked.records, {
    schoolId: binding.schoolId,
    now: new Date(`${day}T12:00:00+08:00`),
  });
  if (classes.unplacedCount) return fail('SCHEDULE_INCOMPLETE', 409);
  const midnight = Date.parse(`${day}T00:00:00+08:00`);
  const occupied: Interval[] = [];
  for (const item of [...classes.today].sort(
    (a, b) => a.startAt - b.startAt || a.endAt - b.endAt,
  )) {
    const interval = {
      start: Math.max(midnight, item.startAt),
      end: Math.min(midnight + 86_400_000, item.endAt),
    };
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start >= interval.end
    )
      return fail('SCHEDULE_INCOMPLETE', 409);
    const previous = occupied.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else occupied.push(interval);
  }
  let gaps: Interval[] = occupied
    .slice(1)
    .map((next, index) => ({
      start: Math.max(occupied[index].end + BUFFER, midnight + 8 * 60 * MINUTE),
      end: Math.min(next.start - BUFFER, midnight + 22 * 60 * MINUTE),
    }))
    .filter((gap) => gap.end > gap.start);
  for (const record of checked.records.filter((row) => row.kind === 'events')) {
    let span: Interval;
    try {
      span = eventSpan(
        eventArgs({
          title: record.title,
          date: record.date,
          ...(record.endDate ? { endDate: record.endDate } : {}),
          allDay: record.allDay ?? !record.startTime,
          ...(record.startTime ? { startTime: record.startTime } : {}),
          ...(record.endTime ? { endTime: record.endTime } : {}),
        }),
      );
    } catch {
      return fail('CALENDAR_INCOMPLETE', 409);
    }
    const start = span.start - BUFFER,
      end = span.end + BUFFER;
    gaps = gaps.flatMap((gap) => {
      if (end <= gap.start || start >= gap.end) return [gap];
      return [
        ...(gap.start < start ? [{ start: gap.start, end: start }] : []),
        ...(gap.end > end ? [{ start: end, end: gap.end }] : []),
      ];
    });
  }
  return gaps;
}

export function selectCourseworkStudyEvent(
  ledger: Ledger,
  binding: Binding,
  task: Task,
  now: number,
  requestedDate?: string,
): EventArgs | null {
  const due = deadline(task);
  if (due === null || due <= now) return fail('COURSEWORK_DEADLINE_REQUIRED', 409);
  const firstDay = taipeiDate(now),
    lastDay = addDays(firstDay, 6);
  if (requestedDate) {
    date(requestedDate);
    if (requestedDate < firstDay || requestedDate > lastDay)
      return fail('STUDY_DATE_OUT_OF_RANGE', 409);
  }
  for (
    let day = requestedDate || firstDay;
    day <= (requestedDate || lastDay);
    day = addDays(day, 1)
  ) {
    if (Date.parse(`${day}T00:00:00+08:00`) >= due) break;
    for (const gap of courseworkStudyWindows(ledger, binding, day)) {
      const start = Math.ceil(Math.max(gap.start, now + 1) / GRID) * GRID;
      const end = start + DURATION;
      if (end > Math.min(gap.end, due)) continue;
      return {
        title: `${task.kind === 'quiz' ? '複習測驗' : '準備作業'}：${task.title}`.slice(0, 120),
        date: day,
        allDay: false,
        startTime: new Date(start + 28_800_000).toISOString().slice(11, 16),
        endTime: new Date(end + 28_800_000).toISOString().slice(11, 16),
      };
    }
  }
  return null;
}

export async function verifyCourseworkStudyGuard(
  adapter: Adapter,
  binding: Binding,
  guard: CourseworkStudyGuard,
  event: EventArgs,
  ledger: Ledger,
  now: number,
): Promise<void> {
  const task = await readCourseworkStudyTask(adapter, {
    workspaceId: guard.workspaceId,
    taskId: guard.taskId,
    kind: guard.kind,
  });
  if (studyGuardForTask(task, guard.policy).fingerprint !== guard.fingerprint)
    return fail('COURSEWORK_CHANGED', 409);
  const span = eventSpan(event),
    due = deadline(task);
  if (due !== null && span.end > due) return fail('COURSEWORK_CHANGED', 409);
  if (guard.policy === 'coursework-gap') {
    if (
      span.start <= now ||
      span.end - span.start !== DURATION ||
      span.start % GRID !== 0 ||
      !courseworkStudyWindows(ledger, binding, event.date).some(
        (gap) => gap.start <= span.start && gap.end >= span.end,
      )
    )
      return fail('STUDY_SLOT_CHANGED', 409);
  }
}
