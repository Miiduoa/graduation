import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';

/** Display identity is not authority; it must match exactly one current source row. */
export interface CampusAssignmentIdentity {
  title: string;
  /** Full title for display when the summary was not truncated. */
  fullAssignmentTitle?: string;
  /** Summary title at the server cutoff, where the suffix may be missing. */
  summaryAssignmentTitle?: string;
  expectedSource?: CampusAssignmentSource;
  groupName?: string;
  dueAt?: string | null;
}
export interface CampusAssignmentTarget {
  route: 'HomeworkSubmit';
  params: { groupId: string; assignmentId: string };
}

export function campusAssignmentTitleIdentity(row: { title: string; titleMayBeTruncated?: true }) {
  return row.titleMayBeTruncated === true
    ? { summaryAssignmentTitle: row.title }
    : { fullAssignmentTitle: row.title };
}

export function campusAssignmentDisplayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 130);
}

/**
 * No network request or mutation. Re-run at tap time, not only while rendering.
 * Never accept IDs, URLs, route names or submission content from generated text.
 * The destination still performs its normal live permission and record checks.
 */
export function resolveCampusAssignmentMatch(input: {
  assignment: CampusAssignmentIdentity;
  snapshot: CampusSenseSnapshot | null | undefined;
  scope: { uid: string; schoolId: string };
  now?: number;
}): { target: CampusAssignmentTarget; fullTitle: string | null } | null {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) return null;
  const snapshot = validCampusSenseSnapshot(input.snapshot, input.scope, now);
  if (!snapshot || snapshot.assignments.status !== 'available' ||
      typeof input.assignment.title !== 'string' || !input.assignment.title.trim()) return null;
  const title = campusAssignmentDisplayTitle(input.assignment.title);
  const matches = snapshot.assignments.items.filter((row) =>
    campusAssignmentDisplayTitle(row.title) === title &&
    row.groupName === (input.assignment.groupName ?? '') &&
    row.dueAt === (input.assignment.dueAt ?? null));
  // Same-title tasks must never pick whichever happens to appear first.
  if (matches.length !== 1) return null;
  const [row] = matches;
  const source = parseCampusAssignmentSource(row.source);
  if (!source) return null;
  return {
    target: {
      route: 'HomeworkSubmit',
      params: { groupId: source.groupId, assignmentId: source.assignmentId },
    },
    fullTitle: row.titleMayBeTruncated === true ? null : row.title,
  };
}

export function resolveCampusAssignmentTarget(
  input: Parameters<typeof resolveCampusAssignmentMatch>[0],
): CampusAssignmentTarget | null {
  return resolveCampusAssignmentMatch(input)?.target ?? null;
}
