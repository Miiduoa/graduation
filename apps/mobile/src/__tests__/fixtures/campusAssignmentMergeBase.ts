// Candidate selection from d31a3faa5a36dd12ce559be49aac75a92fca1bfc.
import type { CampusReminderScope, ReminderAssignment } from '../../services/campusAssignmentReminders';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import { parseCampusAssignmentSource } from '../../services/campusAssignmentSource';

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

export function campusAssignmentDisplayTitle(value: string): string {
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
  const title = campusAssignmentDisplayTitle(input.assignment.title);
  const matches = snapshot.assignments.items.filter((row) =>
    campusAssignmentDisplayTitle(row.title) === title &&
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

const normalizeTitle = campusAssignmentDisplayTitle;

export function knownReminderSource(input: {
  scope: CampusReminderScope; step: ReminderAssignment; snapshot?: CampusSenseSnapshot | null;
}) {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.userId !== input.scope.uid || snapshot.schoolId !== input.scope.schoolId ||
      snapshot.assignments.status !== 'available') return null;
  const matches = snapshot.assignments.items.filter((row) =>
    normalizeTitle(row.title) === input.step.title && row.dueAt === input.step.dueAt &&
    (row.groupName || '') === (input.step.groupName || ''));
  return matches.length === 1 ? parseCampusAssignmentSource(matches[0].source) : null;
}

export function reminderCandidate(snapshot: CampusSenseSnapshot, req: { step: ReminderAssignment }) {
  if (snapshot.assignments.status !== 'available') return undefined;
  const item = snapshot.assignments.items.find((assignment) =>
    normalizeTitle(assignment.title) === req.step.title &&
    assignment.dueAt === req.step.dueAt &&
    (assignment.groupName || '') === (req.step.groupName || ''));
  return item;
}
