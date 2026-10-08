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
export const loadCampusEvents = (schoolId: string) => loadList(schoolId, 'events', event);
export const loadCampusEvent = (schoolId: string, id: string) =>
  loadDetail(schoolId, id, 'events', event);
