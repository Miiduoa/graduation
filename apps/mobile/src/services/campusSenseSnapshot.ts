import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';
import { abortableCampusRead, CAMPUS_SENSE_PAGE_TIMEOUT_MS } from './abortableCampusRead';

export type SenseSourceStatus = 'available' | 'unavailable';
export type AssignmentCoverageReason = 'complete' | 'legacy-partial' | 'read-budget';
export interface CampusSenseSnapshot {
  userId: string;
  schoolId: string;
  checkedAt: string;
  schedule: { status: SenseSourceStatus; count: number | null };
  assignments: {
    status: SenseSourceStatus;
    count: number | null;
    items: Array<{ title: string; groupName: string; dueAt: string | null; source?: CampusAssignmentSource }>;
    coverage?: { complete: boolean; reason: AssignmentCoverageReason; pages: number };
  };
  announcements: {
    status: SenseSourceStatus;
    items: Array<{ title: string; publishedAt: string | null }>;
  };
}

export const CAMPUS_SENSE_MAX_AGE_MS = 15 * 60 * 1000;
export const CAMPUS_ASSIGNMENT_PAGE_SIZE = 50;
// Bound a user-triggered read, respecting the existing 12 requests/5 min limit.
// Larger lists remain explicitly partial; never silently label a capped read complete.
export const CAMPUS_ASSIGNMENT_MAX_PAGES = 8;
export const CAMPUS_SENSE_TOTAL_TIMEOUT_MS = 90_000;

/** Progress contains counts only. Partial assignment rows are never published. */
export interface CampusSenseProgress {
  phase: 'reading' | 'complete';
  loaded: number;
  total: number | null;
  pages: number;
  pageLimit: number;
}

type AssignmentPage = { offset: number; nextOffset: number | null; revision: string };
type ParsedSense = { snapshot: CampusSenseSnapshot; page: AssignmentPage | null };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function status(value: unknown): SenseSourceStatus {
  if (value !== 'available' && value !== 'unavailable') throw new Error('invalid-sense-response');
  return value;
}
function count(value: unknown, source: SenseSourceStatus): number | null {
  if (source === 'unavailable') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid-sense-response');
  }
  return value;
}
function dateString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid-sense-response');
  }
  return value;
}
function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid-sense-response');
  return Array.from(value.trim().slice(0, max), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
}

function parsePage(value: unknown, total: number, size: number): AssignmentPage | null {
  if (value === undefined) return null; // Older deployed servers stay usable, visibly partial.
  const row = record(value);
  if (!row || row.version !== 1 || typeof row.offset !== 'number' ||
      !Number.isSafeInteger(row.offset) || row.offset < 0 || row.offset > total ||
      row.offset % CAMPUS_ASSIGNMENT_PAGE_SIZE !== 0 ||
      typeof row.revision !== 'string' || !/^[a-f0-9]{64}$/.test(row.revision) ||
      size !== Math.min(CAMPUS_ASSIGNMENT_PAGE_SIZE, total - row.offset)) {
    throw new Error('invalid-assignment-page');
  }
  const end = row.offset + size;
  const expectedNext = end < total ? end : null;
  if (row.nextOffset !== expectedNext || (expectedNext !== null && size === 0)) {
    throw new Error('invalid-assignment-page');
  }
  return { offset: row.offset, nextOffset: expectedNext, revision: row.revision };
}

function parseSnapshot(payload: unknown, userId: string, schoolId: string): ParsedSense {
  const root = record(payload);
  if (!root || root.schoolId !== schoolId || typeof root.checkedAt !== 'string') {
    throw new Error('invalid-sense-response');
  }
  const schedule = record(root.schedule);
  const assignments = record(root.assignments);
  const announcements = record(root.announcements);
  if (!schedule || !assignments || !announcements ||
      !Array.isArray(assignments.items) || !Array.isArray(announcements.items)) {
    throw new Error('invalid-sense-response');
  }
  const scheduleStatus = status(schedule.status);
  const assignmentStatus = status(assignments.status);
  const announcementStatus = status(announcements.status);
  const total = count(assignments.count, assignmentStatus);
  if (assignmentStatus === 'available' && (assignments.items.length > CAMPUS_ASSIGNMENT_PAGE_SIZE ||
      total === null || assignments.items.length > total)) throw new Error('invalid-sense-response');
  const snapshot: CampusSenseSnapshot = {
    userId, schoolId, checkedAt: root.checkedAt,
    schedule: { status: scheduleStatus, count: count(schedule.count, scheduleStatus) },
    assignments: {
      status: assignmentStatus, count: total,
      items: assignmentStatus === 'available'
        ? assignments.items.map((item: unknown) => {
            const row = record(item);
            if (!row) throw new Error('invalid-sense-response');
            const source = row.source === undefined ? null : parseCampusAssignmentSource(row.source);
            if (row.source !== undefined && !source) throw new Error('invalid-sense-response');
            return {
              title: requiredText(row.title, 140),
              groupName: typeof row.groupName === 'string' ? row.groupName.trim().slice(0, 100) : '',
              dueAt: dateString(row.dueAt),
              ...(source ? { source } : {}),
            };
          }) : [],
    },
    announcements: {
      status: announcementStatus,
      items: announcementStatus === 'available'
        ? announcements.items.slice(0, 12).map((item: unknown) => {
            const row = record(item);
            if (!row) throw new Error('invalid-sense-response');
            return { title: requiredText(row.title, 140), publishedAt: dateString(row.publishedAt) };
          }) : [],
    },
  };
  if (!validCampusSenseSnapshot(snapshot, { uid: userId, schoolId })) throw new Error('expired-sense-response');
  const page = assignmentStatus === 'available' && total !== null
    ? parsePage(assignments.paging, total, snapshot.assignments.items.length) : null;
  return { snapshot, page };
}

/** A verified, short-lived, in-memory read. An old cache cannot be described as live. */
export function validCampusSenseSnapshot(
  snapshot: CampusSenseSnapshot | null | undefined,
  scope: { uid: string; schoolId: string },
  now = Date.now(),
): CampusSenseSnapshot | null {
  if (!scope.uid || !scope.schoolId || !snapshot ||
      snapshot.userId !== scope.uid || snapshot.schoolId !== scope.schoolId) return null;
  const savedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(savedAt) || savedAt > now + 30_000 || now - savedAt > CAMPUS_SENSE_MAX_AGE_MS) return null;
  return snapshot;
}

/**
 * Explicit user-triggered read; no conversation or model input is uploaded.
 * Never publish a mixed revision or a partial result after a failed page.
 */
export async function refreshCampusSenseSnapshot(input: {
  scope: { uid: string; schoolId: string };
  isCurrent: () => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: CampusSenseProgress) => void;
}): Promise<CampusSenseSnapshot> {
  const startedAt = Date.now();
  const check = () => {
    if (!input.isCurrent() || !input.scope.uid || !input.scope.schoolId ||
        isFirebaseMockMode() || getAuthInstance().currentUser?.uid !== input.scope.uid) {
      throw new Error('session-changed');
    }
    if (input.signal?.aborted) throw new Error('sense-cancelled');
  };
  const report = (phase: CampusSenseProgress['phase'], loaded: number, total: number | null, pages: number) => {
    check();
    input.onProgress?.({ phase, loaded, total, pages, pageLimit: CAMPUS_ASSIGNMENT_MAX_PAGES });
    check();
  };
  check();
  report('reading', 0, null, 0);
  const callable = httpsCallable<{
    schoolId: string; assignmentPage?: { offset: number; revision: string };
  }, unknown>(getFunctionsInstance(), 'getCampusAssistantSnapshot');
  const readPage = (assignmentPage?: { offset: number; revision: string }) => {
    check();
    const remaining = CAMPUS_SENSE_TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    return abortableCampusRead(() => callable({
      schoolId: input.scope.schoolId,
      ...(assignmentPage ? { assignmentPage } : {}),
    }), input.signal, Math.min(CAMPUS_SENSE_PAGE_TIMEOUT_MS, remaining));
  };
  const response = await readPage();
  check();
  const first = parseSnapshot(response.data, input.scope.uid, input.scope.schoolId);
  if (first.snapshot.assignments.status !== 'available') {
    report('complete', 0, null, 1);
    return first.snapshot;
  }
  if (first.page && first.page.offset !== 0) throw new Error('invalid-assignment-page');

  const items: CampusSenseSnapshot['assignments']['items'] = [];
  const identities = new Set<string>();
  const append = (rows: CampusSenseSnapshot['assignments']['items']) => {
    for (const row of rows) {
      if (row.source) {
        const identity = JSON.stringify([row.source.groupId, row.source.assignmentId]);
        if (identities.has(identity)) throw new Error('duplicate-assignment-page');
        identities.add(identity);
      }
      items.push(row);
    }
  };
  append(first.snapshot.assignments.items);
  let page = first.page;
  let pages = 1;
  report('reading', items.length, first.snapshot.assignments.count, pages);
  while (page && page.nextOffset !== null && pages < CAMPUS_ASSIGNMENT_MAX_PAGES) {
    check();
    const assignmentPage = { offset: page.nextOffset, revision: page.revision };
    const nextResponse = await readPage(assignmentPage);
    check();
    const next = parseSnapshot(nextResponse.data, input.scope.uid, input.scope.schoolId);
    if (!next.page || next.page.offset !== page.nextOffset ||
        next.page.revision !== page.revision || next.snapshot.assignments.status !== 'available' ||
        next.snapshot.assignments.count !== first.snapshot.assignments.count) {
      throw new Error('assignment-source-changed');
    }
    append(next.snapshot.assignments.items);
    page = next.page;
    pages += 1;
    report('reading', items.length, first.snapshot.assignments.count, pages);
  }
  check();
  // Later pages must not extend the life of the first page or its announcements.
  if (!validCampusSenseSnapshot(first.snapshot, input.scope)) throw new Error('expired-sense-response');
  const complete = items.length === first.snapshot.assignments.count;
  const reason: AssignmentCoverageReason = complete ? 'complete' : page ? 'read-budget' : 'legacy-partial';
  report('complete', items.length, first.snapshot.assignments.count, pages);
  return {
    ...first.snapshot,
    assignments: { ...first.snapshot.assignments, items, coverage: { complete, reason, pages } },
  };
}
