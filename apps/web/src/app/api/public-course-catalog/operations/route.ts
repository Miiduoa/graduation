import { listPublicCourseOperations } from '@campus/shared/src/publicCourseOperations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { schemaVersion: 1, operations: listPublicCourseOperations() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
