import type { CampusSenseSnapshot } from './campusSenseSnapshot';
import { validCampusSenseSnapshot } from './campusSenseSnapshot';
import { assignmentDueTime } from './campusAssignmentQuery';
import { parseCampusAssignmentSource } from './campusAssignmentSource';
import type { CampusPlanPriority, CampusPlanStep } from './offlineCampusPlanner';

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


const PLAN_PRIORITY: Record<CampusAttentionPriority, CampusPlanPriority> = {
  'due-soon': 'urgent',
  'past-due': 'overdue',
  'this-week': 'soon',
  'unknown-date': 'verify',
  later: 'normal',
};

/**
 * Only an authorized, sourced assignment with an explicit timezone may be
 * proposed for a local reminder. Scheduling itself rechecks the live identity
 * and snapshot expiry and still requires the student's confirmation.
 */
export function buildCampusAttentionReminderStep(
  item: CampusAttentionItem,
  snapshot: CampusSenseSnapshot,
): CampusPlanStep | null {
  const dueAt = item.assignment.dueAt;
  if ((item.priority !== 'due-soon' && item.priority !== 'this-week') ||
      !dueAt || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(dueAt) ||
      !parseCampusAssignmentSource(item.assignment.source) ||
      snapshot.assignments.status !== 'available') return null;

  // The OS reminder identifier includes title/course/due time, not source IDs.
  // Never propose two different source records that would collide on that key.
  const normalizedTitle = item.assignment.title.replace(/\s+/g, ' ').trim().slice(0, 130);
  const matching = snapshot.assignments.items.filter((assignment) =>
    assignment.title.replace(/\s+/g, ' ').trim().slice(0, 130) === normalizedTitle &&
    assignment.groupName === item.assignment.groupName &&
    assignment.dueAt === dueAt);
  if (matching.length !== 1 || matching[0] !== item.assignment) return null;
  return {
    id: 'attention-' + item.key,
    title: item.assignment.title.replace(/\s+/g, ' ').trim().slice(0, 130),
    detail: '依已授權作業的截止時間設定手機提醒。',
    priority: PLAN_PRIORITY[item.priority],
    evidence: 'authorized-assignments',
    route: '/classroom',
    dueAt,
    groupName: item.assignment.groupName,
  };
}
