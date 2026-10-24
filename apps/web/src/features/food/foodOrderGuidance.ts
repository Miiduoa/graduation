import { FOOD_TERMINAL_STATES } from './foodPersistence';

/** Customer-facing order still needs attention (pay, wait, pick up). */
export function isFoodOrderInProgress(state: string): boolean {
  return !FOOD_TERMINAL_STATES.has(state);
}

type CustomerNextStepInput = {
  state: string;
  allowedActions: readonly string[];
  /** List rows lack pickup/payment projections; detail uses full checks. */
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

/**
 * One concrete next step for the student. Uses server allowedActions; does not invent
 * payment or pickup capabilities the API did not grant.
 */
export function foodCustomerNextStep(input: CustomerNextStepInput): string {
  const mode = input.mode ?? 'detail';
  const now = input.now ?? Date.now();
  const actions = new Set(input.allowedActions);
  const pickupActions = new Set(input.pickup?.allowedActions ?? []);
  const token = input.pickup?.credential;
  const canPresent =
    actions.has('show-pickup-credential') &&
    pickupActions.has('present-one-time-token') &&
    !!token &&
    Date.parse(token.expiresAt) > now;

  if (input.state === 'ready') {
    if (mode === 'summary') return '餐點好了，查看訂單並出示取餐憑證。';
    if (canPresent) return '餐點好了。請到店出示取餐憑證。';
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
    if (mode === 'summary') return '查看訂單，確認付款進度與方式。';
    const payment = input.payment;
    if (
      payment &&
      (payment.progress === 'authorized-awaiting-settlement' || payment.progress === 'paid')
    ) {
      return '付款確認中，請稍候或更新這筆訂單。';
    }
    if (
      actions.has('create-payment-session') &&
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

export type MerchantOrderBucket = 'incoming' | 'active';

/** Incoming = accept/pay/refund desk work; active = prep and pickup. */
export function merchantOrderBucket(order: {
  state: string;
  allowedActions: readonly string[];
}): MerchantOrderBucket {
  const actions = new Set(order.allowedActions);
  if (
    actions.has('record-counter-payment') ||
    actions.has('accept') ||
    actions.has('reject') ||
    actions.has('confirm-counter-refund')
  ) {
    return 'incoming';
  }
  return 'active';
}

export function merchantOrderNextStep(order: {
  state: string;
  allowedActions: readonly string[];
}): string {
  const actions = new Set(order.allowedActions);
  if (actions.has('record-counter-payment')) return '先登記櫃檯已收款項';
  if (actions.has('accept') || actions.has('reject')) return '確認是否接單';
  if (actions.has('confirm-counter-refund')) return '確認已退還款項';
  if (actions.has('fulfill-pickup')) return '核對取餐憑證並交付';
  if (actions.has('mark-ready')) return '備妥後標記可取餐';
  if (actions.has('start-preparation')) return '開始備餐';
  if (actions.has('cancel-accepted')) return '如無法完成，可取消已接訂單';
  if (order.state === 'ready') return '等待顧客取餐';
  if (order.state === 'preparing') return '備餐進行中';
  if (order.state === 'accepted') return '等待開始備餐';
  return '查看訂單內容';
}
