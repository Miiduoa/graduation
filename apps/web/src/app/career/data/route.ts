import { careerIsPu } from '@campus/shared/src/career';
import { getFirebaseAdmin } from '@/lib/server/firebaseAdmin';
import { createCareerSourceFeed } from '@/lib/server/careerSourceFeed';
import { loadCareerFeed } from './adapters';
import { createCareerFeedCache } from './feedCache';

export const runtime = 'nodejs';
const cachedFeed = createCareerFeedCache(loadCareerFeed);
export async function GET(request: Request) {
  const school = new URL(request.url).searchParams.get('school') ?? '';
  const headers = {
    'Cache-Control': 'public, max-age=30, s-maxage=30',
    'Access-Control-Allow-Origin': '*',
  };
  if (!careerIsPu(school)) return Response.json(await cachedFeed(school), { headers });
  try {
    const admin = await getFirebaseAdmin();
    if (admin) {
      // Keep the upstream cache independent of source choices, so saved settings
      // apply on the next public read even when upstream data is cached.
      const feed = await createCareerSourceFeed({ db: admin.db, loadFeed: cachedFeed })('pu');
      return Response.json(feed, { headers });
    }
  } catch {
    // A settings read failure must not silently re-enable a disabled source.
  }
  return Response.json(
    { error: '暫時無法讀取職涯資料來源設定，請稍後再試。' },
    { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } },
  );
}
