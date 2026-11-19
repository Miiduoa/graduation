/** Read-only source policy shared by the public career route. */
import { careerIsPu, careerTimeline, type CareerFeed } from '@campus/shared/src/career';
import type { CareerSources } from '@campus/shared/src/careerWorkstudy';

export function filterCareerSources(feed: CareerFeed, sources: CareerSources): CareerFeed {
  const announcements = feed.announcements.filter((item) => {
    try {
      return new URL(item.url).hostname === 'cdif.pu.edu.tw' ? sources.office : sources.departments;
    } catch {
      return false;
    }
  });
  return {
    ...feed,
    announcements,
    timeline: careerTimeline(announcements),
    jobs: sources.taiwanjobs ? feed.jobs : [],
    jobsUnavailable: sources.taiwanjobs && feed.jobsUnavailable,
    announcementsUnavailable:
      (sources.office || sources.departments) && feed.announcementsUnavailable,
  };
}
/** One process-local PU policy snapshot; never fall back to default-enabled sources on failure. */
export function createCareerSourceFeed({
  loadSources,
  loadFeed,
  now = Date.now,
}: {
  loadSources: () => Promise<CareerSources>;
  loadFeed: (schoolId: string) => Promise<CareerFeed>;
  now?: () => number;
}) {
  let cached: { sources: CareerSources; at: number } | undefined;
  let pending: Promise<CareerSources> | undefined;
  let retryAt = 0;
  const settings = async () => {
    if (cached && now() - cached.at < 30000) return cached.sources;
    if (!pending && now() >= retryAt) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Bound the shared wait; late reads must not refresh or overwrite the cache.
      pending = Promise.race([
        Promise.resolve().then(loadSources),
        new Promise<CareerSources>((_, reject) => {
          timer = setTimeout(() => reject(new Error('career source settings timeout')), 5000);
        }),
      ])
        .then((sources) => {
          cached = { sources, at: now() };
          return sources;
        })
        .finally(() => {
          clearTimeout(timer);
          retryAt = now() + 30000;
          pending = undefined;
        });
    }
    try {
      if (pending) return await pending;
    } catch {
      // Brief outages may use only the last successfully read source choices.
    }
    if (cached && now() - cached.at < 300000) return cached.sources;
    throw new Error('career source settings unavailable');
  };
  return async (schoolId: string) => {
    if (!careerIsPu(schoolId)) throw new Error('學校編號不正確。');
    const sources = await settings();
    const feed = filterCareerSources(await loadFeed('pu'), sources);
    return { ...feed, sourceSettingsStale: !!cached && now() - cached.at >= 30000 };
  };
}
