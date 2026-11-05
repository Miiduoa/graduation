import { taipeiParts } from '@campus/shared/src/taipeiTime';
import type { AssignmentDeadlineWindow } from './assignmentDeadlineWindow';
import type { CampusSenseSnapshot } from './campusSenseSnapshot';
import { confirmedTimestamp, taipeiDayNumber } from './campusStudyAgenda';

// Some publishers supply only a calendar date, normalized to an ISO instant by ingestion.
export function formatSyncedAnnouncementDate(publishedAt: string | null): string {
  const parts = taipeiParts(confirmedTimestamp(publishedAt));
  return parts ? `${parts.year}/${parts.month}/${parts.day}` : '';
}

type Announcements = CampusSenseSnapshot['announcements']['items'];

/** A publication window applies to verified timestamps in the observed snapshot. */
export function querySyncedAnnouncements(
  items: Announcements, window: AssignmentDeadlineWindow | null, checkedAt: string,
): { items: Announcements; undatedCount: number } {
  const observedAt = Date.parse(checkedAt);
  const dated: { item: Announcements[number]; timestamp: number }[] = [];
  const undated: Announcements = [];
  for (const item of items) {
    const timestamp = confirmedTimestamp(item.publishedAt);
    if (!Number.isFinite(timestamp)) {
      undated.push(item.publishedAt === null ? item : { ...item, publishedAt: null });
      continue;
    }
    if (timestamp > observedAt) continue;
    if (window) {
      const day = taipeiDayNumber(timestamp);
      if (day < window.startDay || day >= window.endDay) continue;
    }
    dated.push({ item, timestamp });
  }
  dated.sort((a, b) => b.timestamp - a.timestamp);
  return {
    items: dated.map(({ item }) => item).concat(window ? [] : undated),
    undatedCount: undated.length,
  };
}
