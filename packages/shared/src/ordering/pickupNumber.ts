/**
 * 取餐號碼怎麼顯示（學生端、店家端共用）。
 *
 * 號碼只認伺服器發的；沒拿到就顯示「號碼還沒拿到，請到櫃台確認。」和這筆訂單的
 * 下單時間、品項，讓學生拿去櫃台給店家看。不在手機上自己算號碼。
 * 時間一律用台灣時間（固定 +8，不靠裝置時區），寫成「10 月 13 日（二）12:05」。
 * 沒號碼的狀態一律叫「待給號碼」；訂單被取消就不再顯示號碼。
 */

export const PICKUP_NUMBER_PENDING_TEXT = '號碼還沒拿到，請到櫃台確認。';
export const PICKUP_NUMBER_PENDING_LABEL = '待給號碼';
export const ORDER_CANCELLED_BY_SHOP_TEXT = '這張單店家取消了';
export const ORDER_CANCELLED_BY_CUSTOMER_TEXT = '你取消了這張單';
export const ORDER_NO_SHOW_TEXT = '超過取餐時間沒取，這張單取消了';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export type PickupOrderItem = { name: string; quantity: number };

export type PickupNumberView =
  | { state: 'assigned'; number: number; text: string }
  | { state: 'pending'; label: string; text: string; detail: string }
  | { state: 'cancelled'; text: string };

function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === 'function') return toDate(maybe.toDate());
  if (typeof maybe.seconds === 'number') return toDate(maybe.seconds * 1000);
  return null;
}

/** 台灣時間「10 月 13 日（二）12:05」；時間不明就回空字串 */
export function formatTaipeiOrderTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日（${WEEKDAYS[t.getUTCDay()]}）${hh}:${mm}`;
}

export function formatPickupItems(items: ReadonlyArray<PickupOrderItem> | null | undefined): string {
  return (items ?? [])
    .filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .map((item) => `${item.name.trim()} ×${Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1}`)
    .join('、');
}

export function isRealPickupNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 學生、店家看到同一個短代碼：訂單編號最後 6 碼 */
export function shortOrderCode(orderId: unknown): string {
  if (typeof orderId !== 'string') return '';
  const clean = orderId.trim();
  return clean ? clean.slice(-6).toUpperCase() : '';
}

export function formatShortOrderCode(orderId: unknown): string {
  const code = shortOrderCode(orderId);
  return code ? `訂單末 6 碼 ${code}` : '';
}

/** 取消的訂單給學生看的那一句；店家拒單、逾時沒接都算店家取消 */
export function describeCancelledOrder(order: {
  cancelledBy?: unknown;
  cancelReason?: unknown;
}): string {
  if (order.cancelledBy === 'customer') return ORDER_CANCELLED_BY_CUSTOMER_TEXT;
  if (order.cancelReason === 'system_no_show') return ORDER_NO_SHOW_TEXT;
  return ORDER_CANCELLED_BY_SHOP_TEXT;
}

export function describePickupNumber(order: {
  queueNumber?: unknown;
  createdAt?: unknown;
  items?: ReadonlyArray<PickupOrderItem> | null;
  status?: unknown;
  cancelledBy?: unknown;
  cancelReason?: unknown;
}): PickupNumberView {
  // 取消的單不顯示號碼（就算之前給過號碼）
  if (order.status === 'cancelled') return { state: 'cancelled', text: describeCancelledOrder(order) };
  if (isRealPickupNumber(order.queueNumber)) {
    return { state: 'assigned', number: order.queueNumber, text: `取餐號碼 ${order.queueNumber}` };
  }
  const detail = [formatTaipeiOrderTime(order.createdAt), formatPickupItems(order.items)]
    .filter(Boolean)
    .join('・');
  return {
    state: 'pending',
    label: PICKUP_NUMBER_PENDING_LABEL,
    text: PICKUP_NUMBER_PENDING_TEXT,
    detail,
  };
}
