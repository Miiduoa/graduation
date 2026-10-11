import type { NuniAssignment, NuniQuiz, NuniWorkspace } from '@campus/shared/src/nuni';

export type CourseActivity = NuniAssignment | NuniQuiz;
export type ActivityFilter = 'all' | 'pending' | 'submitted';

export function hasActivityReceipt(item: CourseActivity): boolean {
  return Boolean('instructions' in item ? item.mySubmission : item.myResponse);
}

export function isPendingActivity(item: CourseActivity, course: NuniWorkspace): boolean {
  return (
    course.memberRole === 'student' &&
    course.state === 'active' &&
    item.state === 'open' &&
    !hasActivityReceipt(item)
  );
}

export function matchesActivityFilter(
  item: CourseActivity,
  course: NuniWorkspace,
  filter: ActivityFilter,
): boolean {
  if (filter === 'pending') return isPendingActivity(item, course);
  if (filter === 'submitted') return hasActivityReceipt(item);
  return true;
}

export function prioritizeActivities<T extends CourseActivity>(
  items: T[],
  course: NuniWorkspace,
): T[] {
  if (course.memberRole !== 'student' || course.state !== 'active') return items;
  return [...items].sort((left, right) => {
    const pendingLeft = isPendingActivity(left, course);
    const pendingRight = isPendingActivity(right, course);
    if (pendingLeft !== pendingRight) return pendingLeft ? -1 : 1;
    if (!pendingLeft) return 0;
    return (
      (left.dueAt ? Date.parse(left.dueAt) : Infinity) -
        (right.dueAt ? Date.parse(right.dueAt) : Infinity) || 0
    );
  });
}
