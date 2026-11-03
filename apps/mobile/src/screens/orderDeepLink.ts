/** 學生訂單通知深連：以 orderId 標示列表中的那一筆。 */

const ORDER_ID = /^[\w.-]{1,128}$/;

export const ORDER_FOCUS_MISSING =
  '找不到這筆訂單。可能已不在目前校園範圍，或尚未同步。請下拉更新或從訂單列表選擇其他訂單。';

export function parseOrderFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !ORDER_ID.test(id)) return null;
  return id;
}

export function resolveOrderFocus(
  orderIds: readonly string[],
  focusId: string | null,
): { found: boolean; missing: boolean } {
  if (!focusId) return { found: false, missing: false };
  return orderIds.includes(focusId)
    ? { found: true, missing: false }
    : { found: false, missing: true };
}
