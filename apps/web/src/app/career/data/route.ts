import { loadCareerFeed } from './adapters';
import { createCareerFeedCache } from './feedCache';
const cachedFeed = createCareerFeedCache(loadCareerFeed);
export async function GET(request: Request) {
  const school = new URL(request.url).searchParams.get('school') ?? '';
  const feed = await cachedFeed(school);
  return Response.json(feed, {
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
