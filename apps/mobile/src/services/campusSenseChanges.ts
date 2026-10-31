import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { parseCampusAssignmentSource } from './campusAssignmentSource';

type Assignment = CampusSenseSnapshot['assignments']['items'][number];
export type CampusAssignmentChangeKind =
  | 'added' | 'deadline-earlier' | 'deadline-later' | 'deadline-added'
  | 'deadline-removed' | 'details-updated' | 'no-longer-listed';
export interface CampusAssignmentChange {
  id: string;
  kind: CampusAssignmentChangeKind;
  assignment: Assignment;
  previousDueAt: string | null;
}
export interface CampusAssignmentChanges {
  status: 'baseline' | 'compared' | 'not-comparable';
  reason: 'first-sync' | 'complete' | 'partial-data' | 'source-unavailable'
    | 'identity-unavailable' | 'scope-or-age' | 'out-of-order';
  from: string | null;
  to: string;
  changes: CampusAssignmentChange[];
}

function hasCompleteList(snapshot: CampusSenseSnapshot): boolean {
  const { assignments } = snapshot;
  return assignments.status === 'available' && assignments.count !== null &&
    Number.isSafeInteger(assignments.count) && assignments.count >= 0 &&
    assignments.items.length === assignments.count && assignments.coverage?.complete !== false;
}

function identityMap(snapshot: CampusSenseSnapshot): Map<string, Assignment> | null {
  const rows = new Map<string, Assignment>();
  for (const row of snapshot.assignments.items) {
    const source = parseCampusAssignmentSource(row.source);
    if (!source || !row.title.trim() ||
        (row.dueAt !== null && !Number.isFinite(Date.parse(row.dueAt)))) return null;
    const key = JSON.stringify([source.groupId, source.assignmentId]);
    if (rows.has(key)) return null;
    rows.set(key, { ...row, source });
  }
  return rows;
}

const ORDER: Record<CampusAssignmentChangeKind, number> = {
  'deadline-earlier': 0,
  added: 1,
  'deadline-added': 2,
  'deadline-later': 3,
  'deadline-removed': 4,
  'details-updated': 5,
  'no-longer-listed': 6,
};

/**
 * Compare two complete, fresh lists already read for the same signed-in scope.
 * A missing row says only "not listed now", never "submitted" or "completed".
 * Partial/legacy identity-free data cannot prove additions, removals or absence.
 * No storage, inference, network, notification or school write is performed.
 */
export function compareCampusAssignments(input: {
  previous: CampusSenseSnapshot | null;
  next: CampusSenseSnapshot;
  scope: { uid: string; schoolId: string };
  now?: number;
}): CampusAssignmentChanges {
  const now = input.now ?? Date.now();
  const result = (
    status: CampusAssignmentChanges['status'], reason: CampusAssignmentChanges['reason'],
    changes: CampusAssignmentChange[] = [],
  ): CampusAssignmentChanges => ({
    status, reason, changes,
    from: status === 'compared' ? input.previous?.checkedAt ?? null : null,
    to: input.next.checkedAt,
  });
  if (!Number.isFinite(now) || !validCampusSenseSnapshot(input.next, input.scope, now) ||
      (input.previous && !validCampusSenseSnapshot(input.previous, input.scope, now))) {
    return result('not-comparable', 'scope-or-age');
  }
  if (input.next.assignments.status !== 'available' ||
      (input.previous && input.previous.assignments.status !== 'available')) {
    return result('not-comparable', 'source-unavailable');
  }
  if (!hasCompleteList(input.next) || (input.previous && !hasCompleteList(input.previous))) {
    return result('not-comparable', 'partial-data');
  }
  const after = identityMap(input.next);
  const before = input.previous ? identityMap(input.previous) : null;
  if (!after || (input.previous && !before)) return result('not-comparable', 'identity-unavailable');
  if (!input.previous || !before) return result('baseline', 'first-sync');
  if (Date.parse(input.next.checkedAt) < Date.parse(input.previous.checkedAt)) {
    return result('not-comparable', 'out-of-order');
  }
  const changes: CampusAssignmentChange[] = [];
  for (const [id, row] of after) {
    const old = before.get(id);
    let kind: CampusAssignmentChangeKind | null = null;
    if (!old) kind = 'added';
    else {
      const priorDue = old.dueAt === null ? null : Date.parse(old.dueAt);
      const nextDue = row.dueAt === null ? null : Date.parse(row.dueAt);
      if (priorDue !== nextDue) {
        kind = priorDue === null ? 'deadline-added' : nextDue === null ? 'deadline-removed'
          : nextDue < priorDue ? 'deadline-earlier' : 'deadline-later';
      } else if (old.title !== row.title || old.groupName !== row.groupName) {
        kind = 'details-updated';
      }
    }
    if (kind) changes.push({ id, kind, assignment: row, previousDueAt: old?.dueAt ?? null });
  }
  for (const [id, old] of before) {
    if (!after.has(id)) {
      changes.push({ id, kind: 'no-longer-listed', assignment: old, previousDueAt: old.dueAt });
    }
  }
  changes.sort((left, right) => ORDER[left.kind] - ORDER[right.kind] ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return result('compared', 'complete', changes);
}
