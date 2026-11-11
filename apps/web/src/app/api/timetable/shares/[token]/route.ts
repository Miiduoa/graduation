import { getFirebaseAdmin } from '@/lib/server/firebaseAdmin';
import { readPublicTimetableShare } from '@campus/shared/src/timetable/publicShare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const admin = await getFirebaseAdmin();
    if (admin) {
      const { body, status } = await readPublicTimetableShare(admin.db, token);
      return Response.json(body, { status, headers });
    }
  } catch {
    // Never expose the document or Firestore errors through the public read route.
  }
  return Response.json({ code: 'unconfigured' }, { status: 503, headers });
}
