import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
  where,
} from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';
import type { Announcement, AnnouncementCategory, Attachment, ClubEvent } from '../data/types';

type SourceDocument = { id: string; data: () => Record<string, unknown> };

function sourceDb(schoolId: string) {
  if (!schoolId || schoolId.includes('/') || isFirebaseMockMode())
    throw new Error('Campus content unavailable');
  return getDb();
}

function dateString(value: unknown): string {
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

function sourceData(document: SourceDocument, schoolId: string) {
  const data = document.data();
  if (
    typeof data.title !== 'string' ||
    !data.title.trim() ||
    (data.schoolId != null && data.schoolId !== schoolId)
  ) {
    throw new Error('Invalid campus content');
  }
  return data;
}

export function isPublicWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function announcement(document: SourceDocument, schoolId: string): Announcement {
  const data = sourceData(document, schoolId);
  const categories: AnnouncementCategory[] = [
    'general',
    'academic',
    'event',
    'emergency',
    'system',
  ];
  const attachments: Attachment[] = Array.isArray(data.attachments)
    ? data.attachments.flatMap((item: unknown, index) => {
        if (!item || typeof item !== 'object') return [];
        const attachment = item as Record<string, unknown>;
        if (
          !isPublicWebUrl(attachment.url) ||
          typeof attachment.name !== 'string' ||
          !attachment.name.trim()
        )
          return [];
        return [
          {
            id: typeof attachment.id === 'string' ? attachment.id : String(index),
            name: attachment.name,
            url: attachment.url,
            type: 'other' as const,
          },
        ];
      })
    : [];
  return {
    id: document.id,
    schoolId,
    title: data.title as string,
    body: typeof data.body === 'string' ? data.body : '',
    publishedAt: dateString(data.publishedAt),
    source: typeof data.source === 'string' ? data.source : undefined,
    category: categories.includes(data.category as AnnouncementCategory)
      ? (data.category as AnnouncementCategory)
      : 'general',
    pinned: data.pinned === true,
    attachments,
  };
}

function event(document: SourceDocument, schoolId: string): ClubEvent {
  const data = sourceData(document, schoolId);
  const nonnegativeNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    id: document.id,
    schoolId,
    title: data.title as string,
    description: typeof data.description === 'string' ? data.description : '',
    startsAt: dateString(data.startsAt),
    endsAt: dateString(data.endsAt) || undefined,
    location: typeof data.location === 'string' ? data.location : undefined,
    organizer: typeof data.organizer === 'string' ? data.organizer : undefined,
    capacity: nonnegativeNumber(data.capacity),
    registeredCount: nonnegativeNumber(data.registeredCount),
    registrationDeadline: dateString(data.registrationDeadline) || undefined,
    fee: nonnegativeNumber(data.fee),
    appRegistrationConfigured:
      (data.registrationPolicy as { version?: unknown } | undefined)?.version === 1 &&
      Number.isSafeInteger(data.appRegistrationCount) &&
      (data.appRegistrationCount as number) >= 0,
  };
}

async function loadList<T>(
  schoolId: string,
  name: 'announcements' | 'events',
  normalize: (document: SourceDocument, schoolId: string) => T,
) {
  const db = sourceDb(schoolId);
  const constraints = [
    orderBy(name === 'announcements' ? 'publishedAt' : 'startsAt', 'desc'),
    limit(100),
  ];
  let snapshot = await getDocsFromServer(
    query(collection(db, 'schools', schoolId, name), ...constraints),
  );
  // Legacy data is read only after an authoritative empty result; failed reads remain failures.
  if (snapshot.empty)
    snapshot = await getDocsFromServer(
      query(collection(db, name), where('schoolId', '==', schoolId), ...constraints),
    );
  return snapshot.docs.map((document) => normalize(document, schoolId));
}

async function loadDetail<T>(
  schoolId: string,
  id: string,
  name: 'announcements' | 'events',
  normalize: (document: SourceDocument, schoolId: string) => T,
): Promise<T | null> {
  const db = sourceDb(schoolId);
  if (!id || id.includes('/')) return null;
  let snapshot = await getDocFromServer(doc(db, 'schools', schoolId, name, id));
  if (!snapshot.exists()) {
    snapshot = await getDocFromServer(doc(db, name, id));
    if (!snapshot.exists() || snapshot.data().schoolId !== schoolId) return null;
  }
  return normalize({ id: snapshot.id, data: () => snapshot.data()! }, schoolId);
}

export const loadCampusAnnouncements = (schoolId: string) =>
  loadList(schoolId, 'announcements', announcement);
export const loadCampusAnnouncement = (schoolId: string, id: string) =>
  loadDetail(schoolId, id, 'announcements', announcement);
export type CampusEventSource = 'school-club-events' | 'school-events' | 'legacy-events';
export type CampusEvent = ClubEvent & { source: CampusEventSource };
export type CampusEventCursor = {
  schoolId: string;
  source: CampusEventSource;
  document: QueryDocumentSnapshot;
};
export type CampusEventPage = {
  items: CampusEvent[];
  source: CampusEventSource;
  nextCursor: CampusEventCursor | null;
};
const EVENT_SOURCES: CampusEventSource[] = ['school-club-events', 'school-events', 'legacy-events'];
const EVENT_PAGE_SIZE = 25;

function eventPath(schoolId: string, source: CampusEventSource): [string, ...string[]] {
  if (source === 'school-club-events') return ['schools', schoolId, 'clubEvents'];
  if (source === 'school-events') return ['schools', schoolId, 'events'];
  if (source === 'legacy-events') return ['events'];
  throw new Error('Invalid event source');
}

export async function loadCampusEventPage(
  schoolId: string,
  cursor: CampusEventCursor | null = null,
): Promise<CampusEventPage> {
  const db = sourceDb(schoolId);
  if (cursor && (cursor.schoolId !== schoolId || !EVENT_SOURCES.includes(cursor.source))) {
    throw new Error('Event cursor does not belong to this school');
  }
  const sources = cursor ? [cursor.source] : EVENT_SOURCES;
  for (const source of sources) {
    const path = eventPath(schoolId, source);
    if (cursor && cursor.document.ref.parent.path !== path.join('/')) {
      throw new Error('Event cursor does not belong to this source');
    }
    // Document snapshots give stable pagination even when dates repeat or are not yet published.
    const constraints = [
      ...(source === 'legacy-events' ? [where('schoolId', '==', schoolId)] : []),
      orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor.document)] : []),
      limit(EVENT_PAGE_SIZE + 1),
    ];
    const snapshot = await getDocsFromServer(query(collection(db, ...path), ...constraints));
    if (snapshot.empty && !cursor && source !== EVENT_SOURCES[EVENT_SOURCES.length - 1]) continue;
    const documents = snapshot.docs.slice(0, EVENT_PAGE_SIZE);
    const items = documents.map((document) => ({ ...event(document, schoolId), source }));
    return {
      items,
      source,
      nextCursor:
        snapshot.docs.length > EVENT_PAGE_SIZE
          ? { schoolId, source, document: documents[documents.length - 1] }
          : null,
    };
  }
  throw new Error('Event source unavailable');
}

export async function loadCampusEvent(
  schoolId: string,
  id: string,
  source?: string,
): Promise<CampusEvent | null> {
  const db = sourceDb(schoolId);
  if (!id || id.includes('/')) return null;
  if (source != null && !EVENT_SOURCES.includes(source as CampusEventSource))
    throw new Error('Invalid event source');
  for (const candidate of source ? [source as CampusEventSource] : EVENT_SOURCES) {
    const snapshot = await getDocFromServer(doc(db, ...eventPath(schoolId, candidate), id));
    if (!snapshot.exists()) continue;
    if (candidate === 'legacy-events' && snapshot.data().schoolId !== schoolId) return null;
    return {
      ...event({ id: snapshot.id, data: () => snapshot.data()! }, schoolId),
      source: candidate,
    };
  }
  return null;
}
