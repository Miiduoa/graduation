export type PublicCourseOperationId = 'ncnu.courses.search' | 'nthu.courses.search';
export type PublicCourseOperationSchoolId = 'ncnu' | 'nthu';
const QUERY_MAX_LENGTH = 80;

export type PublicCourseOperationReceipt = Readonly<{
  id: PublicCourseOperationId;
  version: 1;
  responseSchemaVersion: 1;
  access: 'anonymous-public';
}>;

export type PublicCourseOperation = PublicCourseOperationReceipt &
  Readonly<{
    schoolId: PublicCourseOperationSchoolId;
    label: string;
    description: string;
    sourceUrl: string;
    upstreamUrl: string;
    inputSchema: Readonly<{
      type: 'object';
      properties: Readonly<{ query: Readonly<{ type: 'string'; maxLength: 80 }> }>;
      additionalProperties: false;
    }>;
    endpoint: Readonly<{
      method: 'GET';
      path: '/api/public-course-catalog';
      fixedQuery: Readonly<{ schoolId: PublicCourseOperationSchoolId }>;
      inputQuery: Readonly<{ query: 'q' }>;
    }>;
  }>;

const inputSchema: PublicCourseOperation['inputSchema'] = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    query: Object.freeze({ type: 'string', maxLength: QUERY_MAX_LENGTH }),
  }),
  additionalProperties: false,
});

/** JSON Schema counts Unicode code points, including names outside the BMP. */
export function isPublicCourseOperationQuery(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= QUERY_MAX_LENGTH * 2 &&
    Array.from(value).length <= QUERY_MAX_LENGTH
  );
}

function defineOperation(
  details: Pick<PublicCourseOperation, 'id' | 'schoolId' | 'label' | 'sourceUrl' | 'upstreamUrl'>,
): PublicCourseOperation {
  return Object.freeze({
    ...details,
    version: 1,
    responseSchemaVersion: 1,
    access: 'anonymous-public',
    description: '查詢校方本學期公開開課資料；不代表個人修課、選課結果或已取得學分。',
    inputSchema,
    endpoint: Object.freeze({
      method: 'GET',
      path: '/api/public-course-catalog',
      fixedQuery: Object.freeze({ schoolId: details.schoolId }),
      inputQuery: Object.freeze({ query: 'q' }),
    }),
  });
}

// Only reviewed public feeds belong here. A learned request is not executable
// configuration; adding a source requires its own parser and contract review.
const operations: readonly PublicCourseOperation[] = Object.freeze([
  defineOperation({
    id: 'ncnu.courses.search',
    schoolId: 'ncnu',
    label: '暨南大學本學期開設課程',
    sourceUrl:
      'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
    upstreamUrl:
      'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?export=csv',
  }),
  defineOperation({
    id: 'nthu.courses.search',
    schoolId: 'nthu',
    label: '清華大學公開開課查詢',
    sourceUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
    upstreamUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
  }),
]);

export function resolvePublicCourseOperation(
  schoolId: string | null | undefined,
): PublicCourseOperation | null {
  return operations.find((operation) => operation.schoolId === schoolId) ?? null;
}

export function getPublicCourseOperation(
  operationId: string | null | undefined,
): PublicCourseOperation | null {
  return operations.find((operation) => operation.id === operationId) ?? null;
}

export function listPublicCourseOperations(): readonly PublicCourseOperation[] {
  return operations;
}
