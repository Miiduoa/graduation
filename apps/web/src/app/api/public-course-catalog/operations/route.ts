import { listPublicCourseOperations } from '@campus/shared/src/publicCourseOperations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const version = params.get('version') ?? '1';
  const headers = { 'Cache-Control': 'no-store' };
  if (params.getAll('version').length > 1 ||
      [...params.keys()].some((key) => key !== 'version') ||
      (version !== '1' && version !== '2')) {
    return Response.json({ error: '公開查課操作目錄只接受單一版本 1 或 2。' }, { status: 400, headers });
  }
  return Response.json(
    { schemaVersion: 1, operations: listPublicCourseOperations(Number(version)) },
    { headers },
  );
}
