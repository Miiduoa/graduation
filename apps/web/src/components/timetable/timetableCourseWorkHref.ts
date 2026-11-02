import { courseHrefFromData } from '@/lib/courseWorkLanding';

export const TIMETABLE_COURSE_WORK_FALLBACK = '/classroom';

/** Build the classroom list search string from timetable course fields (name-primary). */
export function timetableCourseSearchQuery(input: {
  courseName: string;
  courseCode?: string | null;
}): string {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  // Prefer course name; if name is empty, fall back to code alone.
  return (name || code).slice(0, 120);
}

export function classroomSearchHref(
  query: string,
  options?: { fromTimetable?: boolean; courseCode?: string | null },
): string {
  const q = query.trim().slice(0, 120);
  if (!q) return TIMETABLE_COURSE_WORK_FALLBACK;
  const params = new URLSearchParams();
  params.set('q', q);
  if (options?.fromTimetable) params.set('from', 'timetable');
  const code = (options?.courseCode ?? '').trim().slice(0, 40);
  if (code) params.set('code', code);
  return `${TIMETABLE_COURSE_WORK_FALLBACK}?${params.toString()}`;
}

/**
 * Timetable → course-work exit.
 * Trust linkedCourseId only; otherwise land on /classroom with a search query.
 * Never writes linkedCourseId.
 */
export function resolveTimetableCourseWorkExit(input: {
  linkedCourseId?: string | null;
  courseName: string;
  courseCode?: string | null;
}): string {
  const linked = input.linkedCourseId?.trim();
  if (linked) {
    const href = courseHrefFromData({ courseId: linked });
    if (href) return href;
  }
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  const q = timetableCourseSearchQuery(input);
  const carryCode = Boolean(name && code && !name.includes(code));
  return classroomSearchHref(q, {
    fromTimetable: true,
    courseCode: carryCode ? code : undefined,
  });
}

export function courseSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

export type ClassroomQueryFilterOptions = {
  /** Timetable exit: name-primary; course code is OR / bonus narrowing. */
  fromTimetable?: boolean;
  courseCode?: string | null;
};

function courseFieldCode(course: { code?: string | null }): string {
  return courseSearchKey(course.code ?? '');
}

/**
 * Match classroom courses against q.
 * - Manual (default): whole-string substring on title (main semantics).
 * - Timetable: primary match on course name; code may appear in q or as
 *   options.courseCode and only counts as OR / bonus (title or code field).
 */
export function filterCoursesByClassroomQuery<T extends { title: string; code?: string | null }>(
  courses: readonly T[],
  query: string,
  options?: ClassroomQueryFilterOptions,
): T[] {
  const key = courseSearchKey(query);
  if (!key) return [...courses];

  if (!options?.fromTimetable) {
    return courses.filter((course) => courseSearchKey(course.title).includes(key));
  }

  const explicitCode = courseSearchKey(options.courseCode ?? '');
  const tokens = key.split(/\s+/).filter(Boolean);
  let nameKey = key;
  let codeKey = explicitCode;

  if (explicitCode) {
    const withoutCode = tokens.filter((token) => token !== explicitCode);
    nameKey = (withoutCode.join(' ').trim() || key);
  } else if (tokens.length >= 2) {
    // q embeds「課名 + 課號」: last token is optional code (OR / bonus only).
    codeKey = tokens[tokens.length - 1] ?? '';
    nameKey = tokens.slice(0, -1).join(' ').trim() || key;
  }

  const matched = courses.filter((course) => {
    const title = courseSearchKey(course.title);
    const fieldCode = courseFieldCode(course);
    if (nameKey && title.includes(nameKey)) return true;
    if (codeKey && (title.includes(codeKey) || fieldCode.includes(codeKey))) return true;
    if (title.includes(key)) return true;
    return false;
  });

  if (codeKey && matched.length > 1) {
    const narrowed = matched.filter((course) => {
      const title = courseSearchKey(course.title);
      const fieldCode = courseFieldCode(course);
      return title.includes(codeKey) || fieldCode.includes(codeKey);
    });
    if (narrowed.length > 0) return narrowed;
  }
  return matched;
}

export type ClassroomQueryMatchKind = 'all' | 'unique' | 'multi' | 'none';

export function classroomQueryMatchKind(
  matchCount: number,
  hasQuery: boolean,
): ClassroomQueryMatchKind {
  if (!hasQuery) return 'all';
  if (matchCount === 0) return 'none';
  if (matchCount === 1) return 'unique';
  return 'multi';
}
