import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getDb, isFirebaseConfigured, type Announcement } from '@/lib/firebase';

function publishedDate(value: unknown): string {
  const date =
    typeof value === 'string'
      ? new Date(value)
      : value &&
          typeof value === 'object' &&
          'toDate' in value &&
          typeof value.toDate === 'function'
        ? value.toDate()
        : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export async function loadAnnouncements(schoolId: string): Promise<Announcement[]> {
  if (!isFirebaseConfigured()) throw new Error('Announcement source unavailable');
  const db = getDb();
  const constraints = [orderBy('publishedAt', 'desc'), limit(20)];
  let snapshot = await getDocsFromServer(
    query(collection(db, 'schools', schoolId, 'announcements'), ...constraints),
  );
  // Retain the existing migration path only after a successful, empty canonical read.
  if (snapshot.empty) {
    snapshot = await getDocsFromServer(
      query(collection(db, 'announcements'), where('schoolId', '==', schoolId), ...constraints),
    );
  }
  return snapshot.docs.map((document) => normalizeAnnouncement(document, schoolId));
}

function normalizeAnnouncement(
  document: { id: string; data: () => Record<string, unknown> },
  schoolId: string,
): Announcement {
  const data = document.data();
  if (
    typeof data.title !== 'string' ||
    !data.title.trim() ||
    (data.schoolId != null && data.schoolId !== schoolId)
  ) {
    throw new Error('Invalid announcement source');
  }
  return {
    id: document.id,
    title: data.title,
    body: typeof data.body === 'string' ? data.body : '',
    publishedAt: publishedDate(data.publishedAt),
    source: typeof data.source === 'string' ? data.source : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    pinned: data.pinned === true,
    schoolId,
  };
}

export async function loadAnnouncement(schoolId: string, id: string): Promise<Announcement | null> {
  if (!isFirebaseConfigured()) throw new Error('Announcement source unavailable');
  if (!id || id.includes('/')) return null;
  const db = getDb();
  let snapshot = await getDocFromServer(doc(db, 'schools', schoolId, 'announcements', id));
  if (!snapshot.exists()) {
    snapshot = await getDocFromServer(doc(db, 'announcements', id));
    if (!snapshot.exists() || snapshot.data().schoolId !== schoolId) return null;
  }
  return normalizeAnnouncement({ id: snapshot.id, data: () => snapshot.data()! }, schoolId);
}
