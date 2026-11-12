import type { PublicCatalogCourse } from './publicCourseCatalog';
import type { PublicCourseOperationSchoolId } from './publicCourseOperations';
import { ncnuCourseMeetings } from './ncnuCourseSchedule';
import { nthuCourseMeetings } from './nthuCourseSchedule';

/** A weekday means at least one meeting that day, not that all meetings are on that day. */
export type PublicCourseFilters = { weekday?: number; credits?: number };
export type PublicCourseFilterMatch = 'match' | 'exclude' | 'unresolved';

/** Accept data properties only; do not evaluate getters from an internal caller. */
export function parsePublicCourseFilters(value: unknown): PublicCourseFilters | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const filters: PublicCourseFilters = {};
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'weekday' && key !== 'credits') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return null;
      const number: unknown = descriptor.value;
      if (typeof number !== 'number' || !Number.isFinite(number)) return null;
      if (key === 'weekday') {
        if (!Number.isInteger(number) || number < 1 || number > 7) return null;
      } else if (number < 0 || number > 40 || Number(number.toFixed(2)) !== number) {
        return null;
      }
      filters[key] = number;
    }
    return filters;
  } catch {
    return null;
  }
}

export function hasPublicCourseFilters(filters?: PublicCourseFilters): boolean {
  return filters?.weekday !== undefined || filters?.credits !== undefined;
}

/** Only reads these filter keys; the enclosing route validates its other parameters. */
export function parsePublicCourseFilterParams(params: URLSearchParams): PublicCourseFilters | null {
  const filters: PublicCourseFilters = {};
  for (const key of ['weekday', 'credits'] as const) {
    const values = params.getAll(key);
    if (!values.length) continue;
    if (values.length !== 1) return null;
    const pattern = key === 'weekday' ? /^[1-7]$/ : /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/;
    if (!pattern.test(values[0])) return null;
    filters[key] = Number(values[0]);
  }
  return parsePublicCourseFilters(filters);
}

export function publicCourseFilterLabel(filters?: PublicCourseFilters): string {
  const labels: string[] = [];
  if (filters?.weekday !== undefined)
    labels.push(`星期${'一二三四五六日'[filters.weekday - 1]}有課`);
  if (filters?.credits !== undefined) labels.push(`${filters.credits} 學分`);
  return labels.join(' · ');
}

/** Unknown terms retain weekday codes; verified clock times are not needed for this filter. */
export function publicCourseWeekdays(
  course: PublicCatalogCourse,
  schoolId: PublicCourseOperationSchoolId,
): number[] | null {
  const meetings =
    schoolId === 'nthu'
      ? nthuCourseMeetings(course.meetings ?? [], course.semester)
      : schoolId === 'ncnu'
        ? ncnuCourseMeetings(course.time, course.semester)
        : null;
  if (!meetings?.length) return null;
  return [...new Set(meetings.map((meeting) => meeting.dayOfWeek))].sort((a, b) => a - b);
}

function courseCredits(course: PublicCatalogCourse): number | null {
  const text = course.credits.normalize('NFKC').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** A known mismatch excludes a course even when another requested field is unknown. */
export function evaluatePublicCourseFilters(
  course: PublicCatalogCourse,
  schoolId: PublicCourseOperationSchoolId,
  filters: PublicCourseFilters,
): PublicCourseFilterMatch {
  let unresolved = false;
  if (filters.credits !== undefined) {
    const credits = courseCredits(course);
    if (credits === null) unresolved = true;
    else if (credits !== filters.credits) return 'exclude';
  }
  if (filters.weekday !== undefined) {
    const weekdays = publicCourseWeekdays(course, schoolId);
    if (weekdays === null) unresolved = true;
    else if (!weekdays.includes(filters.weekday)) return 'exclude';
  }
  return unresolved ? 'unresolved' : 'match';
}
