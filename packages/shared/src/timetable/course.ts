import { PERIOD_COUNT, periodEnd, periodStart } from './periods';

export const COURSE_COLORS = ['violet', 'blue', 'mint', 'orange', 'pink', 'lime', 'gray'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

export type PersonalCourse = {
  id: string;
  name: string;
  day: number;
  start: number;
  end: number;
  teacher: string;
  room: string;
  color: CourseColor;
};

export type TimetableMeta = {
  school: string;
  year: string;
  semester: string;
  className: string;
  credits: number;
  title: string;
};

const COLOR_SET = new Set<string>(COURSE_COLORS);

function cleanText(value: unknown, max = 100): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, max);
}

function stableId(value: unknown): string {
  const raw = cleanText(value, 160);
  if (/^[A-Za-z0-9._:-]{1,100}$/.test(raw)) return raw;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(36)}`;
}

export function createCourseId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanCourse(input: Partial<PersonalCourse> | Record<string, unknown> = {}): PersonalCourse {
  let day = Number(input.day);
  let start = Number(input.start);
  let end = Number(input.end);
  if (!Number.isInteger(day) || day < 0 || day > 5) day = 0;
  if (day === 0) {
    start = 0;
    end = 0;
  } else {
    if (!Number.isInteger(start) || start < 1 || start > PERIOD_COUNT) start = 1;
    if (!Number.isInteger(end) || end < start || end > PERIOD_COUNT) end = start;
  }
  const color = COLOR_SET.has(String(input.color)) ? (input.color as CourseColor) : 'gray';
  return {
    id: stableId(input.id || createCourseId()),
    name: cleanText(input.name, 100) || '未命名課程',
    day,
    start,
    end,
    teacher: cleanText(input.teacher, 80),
    room: cleanText(input.room, 80),
    color,
  };
}

export function cleanCourses(value: unknown): PersonalCourse[] {
  return Array.isArray(value) ? value.slice(0, 80).map((item) => cleanCourse(item)) : [];
}

export function cleanMeta(value: Partial<TimetableMeta> | Record<string, unknown> = {}): TimetableMeta {
  return {
    school: cleanText(value.school, 80),
    year: cleanText(value.year, 12),
    semester: cleanText(value.semester, 12),
    className: cleanText(value.className, 80),
    credits: Math.max(0, Math.min(60, Number(value.credits) || 0)),
    title: cleanText(value.title, 80),
  };
}

export function courseTimeLabel(course: Pick<PersonalCourse, 'day' | 'start' | 'end'>): string {
  if (course.day === 0 || course.start === 0) return '時間待定';
  return `${periodStart(course.start)}–${periodEnd(course.end)}`;
}

export function normalizeCourseName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・·]/g, '');
}

export function coursesOverlap(a: Pick<PersonalCourse, 'day' | 'start' | 'end'>, b: Pick<PersonalCourse, 'day' | 'start' | 'end'>): boolean {
  return a.day > 0 && a.day === b.day && !(a.end < b.start || a.start > b.end);
}

export function sameCourseSlot(
  a: Pick<PersonalCourse, 'day' | 'start' | 'end' | 'name'>,
  b: Pick<PersonalCourse, 'day' | 'start' | 'end' | 'name'>,
): boolean {
  return a.day === b.day && a.start === b.start && a.end === b.end && normalizeCourseName(a.name) === normalizeCourseName(b.name);
}

export function courseKey(course: Pick<PersonalCourse, 'day' | 'start' | 'end' | 'name'>): string {
  return `${course.day}|${course.start}|${course.end}|${normalizeCourseName(course.name)}`;
}

export type ScheduleConflict = {
  first: PersonalCourse;
  second: PersonalCourse;
};

export function findCourseConflicts(courses: PersonalCourse[]): ScheduleConflict[] {
  const scheduled = courses.filter((course) => course.day > 0);
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      if (coursesOverlap(scheduled[i], scheduled[j]) && !sameCourseSlot(scheduled[i], scheduled[j])) {
        conflicts.push({ first: scheduled[i], second: scheduled[j] });
      }
    }
  }
  return conflicts;
}

/**
 * 開課代號：同一門課、同一位老師算同一個（同名但不同老師的課分得開）。
 * 老師工作台用它對到 schools/{schoolId}/courseTeachers/{代號}。
 */
export function courseOfferingId(course: { name: string; teacher?: string }): string {
  const clean = (value: string) => String(value || '').trim().replace(/\//g, '／').replace(/\s+/g, ' ');
  return `${clean(course.name)}｜${clean(course.teacher || '') || '老師未填'}`;
}

/** 存課表時一起寫的索引，送申訴時規則用它確認是自己課表裡的課。 */
export function timetableIndex(courses: Array<{ id: string; name: string; teacher?: string }>) {
  return {
    courseIds: courses.map((course) => course.id),
    offeringIds: [...new Set(courses.map((course) => courseOfferingId(course)))],
  };
}
