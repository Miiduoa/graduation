import type { NuniAssignment, NuniQuiz, NuniWorkspace } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';

export type CourseActivity = NuniAssignment | NuniQuiz;
export type ActivityFilter = 'all' | 'pending' | 'submitted';
export type CourseListFilter = 'all' | 'student' | 'teaching' | 'archived';

function searchWords(value: string): string[] {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW').split(/\s+/).filter(Boolean);
}

export function matchesCourseSearch(course: NuniWorkspace, query: string): boolean {
  const title = course.title.normalize('NFKC').toLocaleLowerCase('zh-TW');
  return searchWords(query).every((word) => title.includes(word));
}

export function matchesCourseListFilter(course: NuniWorkspace, filter: CourseListFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'archived') return course.state === 'archived';
  return (
    course.state === 'active' &&
    (filter === 'student' ? course.memberRole === 'student' : course.memberRole !== 'student')
  );
}

export function matchesActivitySearch(item: CourseActivity, query: string): boolean {
  const text = [
    item.title,
    item.unitTitle,
    'instructions' in item ? item.instructions : item.prompt,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW');
  return searchWords(query).every((word) => text.includes(word));
}

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
      (left.dueAt ? (parseTaipeiInstant(left.dueAt) ?? Infinity) : Infinity) -
        (right.dueAt ? (parseTaipeiInstant(right.dueAt) ?? Infinity) : Infinity) || 0
    );
  });
}
