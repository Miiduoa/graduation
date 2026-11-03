/**
 * Timetable → classroom course-work navigation.
 * Trust linkedCourseId only; otherwise carry a search query. Never writes links.
 *
 * Filter / query rules mirror apps/web/.../timetableCourseWorkHref.ts
 * (kept in sync; do not put this in packages/shared).
 */

export type TimetableClassroomDestination =
  | { kind: 'linked'; screen: 'CourseHub'; params: { courseId: string } }
  | {
      kind: 'search';
      screen: 'Classroom';
      params: { q?: string; from?: 'timetable'; code?: string };
    };

/** Build the classroom list search string from timetable course fields (name-primary). */
export function timetableCourseSearchQuery(input: {
  courseName: string;
  courseCode?: string | null;
}): string {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
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
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  const q = timetableCourseSearchQuery(input);
  if (!q) {
    // Match web: empty name → Classroom home without an empty q.
    return { kind: 'search', screen: 'Classroom', params: {} };
  }
  const params: { q: string; from: 'timetable'; code?: string } = {
    q,
    from: 'timetable',
  };
  if (name && code && !name.includes(code)) params.code = code.slice(0, 40);
  return { kind: 'search', screen: 'Classroom', params };
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
    nameKey = withoutCode.join(' ').trim() || key;
  } else if (tokens.length >= 2) {
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
