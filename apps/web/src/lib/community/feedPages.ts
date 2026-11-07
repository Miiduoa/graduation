import {
  collection,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { CampusPostDoc } from './firestore';

export const CAMPUS_FEED_PAGE_SIZE = 60;

/** Locate the last millisecond of a Taiwan calendar day without relying on device timezone. */
export function taiwanFeedDayEnd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day)
    return null;
  return new Date(value + 'T23:59:59.999+08:00');
}


/** Keep the server snapshot, including the document ID tie-breaker, in this feed session. */
export type CampusPostCursor = Readonly<{
  schoolId: string;
  document: QueryDocumentSnapshot<DocumentData>;
  beforeMillis?: number | null;
}>;

export type CampusPostPage = {
  posts: CampusPostDoc[];
  nextCursor: CampusPostCursor | null;
  hasMore: boolean;
};

/** One authorized page, never a growing window or a cache fallback. */
export async function fetchCampusPostPage(
  schoolId: string,
  cursor: CampusPostCursor | null = null,
  before: Date | null = null,
): Promise<CampusPostPage> {
  if (!schoolId || schoolId.includes('/')) {
    throw Object.assign(new Error('Invalid campus feed scope'), { code: 'invalid-argument' });
  }
  const beforeMillis = before === null ? null : before.getTime();
  if (before !== null && !Number.isFinite(beforeMillis)) {
    throw Object.assign(new Error('Invalid campus feed date'), { code: 'invalid-argument' });
  }
  const path = `schools/${schoolId}/campusPosts`;
  if (cursor && (
    cursor.schoolId !== schoolId ||
    cursor.document.ref.parent.path !== path ||
    (cursor.beforeMillis ?? null) !== beforeMillis
  )) {
    throw Object.assign(new Error('The feed cursor belongs to another school'), {
      code: 'invalid-argument',
    });
  }

  const snapshot = await getDocsFromServer(query(
    collection(getDb(), path),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor.document)] : before ? [startAt(Timestamp.fromDate(before))] : []),
    limit(CAMPUS_FEED_PAGE_SIZE),
  ));
  // Server reads can still include this client's pending local writes. Do not
  // turn an unacknowledged timestamp into the boundary for the next page.
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw Object.assign(new Error('The campus feed is not confirmed by the server yet'), {
      code: 'unavailable',
    });
  }
  const last = snapshot.docs.at(-1);
  return {
    posts: snapshot.docs
      .map((document) => ({
        ...(document.data() as Omit<CampusPostDoc, 'id'>),
        id: document.id,
      }))
      .filter((post) => post.schoolId === schoolId),
    // Use the raw ordered boundary, not a filtered or recommendation-ranked row.
    nextCursor: last ? { schoolId, document: last, beforeMillis } : null,
    // An exact full page may need one final empty request. No paid lookahead.
    hasMore: snapshot.docs.length === CAMPUS_FEED_PAGE_SIZE,
  };
}
