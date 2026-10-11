/**
 * 取餐號碼怎麼顯示（學生端、店家端共用）。
 *
 * 號碼只認伺服器發的；沒拿到就顯示「號碼還沒拿到，請到櫃台確認。」和這筆訂單的
 * 下單時間、品項，讓學生拿去櫃台給店家看。不在手機上自己算號碼。
 * 時間一律用台灣時間（固定 +8，不靠裝置時區），寫成「10 月 13 日（二）12:05」。
 */

export const PICKUP_NUMBER_PENDING_TEXT = '號碼還沒拿到，請到櫃台確認。';
export const PICKUP_NUMBER_PENDING_LABEL = '待確認';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export type PickupOrderItem = { name: string; quantity: number };

export type PickupNumberView =
  | { state: 'assigned'; number: number; text: string }
  | { state: 'pending'; label: string; text: string; detail: string };

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

export function describePickupNumber(order: {
  queueNumber?: unknown;
  createdAt?: unknown;
  items?: ReadonlyArray<PickupOrderItem> | null;
}): PickupNumberView {
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
