import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';

/** Display identity is not authority; it must match exactly one current source row. */
export interface CampusAssignmentIdentity {
  title: string;
  /** Live plans preserve the full title and the original source through a refresh. */
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

function normalizeCampusAssignmentTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const DISPLAY_TITLE_LIMIT = 130;

function mayHaveTruncatedTitle(row: { title: string; titleMayBeTruncated?: true }): boolean {
  return row.titleMayBeTruncated === true;
}

export function campusAssignmentTitleIdentity(row: { title: string; titleMayBeTruncated?: true }) {
  return mayHaveTruncatedTitle(row)
    ? { summaryAssignmentTitle: row.title }
    : { fullAssignmentTitle: row.title };
}

export function campusAssignmentDisplayTitle(value: string): string {
  return normalizeCampusAssignmentTitle(value).slice(0, DISPLAY_TITLE_LIMIT);
}

/** Require the original prefix lookup to identify a unique row before checking newer metadata. */
function matchCampusAssignment(snapshot: CampusSenseSnapshot, assignment: CampusAssignmentIdentity) {
  if (snapshot.assignments.status !== 'available' ||
      typeof assignment.title !== 'string' || !assignment.title.trim()) return null;
  const title = campusAssignmentDisplayTitle(assignment.title);
  const rows = snapshot.assignments.items.filter((row) =>
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null));
  const matches = rows.filter((row) => campusAssignmentDisplayTitle(row.title) === title);
  if (matches.length !== 1) return null;
  const [candidate] = matches;

  const referenceTitle = assignment.summaryAssignmentTitle ?? assignment.fullAssignmentTitle;
  if (referenceTitle !== undefined) {
    if (typeof referenceTitle !== 'string') return null;
    const normalizedTitle = normalizeCampusAssignmentTitle(referenceTitle);
    if (normalizeCampusAssignmentTitle(candidate.title) !== normalizedTitle ||
        (assignment.summaryAssignmentTitle !== undefined && !mayHaveTruncatedTitle(candidate))) return null;
    // A cutoff title can also stand for a longer title in this scope.
    if (normalizedTitle.length === DISPLAY_TITLE_LIMIT && rows.some((row) =>
      row !== candidate && normalizeCampusAssignmentTitle(row.title).startsWith(normalizedTitle))) return null;
  } else if (assignment.expectedSource && rows.some((row) =>
    row !== candidate && campusAssignmentDisplayTitle(row.title) === assignment.title)) {
    return null;
  }
  return candidate;
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
  const expected = input.assignment.expectedSource;
  if (!source || (expected &&
      (source.groupId !== expected.groupId || source.assignmentId !== expected.assignmentId))) return null;
  return {
    route: 'HomeworkSubmit',
    params: { groupId: source.groupId, assignmentId: source.assignmentId },
  };
}
