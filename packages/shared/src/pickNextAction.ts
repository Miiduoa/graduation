import { parseTaipeiInstant, taipeiParts, TAIPEI_TIME_ZONE } from './taipeiTime';

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export const TODAY_COPY = {
  unsigned: '登入後，這裡會列出近期要處理的課程待辦。',
  emptyDay: '今天沒有課，也沒有要交的作業。',
  allClassesDone: '今天的課都結束了',
  timetableUnavailable: '暫時讀不到課表',
  retry: '再試一次',
  noTimetable: '還沒有課表。',
  importTimetable: '匯入課表',
  lmsUnconnected: '這裡會顯示課程平台上的作業，目前還沒連上。',
  nextClass: '下一堂課',
  nextAssignment: '下一件作業',
  dueToday: '今天截止',
  viewCourse: '看課程',
  goSubmit: '去繳交',
  viewWeek: '看這週',
  viewFullTimetable: '看完整課表',
  moreTodos: (count: number) => `還有 ${count} 件`,
  overdueDays: (days: number) => `已逾期 ${days} 天`,
  overdue: '已逾期',
} as const;

export type TodayClass = {
  id: string;
  title: string;
  location: string;
  startAt: number;
  endAt: number;
  courseId?: string;
};

export type TodayTodo = {
  id: string;
  title: string;
  courseName: string;
  courseId?: string;
  dueAt: number | null;
  href?: string;
};

export type NextAction =
  | { type: 'class'; class: TodayClass }
  | { type: 'assignment'; todo: TodayTodo }
  | { type: 'upcoming'; todo: TodayTodo }
  | { type: 'overdue'; todo: TodayTodo }
  | { type: 'empty' }
  | { type: 'allDone'; todo: TodayTodo | null };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function taipeiWeekdayIndex(now: Date): number | null {
  const parts = taipeiParts(now);
  if (!parts) return null;
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.getUTCDay();
}

export function taipeiInstantOnClock(now: Date, clock: string, dayOffset = 0): number | null {
  const parts = taipeiParts(now);
  if (!parts || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const base = Date.UTC(parts.year, parts.month - 1, parts.day) + dayOffset * DAY_MS;
  const wall = new Date(base);
  const instant = parseTaipeiInstant(
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${clock}:00`,
  );
  return instant;
}

export function isSameTaipeiDay(left: number, right: number): boolean {
  const a = taipeiParts(left);
  const b = taipeiParts(right);
  return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

export function taipeiCalendarDayDiff(from: number, to: number): number | null {
  const start = taipeiParts(from);
  const end = taipeiParts(to);
  if (!start || !end) return null;
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / DAY_MS);
}

function classOnToday(item: TodayClass, nowMs: number): boolean {
  return isSameTaipeiDay(item.startAt, nowMs);
}

function upcomingClasses(classes: readonly TodayClass[], nowMs: number): TodayClass[] {
  return classes
    .filter((item) => classOnToday(item, nowMs) && item.endAt > nowMs)
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id));
}

function laterClassesToday(classes: readonly TodayClass[], nowMs: number): TodayClass[] {
  return upcomingClasses(classes, nowMs).filter((item) => item.startAt > nowMs);
}

/** 30 分鐘內有課：正在上的課（已開始、尚未結束）也算。 */
function classStartingSoon(classes: readonly TodayClass[], nowMs: number): TodayClass | null {
  return (
    upcomingClasses(classes, nowMs).find(
      (item) => item.startAt <= nowMs || item.startAt - nowMs <= THIRTY_MIN_MS,
    ) ?? null
  );
}

function hasDeadline(todo: TodayTodo): todo is TodayTodo & { dueAt: number } {
  return todo.dueAt !== null && Number.isFinite(todo.dueAt);
}

function dueWithin24h(todos: readonly TodayTodo[], nowMs: number): TodayTodo | null {
  const upcoming = todos
    .filter(hasDeadline)
    .filter((item) => item.dueAt >= nowMs && item.dueAt - nowMs <= DAY_MS)
    .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  return upcoming[0] ?? null;
}

function nearestTodo(todos: readonly TodayTodo[], nowMs: number): TodayTodo | null {
  const ranked = [...todos]
    .filter(hasDeadline)
    .sort(
      (a, b) =>
        Math.abs(a.dueAt - nowMs) - Math.abs(b.dueAt - nowMs) ||
        a.dueAt - b.dueAt ||
        a.id.localeCompare(b.id),
    );
  return ranked[0] ?? todos.find((item) => item.dueAt === null) ?? null;
}

function earliestOverdue(todos: readonly TodayTodo[], nowMs: number): TodayTodo | null {
  const overdue = todos
    .filter(hasDeadline)
    .filter((item) => item.dueAt < nowMs)
    .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  return overdue[0] ?? null;
}

function earliestOpenTodo(todos: readonly TodayTodo[]): TodayTodo | null {
  return sortTodayTodos(todos)[0] ?? null;
}

export function pickNextAction(
  classes: readonly TodayClass[],
  todos: readonly TodayTodo[],
  now: Date,
): NextAction {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { type: 'empty' };

  const soon = classStartingSoon(classes, nowMs);
  if (soon) return { type: 'class', class: soon };

  const dueSoon = dueWithin24h(todos, nowMs);
  if (dueSoon) return { type: 'assignment', todo: dueSoon };

  const later = laterClassesToday(classes, nowMs)[0];
  if (later) return { type: 'class', class: later };

  const overdue = earliestOverdue(todos, nowMs);
  if (overdue) return { type: 'overdue', todo: overdue };

  const todayClasses = classes.filter((item) => classOnToday(item, nowMs));
  if (todayClasses.length > 0 && todayClasses.every((item) => item.endAt <= nowMs)) {
    return { type: 'allDone', todo: nearestTodo(todos, nowMs) };
  }

  const leftover = earliestOpenTodo(todos);
  if (leftover) return { type: 'upcoming', todo: leftover };

  return { type: 'empty' };
}

export function sortTodayClasses(classes: readonly TodayClass[], now: Date): TodayClass[] {
  const nowMs = now.getTime();
  return [...classes]
    .filter((item) => classOnToday(item, nowMs))
    .sort((a, b) => {
      const aEnded = a.endAt <= nowMs;
      const bEnded = b.endAt <= nowMs;
      if (aEnded !== bEnded) return aEnded ? 1 : -1;
      return a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id);
    });
}

export function sortTodayTodos(todos: readonly TodayTodo[]): TodayTodo[] {
  return [...todos]
    .filter((item) => item.dueAt === null || hasDeadline(item))
    .sort((a, b) => {
      if (a.dueAt === null && b.dueAt !== null) return 1;
      if (b.dueAt === null && a.dueAt !== null) return -1;
      return (a.dueAt ?? 0) - (b.dueAt ?? 0) || a.id.localeCompare(b.id);
    });
}

export function formatTodayHeaderDate(now: Date): string {
  const parts = taipeiParts(now);
  const weekday = taipeiWeekdayIndex(now);
  if (!parts || weekday === null) return '';
  return `${parts.month}月${parts.day}日 ${WEEKDAYS[weekday]}`;
}

export function formatUpdatedAt(now: Date): string {
  const parts = taipeiParts(now);
  if (!parts) return '';
  return `${pad(parts.hour24)}:${pad(parts.minute)} 更新`;
}

export function formatClock(value: number): string {
  const parts = taipeiParts(value);
  if (!parts) return '';
  return `${pad(parts.hour24)}:${pad(parts.minute)}`;
}

export function formatClassMeta(item: TodayClass): string {
  const time = formatClock(item.startAt);
  const place = item.location.trim();
  return place ? `${time}・${place}` : time;
}

function validTaipeiParts(value: number) {
  const parts = taipeiParts(value);
  return parts && Number.isFinite(parts.year) && Number.isFinite(parts.hour24) ? parts : null;
}

function deadlineDate(dueAt: number, nowMs: number): string | null {
  const due = validTaipeiParts(dueAt);
  const current = validTaipeiParts(nowMs);
  if (!due || !current) return null;
  const dayDifference = taipeiCalendarDayDiff(nowMs, dueAt);
  if (dayDifference === 0) return '今天';
  if (dayDifference === 1) return '明天';
  const year = due.year !== current.year ? `${due.year}/` : '';
  return `${year}${due.month}/${due.day}`;
}

/** Calendar labels describe the date; the 24-hour priority window stays unchanged. */
export function formatTodoDeadlineLabel(todo: TodayTodo, now: Date): string {
  if (todo.dueAt === null) return '未設截止時間';
  const nowMs = now.getTime();
  const date = hasDeadline(todo) ? deadlineDate(todo.dueAt, nowMs) : null;
  if (date === null) return '截止時間待確認';
  if (todo.dueAt < nowMs) return TODAY_COPY.overdue;
  return `${date}${date === '今天' || date === '明天' ? '' : ' '}截止`;
}

function remainingTimeText(dueAt: number, nowMs: number): string {
  const remaining = dueAt - nowMs;
  if (remaining < MINUTE_MS) return '不到 1 分鐘';
  const totalMinutes = Math.ceil(remaining / MINUTE_MS);
  if (remaining < HOUR_MS) return `還剩 ${totalMinutes} 分鐘`;
  if (remaining < DAY_MS) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `還剩 ${hours} 小時${minutes ? ` ${minutes} 分鐘` : ''}`;
  }
  const totalHours = Math.floor(remaining / HOUR_MS);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `還剩 ${days} 天${hours ? ` ${hours} 小時` : ''}`;
}

export function formatTodoDueLine(todo: TodayTodo, now: Date): string {
  const nowMs = now.getTime();
  if (todo.dueAt === null) return '未設截止時間';
  const date = hasDeadline(todo) ? deadlineDate(todo.dueAt, nowMs) : null;
  if (date === null) return '截止時間待確認';
  if (todo.dueAt < nowMs) {
    const days = Math.floor((nowMs - todo.dueAt) / DAY_MS);
    return days >= 1 ? TODAY_COPY.overdueDays(days) : TODAY_COPY.overdue;
  }
  return `${date} ${formatClock(todo.dueAt)} 截止・${remainingTimeText(todo.dueAt, nowMs)}`;
}

export function formatUpcomingDueLine(todo: TodayTodo, now?: Date): string {
  if (todo.dueAt === null) return '未設截止時間';
  if (!hasDeadline(todo)) return '截止時間待確認';
  const parts = validTaipeiParts(todo.dueAt);
  const current = now ? validTaipeiParts(now.getTime()) : undefined;
  const weekday = taipeiWeekdayIndex(new Date(todo.dueAt));
  if (!parts || weekday === null || (now && !current)) return '截止時間待確認';
  const year = current && parts.year !== current.year ? `${parts.year}/` : '';
  return `${year}${parts.month}/${parts.day} ${WEEKDAYS[weekday]} ${pad(parts.hour24)}:${pad(parts.minute)} 截止`;
}

export function isDueWithinHours(todo: TodayTodo, now: Date, hours: number): boolean {
  const nowMs = now.getTime();
  return hasDeadline(todo) && todo.dueAt >= nowMs && todo.dueAt - nowMs <= hours * 60 * 60 * 1000;
}

export function isTodoOverdue(todo: TodayTodo, now: Date): boolean {
  return hasDeadline(todo) && todo.dueAt < now.getTime();
}

export { TAIPEI_TIME_ZONE };
