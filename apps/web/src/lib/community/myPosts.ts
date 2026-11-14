import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { CampusPostDoc } from './firestore';

export type OwnPostCursor = QueryDocumentSnapshot<DocumentData>;
export type OwnPostPage = {
  items: CampusPostDoc[];
  cursor: OwnPostCursor | null;
  hasMore: boolean;
};

/**
 * Only signed, attributable campus posts can appear on a personal page.
 * Anonymous posts deliberately have no authorUid and cannot be retrospectively attributed.
 * Each read remains scoped to one school and still requires Firestore membership permissions.
 */
export async function loadOwnCampusPosts(
  schoolId: string,
  uid: string,
  cursor: OwnPostCursor | null = null,
  pageSize = 12,
): Promise<OwnPostPage> {
  if (!schoolId || !uid) throw new Error('MISSING_SOCIAL_SCOPE');
  const size = Math.max(1, Math.min(24, Math.floor(pageSize)));
  const ref = collection(getDb(), 'schools', schoolId, 'campusPosts');
  const snapshot = await getDocs(
    query(
      ref,
      where('authorUid', '==', uid),
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size + 1),
    ),
  );
  const page = snapshot.docs.slice(0, size);
  return {
    items: page.flatMap((entry) => {
      const record = entry.data() as Omit<CampusPostDoc, 'id'>;
      if (record.schoolId !== schoolId || record.authorUid !== uid || record.anonymous === true)
        return [];
      return [{ ...record, id: entry.id }];
    }),
    cursor: snapshot.docs.length > size ? page[page.length - 1] : null,
    hasMore: snapshot.docs.length > size,
  };
}
