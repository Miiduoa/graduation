import {
  resolvePublicCourseOperation,
  type PublicCourseOperationReceipt,
} from './publicCourseOperations';
import {
  evaluatePublicCourseFilters,
  hasPublicCourseFilters,
  parsePublicCourseFilters,
  type PublicCourseFilters,
} from './publicCourseFilters';

export type PublicCatalogMeeting = { time: string; room: string };

/** Fields from a public course listing. Codes retain leading zeroes and internal spaces. */
export type PublicCatalogCourse = {
  code: string;
  section: string;
  title: string;
  department: string;
  teacher: string;
  time: string;
  room: string;
  semester: string;
  credits: string;
  /** Each entry preserves one official room/time pair, including an unpublished time. */
  meetings?: PublicCatalogMeeting[];
};

export type PublicCourseCatalogResponse = {
  schoolId: 'ncnu' | 'nthu';
  sourceUrl: string;
  /** UTC time when the server successfully fetched the official feed; not the school's publication time. */
  fetchedAt?: string;
  /** Added by the reviewed operation dispatcher. Older servers may omit this receipt. */
  operation?: PublicCourseOperationReceipt;
  /** Present only on a v2 filtered response, so older servers cannot silently drop conditions. */
  filters?: PublicCourseFilters;
  /** Keyword matches with no known mismatch but insufficient data for an active filter. */
  unresolvedCount?: number;
  courses: PublicCatalogCourse[];
  truncated: boolean;
};

/** Taiwan time is UTC+8 year-round; avoid depending on device Intl support. */
export function formatPublicCatalogFetchedAt(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== iso) return null;
  return new Date(timestamp + 8 * 60 * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function isPublicCourseCatalog(
  value: unknown,
  expectedSchoolId: PublicCourseCatalogResponse['schoolId'],
  expectedFilters?: PublicCourseFilters,
): value is PublicCourseCatalogResponse {
  if (!value || typeof value !== 'object') return false;
  if (expectedSchoolId !== 'ncnu' && expectedSchoolId !== 'nthu') return false;
  const filters = parsePublicCourseFilters(expectedFilters ?? {});
  if (!filters) return false;
  const filtered = hasPublicCourseFilters(filters);
  const operation = resolvePublicCourseOperation(expectedSchoolId, filtered ? 2 : 1);
  if (!operation) return false;
  const data = value as Partial<PublicCourseCatalogResponse>;
  if (filtered) {
    const applied = parsePublicCourseFilters(data.filters);
    if (
      !data.operation ||
      !applied ||
      applied.weekday !== filters.weekday ||
      applied.credits !== filters.credits ||
      typeof data.unresolvedCount !== 'number' ||
      !Number.isSafeInteger(data.unresolvedCount) ||
      data.unresolvedCount < 0 ||
      data.unresolvedCount > 20_000
    )
      return false;
  } else if (data.filters !== undefined || data.unresolvedCount !== undefined) {
    return false;
  }
  if (data.operation !== undefined) {
    const receipt = data.operation;
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      Array.isArray(receipt) ||
      Object.keys(receipt).length !== 4 ||
      receipt.id !== operation.id ||
      receipt.version !== operation.version ||
      receipt.responseSchemaVersion !== operation.responseSchemaVersion ||
      receipt.access !== operation.access ||
      typeof data.fetchedAt !== 'string'
    )
      return false;
  }
  const valid =
    data.schoolId === expectedSchoolId &&
    data.sourceUrl === operation.sourceUrl &&
    typeof data.truncated === 'boolean' &&
    (data.fetchedAt === undefined ||
      (typeof data.fetchedAt === 'string' &&
        formatPublicCatalogFetchedAt(data.fetchedAt) !== null)) &&
    Array.isArray(data.courses) &&
    data.courses.length <= 50 &&
    data.courses.every(
      (row) =>
        row &&
        [
          'code',
          'section',
          'title',
          'department',
          'teacher',
          'time',
          'room',
          'semester',
          'credits',
        ].every((field) => typeof row[field as keyof PublicCatalogCourse] === 'string') &&
        row.code.trim() &&
        row.title.trim() &&
        row.semester.trim() &&
        (row.meetings === undefined ||
          (Array.isArray(row.meetings) &&
            row.meetings.length <= 32 &&
            row.meetings.every(
              (meeting) =>
                meeting && typeof meeting.time === 'string' && typeof meeting.room === 'string',
            ))),
    );
  if (!valid) return false;
  return (
    !filtered ||
    data.courses!.every(
      (course) => evaluatePublicCourseFilters(course, expectedSchoolId, filters) === 'match',
    )
  );
}

export function isNcnuPublicCourseCatalog(value: unknown): value is PublicCourseCatalogResponse {
  return isPublicCourseCatalog(value, 'ncnu');
}
