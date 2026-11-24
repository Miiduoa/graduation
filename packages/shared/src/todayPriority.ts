import { currentSemesterStartUtc, rocSchoolYear } from './campusAnnouncementQuality';
import { courseTerm } from './courseAccess';
import { personalTimetableTerms } from './imports/today';
import type { PersonalImportRecord } from './imports/types';
import {
  formatClock,
  formatTodoDueLine,
  isSameTaipeiDay,
  pickNextAction,
  sortTodayTodos,
  type TodayClass,
  type TodayTodo,
} from './pickNextAction';

export type TodayPriority =
  | { kind: 'deadline-during-class'; title: string; reason: string; todo: TodayTodo; course: TodayClass }
  | { kind: 'todo'; title: string; reason: string; todo: TodayTodo; course?: undefined }
  | { kind: 'class'; title: string; reason: string; course: TodayClass; todo?: undefined };

/** Timetable views may deliberately show a previous or future term. */
export function isCurrentPriorityTerm(termKey: string | undefined, now: Date): boolean {
  if (!termKey || !Number.isFinite(now.getTime())) return false;
  const parts = termKey.split('|');
  if (parts.length !== 2) return false;
  try {
    const term = courseTerm(parts[0], parts[1]);
    const semester = currentSemesterStartUtc(now).getUTCMonth() === 7 ? '1' : '2';
    return term.academicYear === String(rocSchoolYear(now)) && term.semester === semester;
  } catch {
    return false;
  }
}

/** Pick a saved current term before the timetable view falls back to its newest stored term. */
export function currentTimetableTermKey(records: readonly PersonalImportRecord[], schoolId: string, now: Date) {
  return personalTimetableTerms(records, schoolId).find(term => isCurrentPriorityTerm(term.key, now))?.key;
}

/** Compare pending work and timetable rows from the caller's current account and campus. */
export function pickTodayPriority(
  classes: readonly TodayClass[],
  todos: readonly TodayTodo[],
  now: Date,
): TodayPriority | null {
  const time = now.getTime();
  if (!Number.isFinite(time)) return null;
  // A rescheduled class can cross midnight and still occupy time today.
  const schedule = classes.filter((course) =>
    Number.isFinite(course.startAt) && Number.isFinite(course.endAt) &&
    course.endAt > course.startAt && course.endAt > time &&
    (course.startAt <= time || isSameTaipeiDay(course.startAt, time)),
  ).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id));
  const dated = sortTodayTodos(todos).filter(
    (todo): todo is TodayTodo & { dueAt: number } =>
      todo.dueAt !== null && Number.isFinite(todo.dueAt) && isSameTaipeiDay(todo.dueAt, time),
  );

  const nextDue = dated.find((todo) => todo.dueAt >= time);
  if (nextDue) {
    const course = schedule.find((row) => row.startAt <= nextDue.dueAt && nextDue.dueAt < row.endAt);
    if (course) {
      const period = formatClock(course.startAt) + '–' + formatClock(course.endAt);
      const advice = time < course.startAt ? '可以趁上課前處理。' : '課已經開始，可以先查看繳交狀態。';
      const work = nextDue.courseName ? `「${nextDue.courseName}」的待辦` : '這項待辦';
      return {
        kind: 'deadline-during-class',
        title: nextDue.title,
        reason: `「${course.title}」${period} 上課，${work}在 ${formatClock(nextDue.dueAt)} 截止。${advice}`,
        todo: nextDue,
        course,
      };
    }
  }

  const nextClass = schedule[0];
  const action = pickNextAction(schedule, dated, now);
  const active = nextClass && nextClass.startAt <= time;
  const dueBeforeClass = nextClass && nextDue && nextDue.dueAt < nextClass.startAt;
  const course = active ? nextClass : action.type === 'class' && !dueBeforeClass ? action.class : null;
  if (course) {
    const period = formatClock(course.startAt) + '–' + formatClock(course.endAt);
    const place = course.location.trim();
    return {
      kind: 'class',
      title: course.title,
      reason: `${time >= course.startAt ? '正在上課' : '下一堂課'}，${period}${place ? '，教室 ' + place : ''}。`,
      course,
    };
  }
  const todo = dueBeforeClass ? nextDue : 'todo' in action ? action.todo : null;
  if (todo) {
    const deadline = todo.dueAt !== null && todo.dueAt < time
      ? `今天 ${formatClock(todo.dueAt)} 已截止，可查看繳交狀態。`
      : formatTodoDueLine(todo, now);
    return { kind: 'todo', title: todo.title, reason: [todo.courseName, deadline].filter(Boolean).join('｜'), todo };
  }
  return null;
}
