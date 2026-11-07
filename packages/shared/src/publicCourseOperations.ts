export type PublicCourseOperationId = 'ncnu.courses.search' | 'nthu.courses.search';
export type PublicCourseOperationSchoolId = 'ncnu' | 'nthu';
const QUERY_MAX_LENGTH = 80;

export type PublicCourseOperationReceipt = Readonly<{
  id: PublicCourseOperationId;
  access: 'anonymous-public';
}> &
  (
    | Readonly<{ version: 1; responseSchemaVersion: 1 }>
    | Readonly<{ version: 2; responseSchemaVersion: 2 }>
  );

export type PublicCourseOperation = PublicCourseOperationReceipt &
  Readonly<{
    schoolId: PublicCourseOperationSchoolId;
    label: string;
    description: string;
    sourceUrl: string;
    upstreamUrl: string;
    inputSchema: Readonly<{
      type: 'object';
      properties: Readonly<{
        query: Readonly<{ type: 'string'; maxLength: 80 }>;
        weekday?: Readonly<{ type: 'integer'; minimum: 1; maximum: 7 }>;
        credits?: Readonly<{ type: 'number'; minimum: 0; maximum: 40; multipleOf: 0.01 }>;
      }>;
      additionalProperties: false;
      anyOf?: readonly Readonly<{ required: readonly ('weekday' | 'credits')[] }>[];
    }>;
    endpoint: Readonly<{
      method: 'GET';
      path: '/api/public-course-catalog';
      fixedQuery: Readonly<{ schoolId: PublicCourseOperationSchoolId }>;
      inputQuery: Readonly<{ query: 'q'; weekday?: 'weekday'; credits?: 'credits' }>;
    }>;
  }>;

const inputSchema: PublicCourseOperation['inputSchema'] = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    query: Object.freeze({ type: 'string', maxLength: QUERY_MAX_LENGTH }),
  }),
  additionalProperties: false,
});

const filteredInputSchema: PublicCourseOperation['inputSchema'] = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    query: inputSchema.properties.query,
    weekday: Object.freeze({ type: 'integer', minimum: 1, maximum: 7 }),
    credits: Object.freeze({ type: 'number', minimum: 0, maximum: 40, multipleOf: 0.01 }),
  }),
  additionalProperties: false,
  // A q-only HTTP request remains v1 for installed clients. Every v2 call must
  // include at least one filter so discovery describes an executable request.
  anyOf: Object.freeze([
    Object.freeze({ required: Object.freeze(['weekday'] as const) }),
    Object.freeze({ required: Object.freeze(['credits'] as const) }),
  ]),
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
  version: 1 | 2 = 1,
): PublicCourseOperation {
  const receipt =
    version === 2
      ? { version: 2 as const, responseSchemaVersion: 2 as const }
      : { version: 1 as const, responseSchemaVersion: 1 as const };
  return Object.freeze({
    ...details,
    ...receipt,
    access: 'anonymous-public',
    description:
      version === 1
        ? '查詢校方本學期公開開課資料；不代表個人修課、選課結果或已取得學分。'
        : '依關鍵字、當天有課或精確學分搜尋公開課程；完整資料先篩選再取前 50 筆，資料不足另計，不代表不衝堂或正式選課。',
    inputSchema: version === 1 ? inputSchema : filteredInputSchema,
    endpoint: Object.freeze({
      method: 'GET',
      path: '/api/public-course-catalog',
      fixedQuery: Object.freeze({ schoolId: details.schoolId }),
      inputQuery:
        version === 1
          ? Object.freeze({ query: 'q' })
          : Object.freeze({ query: 'q', weekday: 'weekday', credits: 'credits' }),
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

const filteredOperations: readonly PublicCourseOperation[] = Object.freeze(
  operations.map(({ id, schoolId, label, sourceUrl, upstreamUrl }) =>
    defineOperation({ id, schoolId, label, sourceUrl, upstreamUrl }, 2),
  ),
);

export function resolvePublicCourseOperation(
  schoolId: string | null | undefined,
  version = 1,
): PublicCourseOperation | null {
  return (
    listPublicCourseOperations(version).find((operation) => operation.schoolId === schoolId) ?? null
  );
}

export function getPublicCourseOperation(
  operationId: string | null | undefined,
  version = 1,
): PublicCourseOperation | null {
  return (
    listPublicCourseOperations(version).find((operation) => operation.id === operationId) ?? null
  );
}

export function listPublicCourseOperations(version = 1): readonly PublicCourseOperation[] {
  return version === 1 ? operations : version === 2 ? filteredOperations : [];
}
