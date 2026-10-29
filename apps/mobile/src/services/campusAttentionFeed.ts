import type { CampusSenseSnapshot } from './campusSenseSnapshot';
import { validCampusSenseSnapshot } from './campusSenseSnapshot';
import { assignmentDueTime } from './campusAssignmentQuery';

type Assignment = CampusSenseSnapshot['assignments']['items'][number];
export type CampusAttentionPriority = 'due-soon' | 'past-due' | 'this-week' | 'unknown-date' | 'later';

export interface CampusAttentionItem {
  key: string;
  assignment: Assignment;
  priority: CampusAttentionPriority;
}

export interface CampusAttentionFeed {
  checkedAt: string;
  items: CampusAttentionItem[];
  remainingVisible: number;
  missingFromSource: number;
  incomplete: boolean;
}

/**
 * An immediate, offline next-step summary of an explicitly authorized snapshot.
 * This is not a background monitor and never infers submission state from deadlines.
 * Authorization, school scope and source expiry must still hold when an action is pressed.
 */
export function buildCampusAttentionFeed(input: {
  snapshot?: CampusSenseSnapshot | null;
  scope: { uid: string; schoolId: string };
  now: number;
}): CampusAttentionFeed | null {
  if (!Number.isFinite(input.now)) return null;
  const snapshot = validCampusSenseSnapshot(input.snapshot, input.scope, input.now);
  if (!snapshot || snapshot.assignments.status !== 'available') return null;

  const weight: Record<CampusAttentionPriority, number> = {
    'due-soon': 0, 'past-due': 1, 'this-week': 2, 'unknown-date': 3, later: 4,
  };
  const DAY_MS = 86_400_000;
  const rows = snapshot.assignments.items.map((assignment, index) => {
    const due = assignmentDueTime(assignment.dueAt);
    const priority: CampusAttentionPriority =
      due === null ? 'unknown-date' :
      due < input.now ? 'past-due' :
      due - input.now <= DAY_MS ? 'due-soon' :
      due - input.now <= 7 * DAY_MS ? 'this-week' : 'later';
    return {
      key: JSON.stringify([
        assignment.source?.groupId ?? null,
        assignment.source?.assignmentId ?? null,
        index,
      ]),
      assignment,
      priority,
      due,
      index,
    };
  });
  rows.sort((a, b) => {
    if (weight[a.priority] !== weight[b.priority]) return weight[a.priority] - weight[b.priority];
    if (a.due !== null && b.due !== null && a.due !== b.due) {
      // For overdue work, check the most recently expired first.
      return a.priority === 'past-due' ? b.due - a.due : a.due - b.due;
    }
    return a.index - b.index;
  });

  const missingFromSource = Math.max(0, (snapshot.assignments.count ?? rows.length) - rows.length);
  return {
    checkedAt: snapshot.checkedAt,
    items: rows.slice(0, 3).map(({ key, assignment, priority }) => ({ key, assignment, priority })),
    remainingVisible: Math.max(0, rows.length - 3),
    missingFromSource,
    incomplete: missingFromSource > 0 || snapshot.assignments.coverage?.complete === false,
  };
}
