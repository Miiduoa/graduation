import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource } from './campusAssignmentSource';

/** Display identity is not authority; it must match exactly one current source row. */
export interface CampusAssignmentIdentity {
  title: string;
  /** Plan steps carry the rendered preview. Replies and agenda rows carry the summary title. */
  titleFormat?: 'preview';
  groupName?: string;
  dueAt?: string | null;
}
export interface CampusAssignmentTarget {
  route: 'HomeworkSubmit';
  params: { groupId: string; assignmentId: string };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function campusAssignmentDisplayTitle(value: string): string {
  return normalizeTitle(value).slice(0, 130);
}

export function findUniqueCampusAssignment(
  assignment: CampusAssignmentIdentity,
  items: CampusSenseSnapshot['assignments']['items'],
) {
  if (typeof assignment.title !== 'string' || !assignment.title.trim()) return null;
  const isPreview = assignment.titleFormat === 'preview';
  const title = isPreview ? assignment.title : normalizeTitle(assignment.title);
  const matches = items.filter((row) =>
    (isPreview ? campusAssignmentDisplayTitle(row.title) : normalizeTitle(row.title)) === title &&
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null));
  return matches.length === 1 ? matches[0] : null;
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
  if (!snapshot || snapshot.assignments.status !== 'available') return null;
  const row = findUniqueCampusAssignment(input.assignment, snapshot.assignments.items);
  // A server-capped row can contribute to ambiguity, but cannot authorize a handoff.
  if (!row || row.title.length >= 140) return null;
  const source = parseCampusAssignmentSource(row.source);
  if (!source) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
