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
import { getDb } from '../firebase';
import type { CampusPostDoc } from './feed';

export const CAMPUS_FEED_PAGE_SIZE = 60;

export type CampusPostCursor = Readonly<{
  schoolId: string;
  document: QueryDocumentSnapshot<DocumentData>;
}>;

export type CampusPostPage = {
  posts: CampusPostDoc[];
  nextCursor: CampusPostCursor | null;
  hasMore: boolean;
};

/** A school-scoped server page. Offline cache is never accepted as the next boundary. */
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
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw Object.assign(new Error('The feed read is not confirmed by the server'), {
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
    nextCursor: last ? { schoolId, document: last } : null,
    hasMore: snapshot.docs.length === CAMPUS_FEED_PAGE_SIZE,
  };
}
