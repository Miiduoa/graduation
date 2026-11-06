import { searchNcnuCourseCatalog } from '@/lib/server/ncnuCourseCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  if (params.getAll('schoolId').length !== 1 || params.get('schoolId') !== 'ncnu') {
    return Response.json({ error: '這所學校尚未提供內建公開課程查詢。' }, { status: 400, headers });
  }
  if (params.getAll('q').length > 1 || query.length > 80) {
    return Response.json({ error: '搜尋內容請限制在 80 字以內。' }, { status: 400, headers });
  }
  try {
    return Response.json(await searchNcnuCourseCatalog(query), { headers });
  } catch {
    return Response.json({ error: '暫時無法讀取暨南大學課程資料，請稍後再試。' }, { status: 502, headers });
  }
}
