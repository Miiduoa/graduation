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
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase';

export type CampusEventSource = 'school-club-events' | 'school-events' | 'legacy-events';

export type CampusEvent = {
  id: string;
  schoolId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  organizer?: string;
  capacity?: number;
  registeredCount?: number;
  registrationDeadline?: string;
  fee?: number;
  appRegistrationConfigured: boolean;
  source: CampusEventSource;
};

export type CampusEventCursor = {
  schoolId: string;
  source: CampusEventSource;
  document: QueryDocumentSnapshot;
};

export type CampusEventSkippedRow = {
  id: string;
  reason: string;
};

export type CampusEventPage = {
  items: CampusEvent[];
  source: CampusEventSource;
  nextCursor: CampusEventCursor | null;
  skipped: CampusEventSkippedRow[];
};

const EVENT_SOURCES: CampusEventSource[] = [
  'school-club-events',
  'school-events',
  'legacy-events',
];
export const CAMPUS_EVENT_PAGE_SIZE = 25;
const EVENT_PAGE_FETCH = CAMPUS_EVENT_PAGE_SIZE + 1;

type SourceDocument = { id: string; data: () => Record<string, unknown> };

function assertStableId(value: string, label: string): string {
  if (
    !value ||
    value.includes('/') ||
    value === '__proto__' ||
    value === 'constructor' ||
    value === 'prototype'
  ) {
    throw new Error(
      label === 'schoolId' ? 'Campus content unavailable' : 'Invalid campus content',
    );
  }
  return value;
}

function assertSchoolId(schoolId: string): string {
  return assertStableId(schoolId, 'schoolId');
}

function sourceDb(schoolId: string) {
  assertSchoolId(schoolId);
  if (!isFirebaseConfigured()) throw new Error('Campus content unavailable');
  return getDb();
}

function isCampusEventSource(value: unknown): value is CampusEventSource {
  return typeof value === 'string' && EVENT_SOURCES.includes(value as CampusEventSource);
}

function dateString(value: unknown): string {
  const date =
    typeof value === 'string'
      ? new Date(value)
      : value &&
          typeof value === 'object' &&
          'toDate' in value &&
          typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseEventDocument(
  document: SourceDocument,
  schoolId: string,
  source: CampusEventSource,
): CampusEvent {
  const data = document.data();
  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new Error('Invalid campus content');
  }
  if (data.schoolId != null && data.schoolId !== schoolId) {
    throw new Error('Invalid campus content');
  }
  if (source === 'legacy-events' && data.schoolId !== schoolId) {
    throw new Error('Invalid campus content');
  }
  if (!document.id || document.id.includes('/')) {
    throw new Error('Invalid campus content');
  }
  return {
    id: document.id,
    schoolId,
    title: data.title,
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
    source,
  };
}

export function eventCollectionPath(
  schoolId: string,
  source: CampusEventSource,
): [string, ...string[]] {
  assertSchoolId(schoolId);
  if (source === 'school-club-events') return ['schools', schoolId, 'clubEvents'];
  if (source === 'school-events') return ['schools', schoolId, 'events'];
  if (source === 'legacy-events') return ['events'];
  throw new Error('Invalid event source');
}

export function campusEventSupportsAppRegistration(event: Pick<CampusEvent, 'source'>): boolean {
  return event.source === 'school-club-events';
}

function assertCursor(schoolId: string, cursor: CampusEventCursor) {
  if (cursor.schoolId !== schoolId || !isCampusEventSource(cursor.source)) {
    throw new Error('Event cursor does not belong to this school');
  }
  const path = eventCollectionPath(schoolId, cursor.source).join('/');
  if (cursor.document?.ref?.parent?.path !== path) {
    throw new Error('Event cursor does not belong to this source');
  }
}

export async function loadCampusEventPage(
  schoolId: string,
  cursor: CampusEventCursor | null = null,
): Promise<CampusEventPage> {
  const db = sourceDb(schoolId);
  if (cursor) assertCursor(schoolId, cursor);

  const sources = cursor ? [cursor.source] : EVENT_SOURCES;
  for (const source of sources) {
    const path = eventCollectionPath(schoolId, source);
    const constraints = [
      ...(source === 'legacy-events' ? [where('schoolId', '==', schoolId)] : []),
      orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor.document)] : []),
      limit(EVENT_PAGE_FETCH),
    ];
    const snapshot = await getDocsFromServer(query(collection(db, ...path), ...constraints));
    if (snapshot.empty && !cursor && source !== EVENT_SOURCES[EVENT_SOURCES.length - 1]) {
      continue;
    }

    const documents = snapshot.docs.slice(0, CAMPUS_EVENT_PAGE_SIZE);
    const items: CampusEvent[] = [];
    const skipped: CampusEventSkippedRow[] = [];
    for (const document of documents) {
      try {
        items.push(
          parseEventDocument({ id: document.id, data: () => document.data() }, schoolId, source),
        );
      } catch (error) {
        skipped.push({
          id: document.id,
          reason: error instanceof Error ? error.message : 'Invalid campus content',
        });
      }
    }

    return {
      items,
      source,
      skipped,
      nextCursor:
        snapshot.docs.length > CAMPUS_EVENT_PAGE_SIZE
          ? { schoolId, source, document: documents[documents.length - 1]! }
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
  if (source != null && !isCampusEventSource(source)) {
    throw new Error('Invalid event source');
  }

  const candidates = source ? [source] : EVENT_SOURCES;
  for (const candidate of candidates) {
    const snapshot = await getDocFromServer(doc(db, ...eventCollectionPath(schoolId, candidate), id));
    if (!snapshot.exists()) continue;
    return parseEventDocument(
      { id: snapshot.id, data: () => snapshot.data() as Record<string, unknown> },
      schoolId,
      candidate,
    );
  }
  return null;
}
