/** 學生訂單通知深連：以 orderId 標示列表中的那一筆。 */

const ORDER_ID = /^[\w.-]{1,128}$/;

export const ORDER_FOCUS_MISSING =
  '找不到這筆訂單。請確認目前的帳號與學校，或稍候再查看同步結果。';

export function parseOrderFocusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id === '.' || id === '..' || id.includes('/') || !ORDER_ID.test(id)) return null;
  return id;
}
