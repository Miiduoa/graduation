import {
  getPublicCourseOperation,
  isPublicCourseOperationQuery,
  type PublicCourseOperationReceipt,
} from '@campus/shared/src/publicCourseOperations';
import {
  isPublicCourseCatalog,
  type PublicCourseCatalogResponse,
} from '@campus/shared/src/publicCourseCatalog';
import { searchNcnuCourseCatalog } from './ncnuCourseCatalog';
import { searchNthuCourseCatalog } from './nthuCourseCatalog';

export class PublicCourseOperationError extends Error {
  constructor(public readonly kind: 'input' | 'upstream') {
    super(
      kind === 'input'
        ? 'Invalid public course operation or input'
        : 'Public course source unavailable',
    );
    this.name = 'PublicCourseOperationError';
  }
}

export type PublicCourseOperationResult = PublicCourseCatalogResponse & {
  fetchedAt: string;
  operation: PublicCourseOperationReceipt;
};

function readQuery(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PublicCourseOperationError('input');
  }
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(input).some((key) => key !== 'query')
  ) {
    throw new PublicCourseOperationError('input');
  }
  const query = Object.getOwnPropertyDescriptor(input, 'query');
  if (!query) return '';
  // Descriptors avoid executing accessors supplied by an internal caller.
  if (!('value' in query) || !isPublicCourseOperationQuery(query.value)) {
    throw new PublicCourseOperationError('input');
  }
  return query.value;
}

/** Dispatch a reviewed read, never a caller-supplied URL, header or script. */
export async function executePublicCourseOperation(
  operationId: string,
  input: unknown,
): Promise<PublicCourseOperationResult> {
  const operation = getPublicCourseOperation(operationId);
  if (!operation) throw new PublicCourseOperationError('input');
  const query = readQuery(input);

  try {
    const result =
      operation.schoolId === 'ncnu'
        ? await searchNcnuCourseCatalog(query)
        : await searchNthuCourseCatalog(query);
    if (
      !isPublicCourseCatalog(result, operation.schoolId) ||
      typeof result.fetchedAt !== 'string'
    ) {
      throw new PublicCourseOperationError('upstream');
    }
    // Copy the public contract instead of sharing raw provider responses.
    return {
      schoolId: operation.schoolId,
      sourceUrl: operation.sourceUrl,
      fetchedAt: result.fetchedAt,
      truncated: result.truncated,
      courses: result.courses.map((course) => ({
        code: course.code,
        section: course.section,
        title: course.title,
        department: course.department,
        teacher: course.teacher,
        time: course.time,
        room: course.room,
        semester: course.semester,
        credits: course.credits,
        ...(course.meetings === undefined
          ? {}
          : {
              meetings: course.meetings.map((meeting) => ({
                time: meeting.time,
                room: meeting.room,
              })),
            }),
      })),
      operation: {
        id: operation.id,
        version: operation.version,
        responseSchemaVersion: operation.responseSchemaVersion,
        access: operation.access,
      },
    };
  } catch {
    // Upstream errors may contain request details; callers only need the category.
    throw new PublicCourseOperationError('upstream');
  }
}
