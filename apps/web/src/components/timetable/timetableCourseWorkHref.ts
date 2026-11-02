import { courseHrefFromData } from '@/lib/courseWorkLanding';

export const TIMETABLE_COURSE_WORK_FALLBACK = '/classroom';

/** Build the classroom list search string from timetable course fields. */
export function timetableCourseSearchQuery(input: {
  courseName: string;
  courseCode?: string | null;
}): string {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  if (name && code && !name.includes(code)) return `${name} ${code}`.slice(0, 120);
  return (name || code).slice(0, 120);
}

export function classroomSearchHref(query: string): string {
  const q = query.trim().slice(0, 120);
  if (!q) return TIMETABLE_COURSE_WORK_FALLBACK;
  return `${TIMETABLE_COURSE_WORK_FALLBACK}?q=${encodeURIComponent(q)}`;
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
  return classroomSearchHref(timetableCourseSearchQuery(input));
}

export function courseSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

/** Match classroom course titles against a timetable-driven q parameter. */
export function filterCoursesByClassroomQuery<T extends { title: string }>(
  courses: readonly T[],
  query: string,
): T[] {
  const key = courseSearchKey(query);
  if (!key) return [...courses];
  const words = key.split(/\s+/).filter(Boolean);
  return courses.filter((course) => {
    const title = courseSearchKey(course.title);
    return words.every((word) => title.includes(word));
  });
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
