import {
  collection,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { CampusPostDoc } from './firestore';

export const CAMPUS_FEED_PAGE_SIZE = 60;

/** Keep the server snapshot, including the document ID tie-breaker, in this feed session. */
export type CampusPostCursor = Readonly<{
  schoolId: string;
  document: QueryDocumentSnapshot<DocumentData>;
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
): Promise<CampusPostPage> {
  if (!schoolId || schoolId.includes('/')) {
    throw Object.assign(new Error('Invalid campus feed scope'), { code: 'invalid-argument' });
  }
  const path = `schools/${schoolId}/campusPosts`;
  if (cursor && (
    cursor.schoolId !== schoolId ||
    cursor.document.ref.parent.path !== path
  )) {
    throw Object.assign(new Error('The feed cursor belongs to another school'), {
      code: 'invalid-argument',
    });
  }

  const snapshot = await getDocsFromServer(query(
    collection(getDb(), path),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor.document)] : []),
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
    nextCursor: last ? { schoolId, document: last } : null,
    // An exact full page may need one final empty request. No paid lookahead.
    hasMore: snapshot.docs.length === CAMPUS_FEED_PAGE_SIZE,
  };
}
