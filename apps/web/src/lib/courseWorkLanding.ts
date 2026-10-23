import { sanitizeInternalPath } from './navigation';

export const COURSE_WORK_LANDING_ATTR = 'data-course-work-landed';
export const COURSE_WORK_SCROLL_MARGIN = '48px';
export const COURSE_WORK_MISSING_ASSIGNMENT =
  '找不到這份作業。可能已被老師刪除，或你沒有查看權限。請從作業列表選擇其他作業。';
export const COURSE_WORK_MISSING_QUIZ =
  '找不到這份測驗。可能已被老師刪除，或你沒有查看權限。請從測驗列表選擇其他測驗。';
export const COURSE_WORK_OPEN_ASSIGNMENT = '前往這份作業';
export const COURSE_WORK_OPEN_QUIZ = '前往這份測驗';
export const COURSE_WORK_OPEN_COURSE = '開啟課程';

const ID = /^[\w.-]{1,200}$/;
const NUNI_COURSE = /^cw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CourseWorkKind = 'assignment' | 'quiz';

export type CourseWorkLink = {
  kind: CourseWorkKind;
  id: string;
};

export function parseCourseWorkHash(hash: string | null | undefined): CourseWorkLink | null {
  const value = (hash || '').replace(/^#/, '');
  const match = /^(assignment|quiz)-(.+)$/.exec(value);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    return ID.test(id) ? { kind: match[1] as CourseWorkKind, id } : null;
  } catch {
    return null;
  }
}

export function courseWorkElementId(kind: CourseWorkKind, id: string): string {
  return `${kind}-${id}`;
}

export function textId(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    !ID.test(value)
  ) {
    return null;
  }
  return value;
}

function isQuizFlag(data: Record<string, unknown>): boolean {
  return (
    data.isQuiz === true ||
    data.isQuiz === 'true' ||
    data.kind === 'quiz' ||
    data.type === 'quiz' ||
    data.category === 'exam'
  );
}

function safeCourseWorkHref(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const safe = sanitizeInternalPath(value, '');
  if (!safe) return null;
  try {
    const url = new URL(safe, 'https://campus.local');
    const coursePath =
      /^\/course\/[^/]+$/.test(url.pathname) || /^\/classroom\/course\/[^/]+$/.test(url.pathname);
    return coursePath && /^#(assignment|quiz)-.+/.test(url.hash) ? safe : null;
  } catch {
    return null;
  }
}

export function isCourseWorkPath(pathname: string): boolean {
  return /^\/course\/[^/]+$/.test(pathname) || /^\/classroom\/course\/cw_[0-9a-f-]{36}$/i.test(pathname);
}

export function isAssignmentNotificationType(type: string | null | undefined): boolean {
  return (
    type === 'assignment' ||
    type === 'assignment_due' ||
    type === 'homework' ||
    type === 'quiz'
  );
}

export function courseWorkHrefFromData(
  data: Record<string, unknown> | null | undefined,
  type?: string | null,
): string | null {
  const row = data && typeof data === 'object' ? data : {};
  const explicit = safeCourseWorkHref(row.href) || safeCourseWorkHref(row.url);
  if (explicit) return explicit;
  const courseId = textId(row.workspaceId) || textId(row.courseId) || textId(row.groupId);
  const quizId = textId(row.quizId);
  const assignmentId = textId(row.assignmentId);
  const kind: CourseWorkKind =
    type === 'quiz' || quizId || isQuizFlag(row) ? 'quiz' : 'assignment';
  const workId = kind === 'quiz' ? quizId || assignmentId : assignmentId || quizId;
  if (!courseId || !workId) return null;
  const path = coursePathFromId(courseId);
  return path ? `${path}#${kind}-${encodeURIComponent(workId)}` : null;
}

function coursePathFromId(courseId: string): string | null {
  const path = NUNI_COURSE.test(courseId)
    ? `/classroom/course/${encodeURIComponent(courseId)}`
    : `/course/${encodeURIComponent(courseId)}`;
  const safe = sanitizeInternalPath(path, '');
  if (!safe) return null;
  try {
    const url = new URL(safe, 'https://campus.local');
    return isCourseWorkPath(url.pathname) && !url.hash ? url.pathname : null;
  } catch {
    return null;
  }
}

export function courseHrefFromData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const row = data && typeof data === 'object' ? data : {};
  const courseId = textId(row.workspaceId) || textId(row.courseId) || textId(row.groupId);
  return courseId ? coursePathFromId(courseId) : null;
}

export function courseWorkOpenLabel(href: string): string {
  try {
    const url = new URL(href, 'https://campus.local');
    if (!url.hash) return COURSE_WORK_OPEN_COURSE;
    return parseCourseWorkHash(url.hash)?.kind === 'quiz'
      ? COURSE_WORK_OPEN_QUIZ
      : COURSE_WORK_OPEN_ASSIGNMENT;
  } catch {
    return COURSE_WORK_OPEN_ASSIGNMENT;
  }
}

export function landOnCourseWork(id: string): boolean {
  if (typeof document === 'undefined') return false;
  document.querySelectorAll(`[${COURSE_WORK_LANDING_ATTR}="true"]`).forEach((node) => {
    node.removeAttribute(COURSE_WORK_LANDING_ATTR);
  });
  const element = document.getElementById(id);
  if (!element) return false;
  element.setAttribute(COURSE_WORK_LANDING_ATTR, 'true');
  element.scrollIntoView?.({ block: 'start' });
  if (typeof element.focus === 'function') element.focus({ preventScroll: true });
  return true;
}
