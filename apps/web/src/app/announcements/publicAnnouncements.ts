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
import {
  isAnnouncementSchoolVisibleToPublic,
  SOURCE_DOWN_EMPTY_TEXT,
} from '@campus/shared/src/campusAnnouncements';
import { getAnnouncementVisibilityEnv } from '@/lib/runtime';

export type AnnouncementSourceHealth = {
  sourceId: string;
  office: string;
  status: 'healthy' | 'unavailable';
  message: string;
  listUrl?: string;
  lastSuccessAt?: string;
};

export type AnnouncementFeed = {
  announcements: Announcement[];
  sources: AnnouncementSourceHealth[];
  allUnavailable: boolean;
};

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

function originalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function loadAnnouncements(schoolId: string): Promise<Announcement[]> {
  const feed = await loadAnnouncementFeed(schoolId);
  return feed.announcements;
}

export async function loadAnnouncementFeed(schoolId: string): Promise<AnnouncementFeed> {
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv())) {
    return { announcements: [], sources: [], allUnavailable: false };
  }
  if (!isFirebaseConfigured()) throw new Error('Announcement source unavailable');
  const db = getDb();
  const constraints = [orderBy('publishedAt', 'desc'), limit(20)];
  let snapshot = await getDocsFromServer(
    query(collection(db, 'schools', schoolId, 'announcements'), ...constraints),
  );
  if (snapshot.empty) {
    snapshot = await getDocsFromServer(
      query(collection(db, 'announcements'), where('schoolId', '==', schoolId), ...constraints),
    );
  }
  const sourcesSnap = await getDocsFromServer(
    collection(db, 'schools', schoolId, 'announcement-sources'),
  );
  const sources: AnnouncementSourceHealth[] = sourcesSnap.docs.map((document) => {
    const data = document.data();
    const unavailable = data.status === 'unavailable';
    return {
      sourceId: typeof data.sourceId === 'string' ? data.sourceId : document.id,
      office: typeof data.office === 'string' ? data.office : document.id,
      status: unavailable ? 'unavailable' : 'healthy',
      message: unavailable ? SOURCE_DOWN_EMPTY_TEXT : '',
      listUrl: originalUrl(data.listUrl),
      lastSuccessAt: publishedDate(data.lastSuccessAt) || undefined,
    };
  });
  const announcements = snapshot.docs.map((document) => normalizeAnnouncement(document, schoolId));
  return {
    announcements,
    sources,
    allUnavailable: sources.length > 0 && sources.every((item) => item.status === 'unavailable'),
  };
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
  const summary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary
      : typeof data.body === 'string'
        ? data.body
        : '';
  return {
    id: document.id,
    title: data.title,
    body: summary,
    summary,
    originalUrl: originalUrl(data.originalUrl),
    sourceId: typeof data.sourceId === 'string' ? data.sourceId : undefined,
    origin: typeof data.origin === 'string' ? data.origin : undefined,
    office: typeof data.office === 'string' ? data.office : undefined,
    publishedAt: publishedDate(data.publishedAt),
    source: typeof data.source === 'string' ? data.source : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    pinned: data.pinned === true,
    schoolId,
  };
}

export async function loadAnnouncement(schoolId: string, id: string): Promise<Announcement | null> {
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv())) return null;
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
