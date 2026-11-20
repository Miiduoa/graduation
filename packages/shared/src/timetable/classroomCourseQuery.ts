/**
 * Pure helpers for timetable → classroom course search.
 * Web and mobile share the same query / match rules; destinations stay app-local.
 */

export function courseSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}

/** Build the classroom list search string from timetable course fields (name-primary). */
export function timetableCourseSearchQuery(input: {
  courseName: string;
  courseCode?: string | null;
}): string {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  return (name || code).slice(0, 120);
}

/**
 * Search params for an unlinked timetable → classroom landing.
 * Empty when there is no usable query (blank name and code).
 */
export function timetableClassroomSearchParams(input: {
  courseName: string;
  courseCode?: string | null;
}): { q: string; from: 'timetable'; code?: string } | Record<string, never> {
  const name = input.courseName.trim();
  const code = (input.courseCode ?? '').trim();
  const q = timetableCourseSearchQuery(input);
  if (!q) return {};
  const params: { q: string; from: 'timetable'; code?: string } = {
    q,
    from: 'timetable',
  };
  if (name && code && !name.includes(code)) params.code = code.slice(0, 40);
  return params;
}

export type ClassroomQueryFilterOptions = {
  /** Timetable exit: name-primary; course code is OR / bonus narrowing. */
  fromTimetable?: boolean;
  /** Only an explicit code param participates in code matching — never the last token of q. */
  courseCode?: string | null;
};

function courseFieldCode(course: { code?: string | null }): string {
  return courseSearchKey(course.code ?? '');
}

/**
 * Match classroom courses against q.
 * - Manual (default): whole-string substring on title (main semantics).
 * - Timetable: primary match on course name; only options.courseCode counts as
 *   OR / bonus narrowing (title or code field). Multi-word names without code
 *   must not treat the last token as a course code.
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
  const codeKey = explicitCode;

  if (explicitCode) {
    const withoutCode = tokens.filter((token) => token !== explicitCode);
    nameKey = withoutCode.join(' ').trim() || key;
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
