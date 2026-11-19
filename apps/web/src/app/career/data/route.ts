import { careerIsPu } from '@campus/shared/src/career';
import { getFirebaseAdmin } from '@/lib/server/firebaseAdmin';
import { createCareerSourceFeed } from '@/lib/server/careerSourceFeed';
import { loadCareerFeed } from './adapters';
import { createCareerFeedCache } from './feedCache';

export const runtime = 'nodejs';
const cachedFeed = createCareerFeedCache(loadCareerFeed);
const sourceFeed = createCareerSourceFeed({
  loadFeed: cachedFeed,
  loadSources: async () => {
    const admin = await getFirebaseAdmin();
    if (!admin) throw new Error('career source settings unavailable');
    const configured = (await admin.db.doc('schools/pu/settings/careerSources').get()).data();
    return {
      office: configured?.office !== false,
      departments: configured?.departments !== false,
      taiwanjobs: configured?.taiwanjobs !== false,
      revision: Number(configured?.revision) || 0,
    };
  },
});
export async function GET(request: Request) {
  const school = new URL(request.url).searchParams.get('school') ?? '';
  const headers = {
    'Cache-Control': 'public, max-age=30, s-maxage=30',
    'Access-Control-Allow-Origin': '*',
  };
  if (!careerIsPu(school)) return Response.json(await cachedFeed(school), { headers });
  try {
    const feed = await sourceFeed('pu');
    return Response.json(feed, {
      headers: feed.sourceSettingsStale ? { ...headers, 'Cache-Control': 'no-store' } : headers,
    });
  } catch {
    // A settings read failure must not silently re-enable a disabled source.
  }
  return Response.json(
    { error: '暫時無法讀取職涯資料來源設定，請稍後再試。' },
    { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } },
  );
}
