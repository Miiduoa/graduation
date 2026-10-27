/** Pure, read-only calendar calculations over context already verified by the caller. */
export interface AgendaCourse {
  name: string;
  day: number;
  start: number;
  end: number;
  room?: string;
}
export interface AgendaAssignment {
  title: string;
  groupName: string;
  dueAt: string | null;
}
export interface PeriodInterval { start: number; end: number }
export interface StudyWindow {
  startDay: number;
  endDay: number; // Exclusive, logical Taiwan calendar days, not elapsed local hours.
  title: string;
}
export interface AgendaDeadline extends AgendaAssignment {
  dueAt: string;
  timeLabel: string;
  overdue: boolean;
}
export interface CampusAgendaDay {
  date: string;
  label: string;
  courses: AgendaCourse[];
  gaps: PeriodInterval[];
  conflicts: PeriodInterval[];
  deadlines: AgendaDeadline[];
}
export interface CampusStudyAgenda {
  days: CampusAgendaDay[];
  timetableAvailable: boolean;
  assignmentsAvailable: boolean;
  ignoredCourses: number;
  outsideWindow: Array<AgendaAssignment & { reason: 'undated' | 'before-window' | 'after-window' }>;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function taipeiDayNumber(timestamp: number): number {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(number('year'), number('month') - 1, number('day')) / DAY_MS;
}

export function resolveStudyWindow(question: string, timestamp: number): StudyWindow | null {
  const today = taipeiDayNumber(timestamp);
  if (!Number.isFinite(today)) return null;
  const weekday = new Date(today * DAY_MS).getUTCDay();
  const untilMonday = 7 - ((weekday + 6) % 7);
  if (/下週|下星期|下禮拜/.test(question)) {
    return { startDay: today + untilMonday, endDay: today + untilMonday + 7, title: '下週學習行動' };
  }
  if (/明天|明日/.test(question)) {
    return { startDay: today + 1, endDay: today + 2, title: '明日學習行動' };
  }
  if (/(?:接下來|未來).{0,4}(?:七天|7天)/.test(question)) {
    return { startDay: today, endDay: today + 7, title: '接下來七天的學習行動' };
  }
  if (/本週|這週|本星期|這星期/.test(question)) {
    return { startDay: today, endDay: today + untilMonday, title: '本週剩餘學習行動' };
  }
  if (/今天|今日/.test(question)) {
    return { startDay: today, endDay: today + 1, title: '今日優先行動' };
  }
  const weekly = /一週|一周|學習計畫|讀書計畫|週計畫/.test(question);
  return { startDay: today, endDay: today + (weekly ? 7 : 1), title: weekly ? '接下來七天的學習行動' : '今日優先行動' };
}

export function usableCourse(course: AgendaCourse): boolean {
  // The saved timetable contract reserves day=0/start=0/end=0 for unscheduled courses.
  return typeof course.name === 'string' && Boolean(course.name.trim()) &&
    Number.isInteger(course.day) && course.day >= 1 && course.day <= 6 &&
    Number.isSafeInteger(course.start) && Number.isSafeInteger(course.end) &&
    course.start > 0 && course.end >= course.start && course.end < Number.MAX_SAFE_INTEGER;
}

export function periodLabel(period: PeriodInterval): string {
  return period.start === period.end ? '第 ' + period.start + ' 節' : '第 ' + period.start + '–' + period.end + ' 節';
}

/** Union intervals first: a nested class must not create a fictitious free period. */
export function inspectCoursePeriods(courses: readonly AgendaCourse[]): {
  gaps: PeriodInterval[]; conflicts: PeriodInterval[];
} {
  const rows = courses.filter(usableCourse).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const occupied: PeriodInterval[] = [];
  const events = new Map<number, number>();
  for (const row of rows) {
    const last = occupied[occupied.length - 1];
    if (last && row.start <= last.end + 1) last.end = Math.max(last.end, row.end);
    else occupied.push({ start: row.start, end: row.end });
    events.set(row.start, (events.get(row.start) ?? 0) + 1);
    events.set(row.end + 1, (events.get(row.end + 1) ?? 0) - 1);
  }
  const gaps = occupied.slice(1).map((row, i) => ({ start: occupied[i].end + 1, end: row.start - 1 }));
  const points = [...events.keys()].sort((a, b) => a - b);
  const conflicts: PeriodInterval[] = [];
  let count = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    count += events.get(points[i]) ?? 0;
    if (count < 2) continue;
    const segment = { start: points[i], end: points[i + 1] - 1 };
    const last = conflicts[conflicts.length - 1];
    if (last && last.end + 1 === segment.start) last.end = segment.end;
    else conflicts.push(segment);
  }
  return { gaps, conflicts };
}

function confirmedTimestamp(value: string | null): number {
  // Date-only or offset-free text is not permission to invent a school deadline.
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

export function buildCampusStudyAgenda(input: {
  window: StudyWindow;
  now: number;
  courses: readonly AgendaCourse[] | null;
  assignments: readonly AgendaAssignment[] | null;
}): CampusStudyAgenda {
  const { startDay, endDay } = input.window;
  if (!Number.isSafeInteger(startDay) || !Number.isSafeInteger(endDay) ||
      endDay <= startDay || endDay - startDay > 7 ||
      !Number.isFinite(new Date(startDay * DAY_MS).getTime()) ||
      !Number.isFinite(new Date(endDay * DAY_MS).getTime())) {
    throw new Error('Invalid study window');
  }
  const courses = (input.courses ?? []).filter(usableCourse);
  const days: CampusAgendaDay[] = [];
  for (let day = startDay; day < endDay; day += 1) {
    const date = new Date(day * DAY_MS);
    const rows = courses.filter((course) => course.day === date.getUTCDay())
      .map((course) => ({ ...course }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    days.push({
      date: date.toISOString().slice(0, 10),
      label: (date.getUTCMonth() + 1) + '/' + date.getUTCDate() + '（週' + WEEKDAYS[date.getUTCDay()] + '）',
      courses: rows, ...inspectCoursePeriods(rows), deadlines: [],
    });
  }
  const outsideWindow: CampusStudyAgenda['outsideWindow'] = [];
  for (const assignment of input.assignments ?? []) {
    const due = confirmedTimestamp(assignment.dueAt);
    const dueDay = taipeiDayNumber(due);
    if (!Number.isFinite(dueDay) || dueDay < startDay || dueDay >= endDay) {
      outsideWindow.push({ ...assignment, reason: !Number.isFinite(dueDay) ? 'undated' : dueDay < startDay ? 'before-window' : 'after-window' });
      continue;
    }
    days[dueDay - startDay].deadlines.push({
      ...assignment, dueAt: assignment.dueAt!, overdue: due < input.now,
      timeLabel: new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(due)),
    });
  }
  for (const day of days) day.deadlines.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return {
    days, timetableAvailable: input.courses !== null, assignmentsAvailable: input.assignments !== null,
    ignoredCourses: (input.courses?.length ?? 0) - courses.length, outsideWindow,
  };
}

export function formatCampusStudyAgenda(agenda: CampusStudyAgenda): string[] {
  return agenda.days.map((day) => {
    const classes = !agenda.timetableAvailable ? '課表來源不可用'
      : day.courses.length ? day.courses.map((course) => course.name + '（' + periodLabel(course) + '）').join('、')
      : '課表副本未排課，並非已確認空閒';
    const tasks = !agenda.assignmentsAvailable ? '作業來源不可用'
      : day.deadlines.length ? day.deadlines.map((item) => item.title + ' ' + item.timeLabel + ' 截止' + (item.overdue ? '（期限已過，需核對）' : '')).join('、')
      : '已同步摘要未列出當日截止作業';
    return day.label + '：' + classes + '；' + tasks +
      (day.gaps.length ? '；副本課間空堂：' + day.gaps.map(periodLabel).join('、') : '') +
      (day.conflicts.length ? '；課表重疊：' + day.conflicts.map(periodLabel).join('、') : '');
  });
}
