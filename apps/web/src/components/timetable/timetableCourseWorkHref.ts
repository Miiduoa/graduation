import { courseHrefFromData } from '@/lib/courseWorkLanding';
import {
  classroomQueryMatchKind,
  courseSearchKey,
  filterCoursesByClassroomQuery,
  timetableClassroomSearchParams,
  timetableCourseSearchQuery,
  type ClassroomQueryFilterOptions,
  type ClassroomQueryMatchKind,
} from '@campus/shared/src/timetable/classroomCourseQuery';

export {
  classroomQueryMatchKind,
  courseSearchKey,
  filterCoursesByClassroomQuery,
  timetableCourseSearchQuery,
};
export type { ClassroomQueryFilterOptions, ClassroomQueryMatchKind };

export const TIMETABLE_COURSE_WORK_FALLBACK = '/classroom';

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
  const params = timetableClassroomSearchParams(input);
  if (!('q' in params) || !params.q) return TIMETABLE_COURSE_WORK_FALLBACK;
  return classroomSearchHref(params.q, {
    fromTimetable: true,
    courseCode: params.code,
  });
}
