import {
  isPublicCourseOperationQuery,
  resolvePublicCourseOperation,
} from '@campus/shared/src/publicCourseOperations';
import {
  executePublicCourseOperation,
  PublicCourseOperationError,
} from '@/lib/server/publicCourseOperations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schoolId = params.get('schoolId');
  const query = params.get('q') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  const operation = resolvePublicCourseOperation(schoolId);
  if (params.getAll('schoolId').length !== 1 || !operation) {
    return Response.json({ error: '這所學校尚未提供內建公開課程查詢。' }, { status: 400, headers });
  }
  if (params.getAll('q').length > 1 || !isPublicCourseOperationQuery(query)) {
    return Response.json({ error: '搜尋內容請限制在 80 字以內。' }, { status: 400, headers });
  }
  if ([...params.keys()].some((key) => key !== 'schoolId' && key !== 'q')) {
    return Response.json({ error: '課程查詢只接受學校與搜尋內容。' }, { status: 400, headers });
  }
  try {
    const result = await executePublicCourseOperation(operation.id, { query });
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
