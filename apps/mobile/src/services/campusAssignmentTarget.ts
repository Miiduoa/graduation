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

const DISPLAY_TITLE_LIMIT = 130;

export function campusAssignmentDisplayTitle(value: string): string {
  return normalizeCampusAssignmentTitle(value).slice(0, DISPLAY_TITLE_LIMIT);
}

function hasCutoffSpace(rawTitle: string, title: string): boolean {
  return rawTitle.length === DISPLAY_TITLE_LIMIT && rawTitle === title + ' ';
}

/** Reminder cards may carry the original 130-character display title, including its final space. */
export function matchingCampusReminderAssignments(
  snapshot: CampusSenseSnapshot,
  assignment: CampusAssignmentIdentity,
) {
  const title = normalizeCampusAssignmentTitle(assignment.title);
  if (snapshot.assignments.status !== 'available' || !title) return [];
  const displayTitle = hasCutoffSpace(assignment.title, title) ? assignment.title : title;
  return snapshot.assignments.items.filter((row) => {
    if (row.groupName !== (assignment.groupName ?? '') ||
        row.dueAt !== (assignment.dueAt ?? null)) return false;
    return displayTitle.length === DISPLAY_TITLE_LIMIT
      ? campusAssignmentDisplayTitle(row.title) === displayTitle
      : normalizeCampusAssignmentTitle(row.title) === title;
  });
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
  if (hasCutoffSpace(input.assignment.title, title)) return null;
  const rows = snapshot.assignments.items.filter((row) =>
    row.groupName === (input.assignment.groupName ?? '') &&
    row.dueAt === (input.assignment.dueAt ?? null));
  const matches = rows.filter((row) => normalizeCampusAssignmentTitle(row.title) === title);
  if (matches.length !== 1) return null;
  // At the cutoff, the same display title may also represent a longer assignment.
  if (title.length === DISPLAY_TITLE_LIMIT && rows.some((row) =>
    row !== matches[0] && campusAssignmentDisplayTitle(row.title) === title)) return null;
  const source = parseCampusAssignmentSource(matches[0].source);
  if (!source) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
