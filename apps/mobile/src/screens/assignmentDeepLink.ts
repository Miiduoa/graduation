/** 作業／繳交通知深連：以 assignmentId 定位作業或繳交列表。 */

const ASSIGNMENT_ID = /^[\w.-]{1,128}$/;

export const ASSIGNMENT_FOCUS_MISSING =
  '找不到這份作業。可能已被刪除，或目前帳號沒有查看權限。請從課程作業列表重新選擇。';

export function parseAssignmentFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !ASSIGNMENT_ID.test(id)) {
    return null;
  }
  return id;
}

export function resolveAssignmentFocus(
  assignmentIds: readonly string[],
  focusId: string | null,
  options?: { ready?: boolean },
): { found: boolean; missing: boolean } {
  if (!focusId) return { found: false, missing: false };
  // 資料尚未就緒（載入中／清單仍空且無法確認）時不提示找不到，避免誤報。
  if (options?.ready === false) return { found: false, missing: false };
  return assignmentIds.includes(focusId)
    ? { found: true, missing: false }
    : { found: false, missing: true };
}
