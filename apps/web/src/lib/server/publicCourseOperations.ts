import {
  getPublicCourseOperation,
  isPublicCourseOperationQuery,
  type PublicCourseOperationReceipt,
} from '@campus/shared/src/publicCourseOperations';
import {
  isPublicCourseCatalog,
  type PublicCourseCatalogResponse,
} from '@campus/shared/src/publicCourseCatalog';
import {
  hasPublicCourseFilters,
  parsePublicCourseFilters,
  type PublicCourseFilters,
} from '@campus/shared/src/publicCourseFilters';
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

function readInput(input: unknown, version: number): { query: string; filters: PublicCourseFilters } {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PublicCourseOperationError('input');
    }
    const prototype = Object.getPrototypeOf(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(input).some((key) => key !== 'query' &&
        (version !== 2 || (key !== 'weekday' && key !== 'credits')))
    ) {
      throw new PublicCourseOperationError('input');
    }
    const query = Object.getOwnPropertyDescriptor(input, 'query');
    // Descriptors avoid executing accessors supplied by an internal caller.
    if (query && (!('value' in query) || !isPublicCourseOperationQuery(query.value))) {
      throw new PublicCourseOperationError('input');
    }
    const filterInput: PublicCourseFilters = {};
    for (const key of ['weekday', 'credits'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!('value' in descriptor)) throw new PublicCourseOperationError('input');
      filterInput[key] = descriptor.value;
    }
    const filters = parsePublicCourseFilters(filterInput);
    if (!filters || (version === 2 && !hasPublicCourseFilters(filters))) {
      throw new PublicCourseOperationError('input');
    }
    return { query: query?.value ?? '', filters };
  } catch {
    throw new PublicCourseOperationError('input');
  }
}

/** Dispatch a reviewed read, never a caller-supplied URL, header or script. */
export async function executePublicCourseOperation(
  operationId: string,
  input: unknown,
  version = 1,
): Promise<PublicCourseOperationResult> {
  const operation = getPublicCourseOperation(operationId, version);
  if (!operation) throw new PublicCourseOperationError('input');
  const { query, filters } = readInput(input, operation.version);

  try {
    const search = operation.schoolId === 'ncnu' ? searchNcnuCourseCatalog : searchNthuCourseCatalog;
    const result = operation.version === 2 ? await search(query, filters) : await search(query);
    const base = operation.version === 2 ? {
      schoolId: result.schoolId,
      sourceUrl: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      courses: result.courses,
      truncated: result.truncated,
    } : result;
    if (
      !isPublicCourseCatalog(base, operation.schoolId) ||
      typeof result.fetchedAt !== 'string'
    ) {
      throw new PublicCourseOperationError('upstream');
    }
    // Copy the public contract instead of sharing raw provider responses.
    const projected: PublicCourseOperationResult = {
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
        access: operation.access,
        ...(operation.version === 2
          ? { version: 2 as const, responseSchemaVersion: 2 as const }
          : { version: 1 as const, responseSchemaVersion: 1 as const }),
      },
      ...(operation.version === 2
        ? { filters: result.filters, unresolvedCount: result.unresolvedCount }
        : {}),
    };
    // Verify the provider's filter receipt and every returned course before
    // copying canonical metadata. Never label an unfiltered result as filtered.
    if (!isPublicCourseCatalog(projected, operation.schoolId, filters)) {
      throw new PublicCourseOperationError('upstream');
    }
    return operation.version === 2 ? { ...projected, filters: { ...filters } } : projected;
  } catch {
    // Upstream errors may contain request details; callers only need the category.
    throw new PublicCourseOperationError('upstream');
  }
}
