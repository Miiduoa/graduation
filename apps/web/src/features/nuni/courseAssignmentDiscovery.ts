import type { NuniAssignment, NuniQuiz, NuniWorkspace } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { matchesAssignmentFilter, matchesQuizFilter } from './courseTasks';

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').trim();
}

export function matchesAssignmentSearch(item: NuniAssignment, query: string) {
  return matchesText(query, item.title, item.instructions, item.unitTitle ?? '');
}

export function matchesQuizSearch(item: NuniQuiz, query: string) {
  return matchesText(query, item.title, item.prompt, item.unitTitle ?? '');
}

function matchesText(query: string, ...parts: string[]) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const searchable = normalize(parts.join(' '));
  return words.every((word) => searchable.includes(word));
}

export function prioritizeCourseAssignments(
  assignments: NuniAssignment[],
  workspace: NuniWorkspace,
) {
  if (workspace.memberRole !== 'student' || workspace.state !== 'active') return assignments;
  return prioritize(assignments, (item) => matchesAssignmentFilter(item, workspace, 'pending'));
}

export function prioritizeCourseQuizzes(items: NuniQuiz[], workspace: NuniWorkspace) {
  if (workspace.memberRole !== 'student' || workspace.state !== 'active') return items;
  return prioritize(items, (item) => matchesQuizFilter(item, workspace, 'pending'));
}

function prioritize<T extends { dueAt: string | null }>(
  items: T[],
  isPending: (item: T) => boolean,
) {
  return [...items].sort((left, right) => {
    const leftPending = isPending(left);
    const rightPending = isPending(right);
    if (leftPending !== rightPending) return leftPending ? -1 : 1;
    if (!leftPending) return 0;
    const leftDue = left.dueAt ? (parseTaipeiInstant(left.dueAt) ?? Infinity) : Infinity;
    const rightDue = right.dueAt ? (parseTaipeiInstant(right.dueAt) ?? Infinity) : Infinity;
    return leftDue - rightDue || 0;
  });
}

// The reference deadline helps students prioritize work; it never closes submissions.
export type AssignmentReferenceTiming = 'none' | 'overdue' | 'soon' | 'later';

export function assignmentReferenceTiming(
  item: NuniAssignment,
  workspace: NuniWorkspace,
  now: number | null,
): AssignmentReferenceTiming {
  if (
    now === null ||
    !Number.isFinite(now) ||
    workspace.memberRole !== 'student' ||
    !matchesAssignmentFilter(item, workspace, 'pending')
  )
    return 'none';
  const due = item.dueAt ? parseTaipeiInstant(item.dueAt) : null;
  if (due === null) return 'none';
  if (due < now) return 'overdue';
  return due <= now + 7 * 24 * 60 * 60 * 1000 ? 'soon' : 'later';
}
