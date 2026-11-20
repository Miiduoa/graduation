/** 點名／直播課深連：讀取 sessionId 並打開對應場次。 */

const SESSION_ID = /^[\w.-]{1,128}$/;

export const SESSION_FOCUS_MISSING =
  '找不到這一場點名。場次可能已結束並移出近期列表，或連結已失效。請從點名紀錄選擇其他場次。';

export function parseSessionFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !SESSION_ID.test(id)) return null;
  return id;
}

export function sessionFocusElementId(sessionId: string): string {
  return `attendance-session-${sessionId}`;
}

export function resolveSessionFocus(
  sessionIds: readonly string[],
  focusId: string | null,
): { found: boolean; missing: boolean } {
  if (!focusId) return { found: false, missing: false };
  return sessionIds.includes(focusId)
    ? { found: true, missing: false }
    : { found: false, missing: true };
}

export function landOnSession(sessionId: string): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.getElementById(sessionFocusElementId(sessionId));
  if (!element) return false;
  element.setAttribute('data-session-focused', 'true');
  element.scrollIntoView?.({ block: 'start' });
  if (typeof element.focus === 'function') element.focus({ preventScroll: true });
  return true;
}
