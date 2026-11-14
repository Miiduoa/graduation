import { careerIsPu, emptyCareerFeed, type CareerFeed } from '@campus/shared/src/career';
/** Process-local, bounded upstream protection. Unsupported schools never allocate cache entries. */
export function createCareerFeedCache(load: () => Promise<CareerFeed>, now = Date.now) {
  let cached: { feed: CareerFeed; until: number } | undefined;
  let pending: Promise<CareerFeed> | undefined;
  let windowStart = 0;
  let attempts = 0;
  return async (school: string): Promise<CareerFeed> => {
    if (!careerIsPu(school)) return emptyCareerFeed(false);
    const at = now();
    if (cached && at < cached.until) return cached.feed;
    if (pending) return pending;
    if (at - windowStart >= 60000) {
      windowStart = at;
      attempts = 0;
    }
    if (++attempts > 10) return cached?.feed ?? emptyCareerFeed();
    pending = load()
      .then((feed) => {
        cached = { feed, until: now() + 30000 };
        return feed;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
