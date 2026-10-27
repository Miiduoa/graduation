import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';

export type SenseSourceStatus = 'available' | 'unavailable';

export interface CampusSenseSnapshot {
  userId: string;
  schoolId: string;
  checkedAt: string;
  schedule: { status: SenseSourceStatus; count: number | null };
  assignments: {
    status: SenseSourceStatus;
    count: number | null;
    items: Array<{ title: string; groupName: string; dueAt: string | null; source?: CampusAssignmentSource }>;
  };
  announcements: {
    status: SenseSourceStatus;
    items: Array<{ title: string; publishedAt: string | null }>;
  };
}

export const CAMPUS_SENSE_MAX_AGE_MS = 15 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function parseSnapshot(payload: unknown, userId: string, schoolId: string): CampusSenseSnapshot {
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
  const parsed: CampusSenseSnapshot = {
    userId, schoolId, checkedAt: root.checkedAt,
    schedule: { status: scheduleStatus, count: count(schedule.count, scheduleStatus) },
    assignments: {
      status: assignmentStatus,
      count: count(assignments.count, assignmentStatus),
      items: assignmentStatus === 'available'
        ? assignments.items.slice(0, 12).map((item: unknown) => {
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
          })
        : [],
    },
    announcements: {
      status: announcementStatus,
      items: announcementStatus === 'available'
        ? announcements.items.slice(0, 12).map((item: unknown) => {
            const row = record(item);
            if (!row) throw new Error('invalid-sense-response');
            return { title: requiredText(row.title, 140), publishedAt: dateString(row.publishedAt) };
          })
        : [],
    },
  };
  if (!validCampusSenseSnapshot(parsed, { uid: userId, schoolId })) {
    throw new Error('expired-sense-response');
  }
  return parsed;
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
  if (!Number.isFinite(savedAt) || savedAt > now + 30_000 ||
      now - savedAt > CAMPUS_SENSE_MAX_AGE_MS) return null;
  return snapshot;
}

/**
 * Fetches only the account/school-authorized snapshot. No question or chat
 * history is uploaded; model inference continues exclusively on the phone.
 * Call only after an explicit user tap. Do not persist personal data.
 */
export async function refreshCampusSenseSnapshot(input: {
  scope: { uid: string; schoolId: string };
  isCurrent: () => boolean;
}): Promise<CampusSenseSnapshot> {
  const check = () => {
    if (!input.isCurrent() || !input.scope.uid || !input.scope.schoolId ||
        isFirebaseMockMode() || getAuthInstance().currentUser?.uid !== input.scope.uid) {
      throw new Error('session-changed');
    }
  };
  check();
  const callable = httpsCallable<{ schoolId: string }, unknown>(
    getFunctionsInstance(), 'getCampusAssistantSnapshot',
  );
  const response = await callable({ schoolId: input.scope.schoolId });
  check();
  return parseSnapshot(response.data, input.scope.uid, input.scope.schoolId);
}
