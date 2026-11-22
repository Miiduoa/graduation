import { ASSIGNMENT_SUMMARY_TITLE_LIMIT, validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
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
  return row.titleMayBeTruncated === true || row.title.length >= ASSIGNMENT_SUMMARY_TITLE_LIMIT;
}

export function campusAssignmentTitleIdentity(row: { title: string; titleMayBeTruncated?: true }) {
  return mayHaveTruncatedTitle(row)
    ? { summaryAssignmentTitle: row.title }
    : { fullAssignmentTitle: row.title };
}

export function campusAssignmentDisplayTitle(value: string): string {
  return normalizeCampusAssignmentTitle(value).slice(0, DISPLAY_TITLE_LIMIT);
}

function hasCutoffSpace(rawTitle: string, title: string): boolean {
  return rawTitle.length === DISPLAY_TITLE_LIMIT && rawTitle === title + ' ';
}

export function campusAssignmentLegacyMatches(snapshot: CampusSenseSnapshot, assignment: CampusAssignmentIdentity) {
  const title = campusAssignmentDisplayTitle(assignment.title);
  return snapshot.assignments.items.filter((row) =>
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null) &&
    campusAssignmentDisplayTitle(row.title) === title);
}

/** Resolve identity across the whole course/deadline scope before checking the original ID. */
export function matchCampusAssignment(
  snapshot: CampusSenseSnapshot,
  assignment: CampusAssignmentIdentity,
) {
  const rawTitle = assignment.summaryAssignmentTitle ?? assignment.fullAssignmentTitle ?? assignment.title;
  if (snapshot.assignments.status !== 'available' || typeof rawTitle !== 'string') return null;
  const title = normalizeCampusAssignmentTitle(rawTitle);
  if (!title) return null;
  const prefixMatches = campusAssignmentLegacyMatches(snapshot, { ...assignment, title: rawTitle });
  if (!assignment.fullAssignmentTitle && !assignment.summaryAssignmentTitle) {
    // Persisted cards contain the display title used by the original resolver.
    const [candidate] = prefixMatches;
    if (prefixMatches.length !== 1) return null;
    // Whitespace at the display boundary can refer to a different visible row.
    if (hasCutoffSpace(rawTitle, title) && snapshot.assignments.items.some((row) =>
      row.groupName === candidate.groupName && row.dueAt === candidate.dueAt &&
      campusAssignmentDisplayTitle(row.title) === rawTitle)) return null;
    if (assignment.expectedSource) {
      const source = parseCampusAssignmentSource(candidate.source);
      return source?.groupId === assignment.expectedSource.groupId &&
        source?.assignmentId === assignment.expectedSource.assignmentId ? candidate : null;
    }
    return mayHaveTruncatedTitle(candidate) ? null : candidate;
  }
  const rows = snapshot.assignments.items.filter((row) =>
    row.groupName === (assignment.groupName ?? '') &&
    row.dueAt === (assignment.dueAt ?? null));
  if (hasCutoffSpace(rawTitle, title)) return null;
  const mayBeTruncated = assignment.summaryAssignmentTitle !== undefined || rawTitle.length >= ASSIGNMENT_SUMMARY_TITLE_LIMIT;
  if ((mayBeTruncated || prefixMatches.some(mayHaveTruncatedTitle)) &&
      prefixMatches.length !== 1) return null;
  const matches = mayBeTruncated
    ? prefixMatches.filter((row) => mayHaveTruncatedTitle(row) &&
        normalizeCampusAssignmentTitle(row.title.slice(0, ASSIGNMENT_SUMMARY_TITLE_LIMIT)) ===
        normalizeCampusAssignmentTitle(rawTitle.slice(0, ASSIGNMENT_SUMMARY_TITLE_LIMIT)))
    : rows.filter((row) => normalizeCampusAssignmentTitle(row.title) === title);
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
