/** /classroom 課程作業深連：assignmentId 定位作業；submissions=1 打開繳交列表。 */

import {
  classroomTeacherSubmissionHref,
  parseAssignmentFocusId,
} from '@/components/teaching/assignmentDeepLink';

export const CLASSROOM_ASSIGNMENT_MISSING =
  '找不到這份作業。可能已被老師刪除，或你沒有查看權限。請從作業列表選擇其他作業。';

export const CLASSROOM_TEACHER_SUBMISSION_LINK_LABEL = '開啟繳交列表';

export function parseClassroomDeepLink(search: string): {
  assignmentId: string | null;
  openSubmissions: boolean;
} {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const assignmentId = parseAssignmentFocusId(params.get('assignmentId'));
  const submissions = params.get('submissions');
  const view = params.get('view');
  const openSubmissions =
    submissions === '1' ||
    submissions === 'true' ||
    view === 'submissions';
  return { assignmentId, openSubmissions };
}

export function classroomAssignmentHash(assignmentId: string): string {
  return `#assignment-${encodeURIComponent(assignmentId)}`;
}

export { classroomTeacherSubmissionHref };

/** 在已判定為老師的作業卡（已有「查看繳交內容」按鈕）旁掛上直達繳交列表連結。 */
export function ensureTeacherSubmissionLinks(
  root: ParentNode,
  workspaceId: string,
  currentSearch: string,
): number {
  let added = 0;
  const cards = root.querySelectorAll<HTMLElement>('[id^="assignment-"]');
  for (const card of cards) {
    const assignmentId = card.id.slice('assignment-'.length);
    if (!parseAssignmentFocusId(assignmentId)) continue;
    const openButton = Array.from(card.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('查看繳交內容'),
    );
    if (!openButton) continue;
    const host = openButton.parentElement;
    if (!host) continue;
    if (host.querySelector('[data-teacher-submission-link="true"]')) continue;
    const link = root.ownerDocument?.createElement('a') ?? document.createElement('a');
    link.href = classroomTeacherSubmissionHref(workspaceId, assignmentId, currentSearch);
    link.textContent = CLASSROOM_TEACHER_SUBMISSION_LINK_LABEL;
    link.setAttribute('data-teacher-submission-link', 'true');
    link.setAttribute('data-assignment-id', assignmentId);
    host.append(link);
    added += 1;
  }
  return added;
}

export function openClassroomSubmissionButton(root: ParentNode, assignmentId: string): boolean {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const card =
    (doc?.getElementById(`assignment-${assignmentId}`) as HTMLElement | null) ??
    (root instanceof Element || root instanceof Document
      ? root.querySelector(`[id="assignment-${assignmentId}"]`)
      : null);
  if (!card) return false;
  const openButton = Array.from(card.querySelectorAll('button')).find((button) => {
    const label = button.textContent ?? '';
    return label.includes('查看繳交內容') || label.includes('更新繳交內容');
  });
  if (!openButton || !(openButton instanceof HTMLButtonElement)) return false;
  openButton.click();
  return true;
}
