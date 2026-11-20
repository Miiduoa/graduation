export const FOOD_POLL_MS = 10_000;
export const FOOD_TERMINAL_STATES = new Set([
  'fulfilled',
  'canceled',
  'rejected',
  'payment-expired',
]);

export function isFoodOrderInProgress(state: string): boolean {
  return !FOOD_TERMINAL_STATES.has(state);
}

type CustomerNextStepInput = {
  state: string;
  allowedActions: readonly string[];
  // The order list omits pickup credentials and payment sessions.
  mode?: 'summary' | 'detail';
  pickup?: {
    allowedActions: readonly string[];
    credential?: { expiresAt: string } | null;
  };
  payment?: {
    progress: string;
    allowedActions: readonly string[];
    expiresAt: string;
  } | null;
  now?: number;
};

export function canShowPickupCredential(
  order: Pick<CustomerNextStepInput, 'allowedActions' | 'pickup'>,
  now: number,
): boolean {
  const pickup = order.pickup;
  return (
    order.allowedActions.includes('show-pickup-credential') &&
    !!pickup?.credential &&
    pickup.allowedActions.includes('present-one-time-token') &&
    Date.parse(pickup.credential.expiresAt) > now
  );
}

export function foodCustomerNextStep(input: CustomerNextStepInput): string {
  const now = input.now ?? Date.now();
  if (input.state === 'ready') {
    if (input.mode === 'summary') return '餐點好了，查看訂單並出示取餐憑證。';
    if (canShowPickupCredential(input, now)) return '餐點好了。請到店出示取餐憑證。';
    return '餐點好了。請先更新這筆訂單，再出示取餐憑證。';
  }
  if (input.state === 'fulfilled') return '這筆訂單已取餐完成。';
  if (input.state === 'canceled') return '這筆訂單已取消。';
  if (input.state === 'rejected') return '店家未能接單。';
  if (input.state === 'payment-expired') return '這筆訂單已結束。';
  if (input.state === 'cancellation-pending-refund' || input.state === 'rejection-pending-refund') {
    return '退款處理中，完成後會更新這筆訂單。';
  }
  if (input.state === 'preparing') return '店家正在備餐，好了後會更新取餐狀態。';
  if (input.state === 'accepted') return '店家已接單，正在安排備餐。';
  if (input.state === 'paid') return '已付款，等待店家接單。';

  if (input.state === 'payment-pending') {
    if (input.mode === 'summary') return '查看訂單，確認付款進度與方式。';
    const payment = input.payment;
    if (
      payment &&
      (payment.progress === 'authorized-awaiting-settlement' || payment.progress === 'paid')
    ) {
      return '付款確認中，請稍候或更新這筆訂單。';
    }
    if (
      input.allowedActions.includes('create-payment-session') &&
      (!payment || payment.allowedActions.includes('start-over') || payment.progress === 'failed')
    ) {
      return '請選擇付款方式，完成線上結帳。';
    }
    if (
      payment &&
      payment.allowedActions.includes('open-checkout') &&
      Date.parse(payment.expiresAt) > now
    ) {
      return '請前往安全付款頁面完成付款。';
    }
    if (payment?.progress === 'awaiting-offline-payment') {
      return '請到櫃檯向店員完成付款；店員收款後才會更新訂單。';
    }
    return '付款尚未完成。請依畫面指示結帳，或到櫃檯向店員確認。';
  }

  return '請查看訂單狀態，或更新這筆訂單。';
}
