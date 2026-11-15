/** Approval-isolated source policy. The existing public /career/data route does not import this. */
import type { Firestore } from 'firebase-admin/firestore';
import { careerTimeline, type CareerFeed } from '@campus/shared/src/career';
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
export function createCareerSourceFeed({
  db,
  loadFeed,
}: {
  db: Firestore;
  loadFeed: (schoolId: string) => Promise<CareerFeed>;
}) {
  return async (schoolId: string) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(schoolId)) throw new Error('學校編號不正確。');
    const [feed, settings] = await Promise.all([
      loadFeed(schoolId),
      db.doc(`schools/${schoolId}/settings/careerSources`).get(),
    ]);
    const configured = settings.data();
    const sources: CareerSources = {
      office: configured?.office !== false,
      departments: configured?.departments !== false,
      taiwanjobs: configured?.taiwanjobs !== false,
      revision: Number(configured?.revision) || 0,
    };
    return filterCareerSources(feed, sources);
  };
}
