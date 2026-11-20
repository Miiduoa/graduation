/**
 * Timetable → classroom course-work navigation.
 * Trust linkedCourseId only; otherwise carry a search query. Never writes links.
 *
 * Query / filter rules live in @campus/shared timetable classroomCourseQuery.
 */

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

export type TimetableClassroomDestination =
  | { kind: 'linked'; screen: 'CourseHub'; params: { courseId: string } }
  | {
      kind: 'search';
      screen: 'Classroom';
      params: { q?: string; from?: 'timetable'; code?: string };
    };

export function resolveTimetableClassroomNav(input: {
  linkedCourseId?: string | null;
  courseName: string;
  courseCode?: string | null;
}): TimetableClassroomDestination {
  const linked = input.linkedCourseId?.trim();
  if (linked) {
    return { kind: 'linked', screen: 'CourseHub', params: { courseId: linked } };
  }
  const params = timetableClassroomSearchParams(input);
  if (!('q' in params) || !params.q) {
    // Match web: empty name → Classroom home without an empty q.
    return { kind: 'search', screen: 'Classroom', params: {} };
  }
  return { kind: 'search', screen: 'Classroom', params };
}

/** Prefer precomputed nav from the today hook; otherwise resolve from class fields. */
export function courseWorkNavForClass(item: {
  title: string;
  courseId?: string | null;
  courseCode?: string | null;
  courseWorkNav?: TimetableClassroomDestination;
}): TimetableClassroomDestination {
  return (
    item.courseWorkNav ??
    resolveTimetableClassroomNav({
      linkedCourseId: item.courseId,
      courseName: item.title,
      courseCode: item.courseCode,
    })
  );
}

/**
 * Screen + params for today-page course-work presses.
 * Linked keeps today's CourseHub group params so the hub still resolves the course.
 */
export function todayCourseWorkNavigateTarget(destination: TimetableClassroomDestination): {
  screen: 'CourseHub' | 'Classroom';
  params: Record<string, unknown>;
} {
  if (destination.kind === 'linked') {
    return {
      screen: 'CourseHub',
      params: {
        courseSpaceId: destination.params.courseId,
        groupId: destination.params.courseId,
        section: 'week',
      },
    };
  }
  return { screen: destination.screen, params: { ...destination.params } };
}
