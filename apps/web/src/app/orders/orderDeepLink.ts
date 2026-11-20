/** 訂單通知深連：讀取 orderId 並定位列表中的那一筆。 */

const ORDER_ID = /^[\w.-]{1,128}$/;

export const ORDER_FOCUS_MISSING =
  '找不到這筆訂單。請確認目前選擇的校園及登入帳號。';

export function parseOrderFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !ORDER_ID.test(id)) return null;
  return id;
}

export function orderFocusElementId(orderId: string): string {
  return `order-${orderId}`;
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

export function landOnOrder(orderId: string): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.getElementById(orderFocusElementId(orderId));
  if (!element) return false;
  element.setAttribute('data-order-focused', 'true');
  element.scrollIntoView?.({ block: 'start' });
  if (typeof element.focus === 'function') element.focus({ preventScroll: true });
  return true;
}
