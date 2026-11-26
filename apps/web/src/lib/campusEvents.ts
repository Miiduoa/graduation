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
import { campusEventInstant, type CampusEventTime } from '@campus/shared/src/campusEventTime';
import { getDb, isFirebaseConfigured } from './firebase';
import { guardedPublicCampusRead, type PublicCampusReadGuard } from './publicCampusReadGuard';

export type CampusEventSource = 'school-club-events' | 'school-events' | 'legacy-events';

export type CampusEvent = {
  id: string;
  schoolId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt?: string;
  calendarTime?: CampusEventTime;
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

function sourceDb(schoolId: string, guard?: PublicCampusReadGuard) {
  assertSchoolId(schoolId);
  if (!isFirebaseConfigured()) throw new Error('Campus content unavailable');
  return guard?.db ?? getDb();
}

function isCampusEventSource(value: unknown): value is CampusEventSource {
  return typeof value === 'string' && EVENT_SOURCES.includes(value as CampusEventSource);
}

function dateString(value: unknown): string {
  if (typeof value !== 'string') return campusEventInstant(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseEventDocument(
  document: SourceDocument,
  schoolId: string,
  source: CampusEventSource,
  requireInstant = false,
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
  const calendarTime = { startsAt: campusEventInstant(data.startsAt), endsAt: campusEventInstant(data.endsAt) };
  // Preserve legacy display dates while keeping ambiguous source clocks out of agent actions.
  return {
    id: document.id,
    schoolId,
    title: data.title,
    description: typeof data.description === 'string' ? data.description : '',
    startsAt: requireInstant ? calendarTime.startsAt : calendarTime.startsAt || dateString(data.startsAt),
    endsAt: (requireInstant ? calendarTime.endsAt : calendarTime.endsAt || dateString(data.endsAt)) || undefined,
    calendarTime,
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
  guard?: PublicCampusReadGuard,
): Promise<CampusEventPage> {
  const db = sourceDb(schoolId, guard);
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
    const snapshot = await guardedPublicCampusRead(guard, () =>
      getDocsFromServer(query(collection(db, ...path), ...constraints)));
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
  guard?: PublicCampusReadGuard,
): Promise<CampusEvent | null> {
  const db = sourceDb(schoolId, guard);
  if (!id || id.includes('/')) return null;
  if ((source != null && !isCampusEventSource(source)) || (guard && !source)) {
    throw new Error('Invalid event source');
  }

  const candidates = source ? [source] : EVENT_SOURCES;
  for (const candidate of candidates) {
    const path = eventCollectionPath(schoolId, candidate);
    const snapshot = await guardedPublicCampusRead(guard, () => getDocFromServer(doc(db, ...path, id)));
    if (!snapshot.exists()) continue;
    if (snapshot.id !== id || (guard && snapshot.ref.parent.path !== path.join('/'))) {
      throw new Error('Invalid campus content');
    }
    return parseEventDocument(
      { id: snapshot.id, data: () => snapshot.data() as Record<string, unknown> },
      schoolId,
      candidate,
      Boolean(guard),
    );
  }
  return null;
}
