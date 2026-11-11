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
import { getDb } from '../firebase';
import type { CampusPostDoc } from './feed';

export const CREATOR_PAGE_SIZE = 18;
export type CreatorCursor = QueryDocumentSnapshot<DocumentData> | null;
export type CreatorIdentity = { displayName: string; avatarUrl: string | null };

function checkScope(schoolId: string, uid: string) {
  if (!schoolId || !uid || schoolId.includes('/') || uid.includes('/')) {
    throw new Error('Invalid creator scope');
  }
}

/** Directory records are separate from private account documents. */
export async function readCreatorIdentity(schoolId: string, uid: string): Promise<CreatorIdentity | null> {
  checkScope(schoolId, uid);
  const snapshot = await getDocFromServer(doc(getDb(), 'schools', schoolId, 'directory', uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '';
  const avatarUrl =
    typeof data.avatarUrl === 'string' && /^https:\/\//i.test(data.avatarUrl)
      ? data.avatarUrl : null;
  return { displayName, avatarUrl };
}

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
  return {
    posts: page
      .map((entry) => ({ id: entry.id, ...entry.data() }) as CampusPostDoc)
      .filter((entry) => entry.schoolId === schoolId && entry.authorUid === uid && entry.anonymous === false),
    cursor: page.length ? page[page.length - 1] : null,
    hasMore: snapshot.docs.length > CREATOR_PAGE_SIZE,
  };
}
