/** 老師作業繳交列表深連：以 assignmentId 網址參數開啟既有繳交列表。 */

const ASSIGNMENT_ID = /^[\w.-]{1,128}$/;

export const ASSIGNMENT_FOCUS_MISSING =
  '找不到這份作業的繳交列表。作業可能已刪除，或目前課程列表尚未包含它。請從下方作業列表選擇其他作業。';

export function parseAssignmentFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !ASSIGNMENT_ID.test(id)) {
    return null;
  }
  return id;
}

/** 老師課程頁：以既有 query 表示要打開的繳交列表，可與通知深連共用。 */
export function teacherSubmissionListHref(
  courseId: string,
  assignmentId: string,
  currentSearch = '',
): string {
  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch,
  );
  params.set('assignmentId', assignmentId);
  const query = params.toString();
  return `/teacher/course/${encodeURIComponent(courseId)}${query ? `?${query}` : ''}`;
}

export function classroomTeacherSubmissionHref(
  workspaceId: string,
  assignmentId: string,
  currentSearch = '',
): string {
  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch,
  );
  params.set('view', 'assignments');
  params.set('assignmentId', assignmentId);
  params.set('submissions', '1');
  const query = params.toString();
  return `/classroom/course/${encodeURIComponent(workspaceId)}?${query}#assignment-${encodeURIComponent(assignmentId)}`;
}

export function resolveAssignmentFocus(
  assignmentIds: readonly string[],
  focusId: string | null,
): { found: boolean; missing: boolean } {
  if (!focusId) return { found: false, missing: false };
  return assignmentIds.includes(focusId)
    ? { found: true, missing: false }
    : { found: false, missing: true };
}
