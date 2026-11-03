/** 點名通知深連：以 sessionId 打開場次；找不到時友善提示。 */

const SESSION_ID = /^[\w.-]{1,128}$/;

export const SESSION_FOCUS_MISSING =
  '找不到這一場點名。場次可能已結束，或連結已失效。請回到課程確認最新場次。';

export function parseSessionFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !SESSION_ID.test(id)) return null;
  return id;
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
