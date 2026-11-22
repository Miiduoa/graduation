import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';

/** Display identity is not authority; it must match exactly one current source row. */
export interface CampusAssignmentIdentity {
  title: string;
  /** Live plans preserve the full title and the original source through a refresh. */
  fullAssignmentTitle?: string;
  expectedSource?: CampusAssignmentSource;
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

/** Resolve identity across the whole course/deadline scope before checking the original ID. */
export function matchCampusAssignment(
  snapshot: CampusSenseSnapshot,
  assignment: CampusAssignmentIdentity,
) {
  const rawTitle = assignment.fullAssignmentTitle ?? assignment.title;
  if (snapshot.assignments.status !== 'available' || typeof rawTitle !== 'string') return null;
  const title = normalizeCampusAssignmentTitle(rawTitle);
  if (!title || hasCutoffSpace(rawTitle, title)) return null;
  // A display-only identity at the cutoff may have lost the rest of its title.
  if (!assignment.fullAssignmentTitle && !assignment.expectedSource && title.length === DISPLAY_TITLE_LIMIT) return null;
  const rows = snapshot.assignments.items.filter((row) =>
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null));
  const matches = rows.filter((row) => normalizeCampusAssignmentTitle(row.title) === title);
  if (matches.length !== 1) return null;
  // A title at the display cutoff can also stand for a longer title in this scope.
  if (title.length === DISPLAY_TITLE_LIMIT && rows.some((row) =>
    row !== matches[0] && normalizeCampusAssignmentTitle(row.title).startsWith(title))) return null;
  if (assignment.expectedSource) {
    const source = parseCampusAssignmentSource(matches[0].source);
    if (source?.groupId !== assignment.expectedSource.groupId ||
        source?.assignmentId !== assignment.expectedSource.assignmentId) return null;
  }
  return matches[0];
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
  if (!snapshot) return null;
  const match = matchCampusAssignment(snapshot, input.assignment);
  const source = parseCampusAssignmentSource(match?.source);
  if (!source) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
