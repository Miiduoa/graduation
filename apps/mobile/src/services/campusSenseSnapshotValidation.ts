import type { CampusAssignmentSource } from './campusAssignmentSource';
import type { CampusAnnouncementSource } from './campusAnnouncementSource';

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
    items: Array<{
      title: string;
      titleMayBeTruncated?: true;
      groupName: string;
      dueAt: string | null;
      source?: CampusAssignmentSource;
    }>;
    coverage?: { complete: boolean; reason: AssignmentCoverageReason; pages: number };
  };
  announcements: {
    status: SenseSourceStatus;
    items: Array<{ title: string; publishedAt: string | null; source?: CampusAnnouncementSource }>;
  };
}

export const CAMPUS_SENSE_MAX_AGE_MS = 15 * 60 * 1000;

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
