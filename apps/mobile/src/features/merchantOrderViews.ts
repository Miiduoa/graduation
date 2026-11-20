import type { Order } from '../data/types';

/** 待接單：還沒接的單（含待給號碼）；出餐：接了、還沒取餐的單。同一張單只會在其中一邊 */
export type MerchantOrderView = 'pending' | 'kitchen';

const VIEW_STATUSES: Record<MerchantOrderView, ReadonlyArray<Order['status']>> = {
  pending: ['pending'],
  kitchen: ['confirmed', 'preparing', 'ready'],
};

export const MERCHANT_VIEW_LABELS: Record<MerchantOrderView, string> = {
  pending: '待接單',
  kitchen: '出餐',
};

export function ordersForView(orders: ReadonlyArray<Order>, view: MerchantOrderView): Order[] {
  return orders.filter((order) => VIEW_STATUSES[view].includes(order.status));
}

export function countOrdersByView(orders: ReadonlyArray<Order>): Record<MerchantOrderView, number> {
  return {
    pending: ordersForView(orders, 'pending').length,
    kitchen: ordersForView(orders, 'kitchen').length,
  };
}

/** 分頁標題：「待接單 3」「出餐 2」；還沒讀到資料就只顯示名稱 */
export function merchantTabLabel(view: MerchantOrderView, count: number | null): string {
  return count === null ? MERCHANT_VIEW_LABELS[view] : `${MERCHANT_VIEW_LABELS[view]} ${count}`;
}
