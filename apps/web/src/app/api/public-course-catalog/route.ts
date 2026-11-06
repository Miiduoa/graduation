import { searchNcnuCourseCatalog } from '@/lib/server/ncnuCourseCatalog';
import { searchNthuCourseCatalog } from '@/lib/server/nthuCourseCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schoolId = params.get('schoolId');
  const query = params.get('q') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  if (params.getAll('schoolId').length !== 1 || (schoolId !== 'ncnu' && schoolId !== 'nthu')) {
    return Response.json({ error: '這所學校尚未提供內建公開課程查詢。' }, { status: 400, headers });
  }
  if (params.getAll('q').length > 1 || query.length > 80) {
    return Response.json({ error: '搜尋內容請限制在 80 字以內。' }, { status: 400, headers });
  }
  try {
    const result = schoolId === 'nthu' ? await searchNthuCourseCatalog(query) : await searchNcnuCourseCatalog(query);
    return Response.json(result, { headers });
  } catch {
    const schoolName = schoolId === 'nthu' ? '清華大學' : '暨南大學';
    return Response.json({ error: `暫時無法讀取${schoolName}課程資料，請稍後再試。` }, { status: 502, headers });
  }
}
