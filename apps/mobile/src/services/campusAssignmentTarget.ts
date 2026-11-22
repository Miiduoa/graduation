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

function normalizeCampusAssignmentTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function campusAssignmentDisplayTitle(value: string): string {
  return normalizeCampusAssignmentTitle(value).slice(0, 130);
}

/** Reminder cards may carry the original 130-character display title, including its final space. */
export function matchingCampusReminderAssignments(
  snapshot: CampusSenseSnapshot,
  assignment: CampusAssignmentIdentity,
) {
  const title = normalizeCampusAssignmentTitle(assignment.title);
  if (snapshot.assignments.status !== 'available' || !title) return [];
  return snapshot.assignments.items.filter((row) =>
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null) &&
    (normalizeCampusAssignmentTitle(row.title) === title ||
      campusAssignmentDisplayTitle(row.title) === assignment.title));
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
  const title = normalizeCampusAssignmentTitle(input.assignment.title);
  const matches = snapshot.assignments.items.filter((row) => {
    if (row.groupName !== (input.assignment.groupName ?? '') ||
        row.dueAt !== (input.assignment.dueAt ?? null)) return false;
    // A display title can end in a space introduced by the 130-character cutoff.
    const displayTitle = campusAssignmentDisplayTitle(row.title);
    return normalizeCampusAssignmentTitle(row.title) === title ||
      displayTitle === title || displayTitle === input.assignment.title;
  });
  // Count display-title collisions, but require a complete title to open.
  if (matches.length !== 1 || normalizeCampusAssignmentTitle(matches[0].title) !== title) return null;
  const source = parseCampusAssignmentSource(matches[0].source);
  if (!source) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
