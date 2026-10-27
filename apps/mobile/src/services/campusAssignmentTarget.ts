import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource } from './campusAssignmentSource';

/** Display identity is not authority; it must match exactly one current source row. */
export interface CampusAssignmentIdentity {
  title: string;
  groupName?: string;
  dueAt?: string | null;
}
export interface CampusAssignmentTarget {
  route: 'HomeworkSubmit';
  params: { groupId: string; assignmentId: string };
}

function displayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 130);
}

/**
 * No network request or mutation. Re-run at tap time, not only while rendering.
 * Never accept IDs, URLs, route names or submission content from generated text.
 * The destination still performs its normal live permission and record checks.
 */
export function resolveCampusAssignmentTarget(input: {
  assignment: CampusAssignmentIdentity;
  snapshot: CampusSenseSnapshot | null | undefined;
  scope: { uid: string; schoolId: string };
  now?: number;
}): CampusAssignmentTarget | null {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) return null;
  const snapshot = validCampusSenseSnapshot(input.snapshot, input.scope, now);
  if (!snapshot || snapshot.assignments.status !== 'available' ||
      typeof input.assignment.title !== 'string' || !input.assignment.title.trim()) return null;
  const title = displayTitle(input.assignment.title);
  const matches = snapshot.assignments.items.filter((row) =>
    displayTitle(row.title) === title &&
    row.groupName === (input.assignment.groupName ?? '') &&
    row.dueAt === (input.assignment.dueAt ?? null));
  // Same-title tasks must never pick whichever happens to appear first.
  if (matches.length !== 1) return null;
  const source = parseCampusAssignmentSource(matches[0].source);
  if (!source) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
