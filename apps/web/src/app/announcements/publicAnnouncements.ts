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
  ANNOUNCEMENT_RECENT_LIMIT,
  ANNOUNCEMENT_SOURCE_LIMIT,
  announcementSourceIdsForSchool,
  isAnnouncementSchoolVisibleToPublic,
  mergeAnnouncementsById,
  selectOfficialAnnouncements,
  selectStudentAnnouncements,
  SOURCE_UNAVAILABLE_TEXT,
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
  officialAnnouncements: Announcement[];
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

async function querySchoolAnnouncements(
  schoolId: string,
  extra: Array<ReturnType<typeof where> | ReturnType<typeof orderBy>>,
  maxItems: number,
) {
  const db = getDb();
  const snapshot = await getDocsFromServer(
    query(collection(db, 'schools', schoolId, 'announcements'), ...extra, limit(maxItems)),
  );
  return snapshot.docs.flatMap((document) => {
    try {
      return [normalizeAnnouncement(document, schoolId)];
    } catch {
      return [];
    }
  });
}

export async function loadAnnouncementFeed(schoolId: string): Promise<AnnouncementFeed> {
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv())) {
    return { announcements: [], officialAnnouncements: [], sources: [], allUnavailable: false };
  }
  if (!isFirebaseConfigured()) throw new Error('Announcement source unavailable');
  const db = getDb();
  const recent = await querySchoolAnnouncements(
    schoolId,
    [orderBy('publishedAt', 'desc')],
    ANNOUNCEMENT_RECENT_LIMIT,
  );
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
      message: unavailable ? SOURCE_UNAVAILABLE_TEXT : '',
      listUrl: originalUrl(data.listUrl),
      lastSuccessAt: publishedDate(data.lastSuccessAt) || undefined,
    };
  });
  const present = new Set(
    recent.map((item) => item.sourceId).filter((value): value is string => Boolean(value)),
  );
  const missing = announcementSourceIdsForSchool(schoolId, sources).filter(
    (sourceId) => !present.has(sourceId),
  );
  // 學校自己的集合已確定是 0 則時，不必再依處室補查。
  const extras =
    recent.length === 0 || missing.length === 0
      ? []
      : await Promise.all(
          missing.map((sourceId) =>
            querySchoolAnnouncements(
              schoolId,
              [where('sourceId', '==', sourceId)],
              ANNOUNCEMENT_SOURCE_LIMIT,
            ),
          ),
        );
  const merged = mergeAnnouncementsById([recent, ...extras]);
  const announcements = selectStudentAnnouncements(merged, sources);
  const officialAnnouncements = selectOfficialAnnouncements(merged, sources);
  return {
    announcements,
    officialAnnouncements,
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
    studentFeed: data.studentFeed !== false,
    visible: data.visible !== false,
    audience: typeof data.audience === 'string' ? data.audience : undefined,
  } as Announcement;
}

export async function loadAnnouncement(schoolId: string, id: string): Promise<Announcement | null> {
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv()))
    return null;
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
