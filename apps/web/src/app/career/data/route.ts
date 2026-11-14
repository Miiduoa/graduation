import { careerIsPu, emptyCareerFeed } from '@campus/shared/src/career';
import { loadCareerFeed } from './adapters';
export async function GET(request: Request) {
  const school = new URL(request.url).searchParams.get('school') ?? '';
  const feed = careerIsPu(school) ? await loadCareerFeed() : emptyCareerFeed(false);
  return Response.json(feed, {
    headers: {
      'Cache-Control':
        feed.announcementsUnavailable || feed.jobsUnavailable
          ? 'public, max-age=30, s-maxage=60'
          : 'public, max-age=60, s-maxage=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
