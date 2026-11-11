import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { CampusPostDoc } from './firestore';

export const CREATOR_PAGE_SIZE = 18;
export type CreatorCursor = QueryDocumentSnapshot<DocumentData> | null;

export type CreatorIdentity = {
  displayName: string;
  avatarUrl: string | null;
};

function checkScope(schoolId: string, uid: string) {
  if (!schoolId || !uid || schoolId.includes('/') || uid.includes('/')) {
    throw new Error('Invalid campus profile scope');
  }
}

/** Only directory information is suitable for another member's profile. */
export async function readCreatorIdentity(
  schoolId: string,
  uid: string,
): Promise<CreatorIdentity | null> {
  checkScope(schoolId, uid);
  const snapshot = await getDocFromServer(doc(getDb(), 'schools', schoolId, 'directory', uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const displayName =
    typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '';
  const avatarUrl =
    typeof data.avatarUrl === 'string' && /^https:\/\//i.test(data.avatarUrl)
      ? data.avatarUrl
      : null;
  return { displayName, avatarUrl };
}

/**
 * A school-scoped, chronological profile feed.
 * Anonymous posts never acquire a public author through this read.
 */
export async function listCreatorPosts(
  schoolId: string,
  uid: string,
  cursor: CreatorCursor = null,
): Promise<{ posts: CampusPostDoc[]; cursor: CreatorCursor; hasMore: boolean }> {
  checkScope(schoolId, uid);
  const constraints: QueryConstraint[] = [
    where('authorUid', '==', uid),
    orderBy('createdAt', 'desc'),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(CREATOR_PAGE_SIZE + 1));
  const snapshot = await getDocs(
    query(collection(getDb(), 'schools', schoolId, 'campusPosts'), ...constraints),
  );
  const page = snapshot.docs.slice(0, CREATOR_PAGE_SIZE);
  const posts = page
    .map((item) => ({ id: item.id, ...item.data() }) as CampusPostDoc)
    .filter((post) =>
      post.schoolId === schoolId && post.authorUid === uid && post.anonymous === false,
    );
  return {
    posts,
    cursor: page.length ? page[page.length - 1] : null,
    hasMore: snapshot.docs.length > CREATOR_PAGE_SIZE,
  };
}
