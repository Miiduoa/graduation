import {
  isPublicCourseOperationQuery,
  resolvePublicCourseOperation,
} from '@campus/shared/src/publicCourseOperations';
import {
  executePublicCourseOperation,
  PublicCourseOperationError,
} from '@/lib/server/publicCourseOperations';
import {
  hasPublicCourseFilters,
  parsePublicCourseFilterParams,
} from '@campus/shared/src/publicCourseFilters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schoolId = params.get('schoolId');
  const query = params.get('q') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  if (params.getAll('schoolId').length !== 1 || !resolvePublicCourseOperation(schoolId)) {
    return Response.json({ error: '這所學校尚未提供內建公開課程查詢。' }, { status: 400, headers });
  }
  if (params.getAll('q').length > 1 || !isPublicCourseOperationQuery(query)) {
    return Response.json({ error: '搜尋內容請限制在 80 字以內。' }, { status: 400, headers });
  }
  // Legacy React Native fetch adds `_` for cache: 'no-store'; ignore it as transport metadata.
  if ([...params.keys()].some((key) => !['schoolId', 'q', 'weekday', 'credits', '_'].includes(key))) {
    return Response.json({ error: '課程查詢只接受學校、搜尋內容、星期與學分。' }, { status: 400, headers });
  }
  const filters = parsePublicCourseFilterParams(params);
  if (!filters) {
    return Response.json({ error: '星期須為 1 至 7；學分須為 0 至 40，最多兩位小數，且條件不能重複。' }, { status: 400, headers });
  }
  // Existing clients keep the exact v1 response for their q-only requests.
  const version = hasPublicCourseFilters(filters) ? 2 : 1;
  const operation = resolvePublicCourseOperation(schoolId, version)!;
  try {
    const result = await executePublicCourseOperation(operation.id, { query, ...filters }, version);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof PublicCourseOperationError && error.kind === 'input') {
      return Response.json({ error: '課程查詢參數不正確，請重新輸入。' }, { status: 400, headers });
    }
    const schoolName = schoolId === 'nthu' ? '清華大學' : '暨南大學';
    return Response.json(
      { error: `暫時無法讀取${schoolName}課程資料，請稍後再試。` },
      { status: 502, headers },
    );
  }
}
