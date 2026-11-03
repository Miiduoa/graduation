export type CourseDirectoryFilter = 'all' | 'studying' | 'teaching' | 'archived';
export type StudyAgendaFilter =
  | 'pending'
  | 'soon'
  | 'overdue'
  | 'feedback'
  | 'submitted'
  | 'closed'
  | 'all';

const contextKeys = ['campus', 'schoolId', 'school', 'q', 'courses', 'task', 'taskCourse'] as const;

export function courseDirectoryFilter(value: string | null): CourseDirectoryFilter {
  return value === 'studying' || value === 'teaching' || value === 'archived' ? value : 'all';
}

export function studyAgendaFilter(value: string | null): StudyAgendaFilter {
  return value === 'soon' ||
    value === 'overdue' ||
    value === 'feedback' ||
    value === 'submitted' ||
    value === 'closed' ||
    value === 'all'
    ? value
    : 'pending';
}

export function classroomContext(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of contextKeys) {
    const value = params.get(key);
    if (value) result.set(key, value.slice(0, 160));
  }
  return result;
}

export function classroomDirectoryHref(
  context: string,
  destination: 'courses' | 'bookmarks' = 'courses',
): string {
  const query = classroomContext(new URLSearchParams(context)).toString();
  const path = destination === 'bookmarks' ? '/classroom/material-bookmarks' : '/classroom';
  return `${path}${query ? `?${query}` : ''}`;
}

export function classroomCourseHref(
  id: string,
  context: string,
  activity?: { kind: 'assignment' | 'quiz' | 'material'; id: string },
): string {
  const params = classroomContext(new URLSearchParams(context));
  if (activity)
    params.set(
      'view',
      activity.kind === 'assignment'
        ? 'assignments'
        : activity.kind === 'quiz'
          ? 'quizzes'
          : 'materials',
    );
  const query = params.toString();
  return `/classroom/course/${encodeURIComponent(id)}${query ? `?${query}` : ''}${activity ? `#${activity.kind}-${encodeURIComponent(activity.id)}` : ''}`;
}

export function legacyCourseHref(
  id: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  if (!params.has('view')) {
    const previous = params.get('tab');
    params.set(
      'view',
      previous === 'course'
        ? 'outline'
        : previous === 'members' || previous === 'affiliation'
          ? 'members'
          : 'attendance',
    );
  }
  return `/classroom/course/${encodeURIComponent(id)}?${params.toString()}`;
}

export function replaceStudyQuery(
  key: 'q' | 'courses' | 'task' | 'taskCourse',
  value: string,
  defaultValue = '',
) {
  const url = new URL(window.location.href);
  if (!value || value === defaultValue) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function courseSearchKey(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
}
