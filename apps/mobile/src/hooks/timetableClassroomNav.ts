/**
 * Timetable → classroom course-work navigation.
 * Trust linkedCourseId only; otherwise carry a search query. Never writes links.
 */

export type TimetableClassroomDestination =
  | { kind: 'linked'; screen: 'CourseHub'; params: { courseId: string } }
  | { kind: 'search'; screen: 'Classroom'; params: { q: string } };

export function timetableCourseSearchQuery(input: {
  courseName: string;
  courseCode?: string | null;
}): string {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  if (name && code && !name.includes(code)) return `${name} ${code}`.slice(0, 120);
  return (name || code).slice(0, 120);
}

export function resolveTimetableClassroomNav(input: {
  linkedCourseId?: string | null;
  courseName: string;
  courseCode?: string | null;
}): TimetableClassroomDestination {
  const linked = input.linkedCourseId?.trim();
  if (linked) {
    return { kind: 'linked', screen: 'CourseHub', params: { courseId: linked } };
  }
  const q = timetableCourseSearchQuery(input);
  return { kind: 'search', screen: 'Classroom', params: { q } };
}

export function courseSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

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
