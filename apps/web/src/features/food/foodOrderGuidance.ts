export { foodCustomerNextStep, isFoodOrderInProgress } from '@campus/shared/src/foodOrderGuidance';

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
