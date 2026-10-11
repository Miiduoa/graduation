'use strict';

const { HttpsError } = require('firebase-functions/v2/https');

/**
 * 線上點餐總開關（ONLINE_ORDERING_ENABLED）。
 *
 * 正式環境沒設就是關：建單、助理下單、發號碼一律擋下，不會留下任何訂單。
 * 本機模擬器和單元測試沒設時預設開，讓既有的點餐測試照跑；要測關的情況就明確設成 false。
 * App 上架、店家準備好之後，再在 functions 的環境設定把它設成 true。
 */
const ONLINE_ORDERING_OFF_MESSAGE = '目前還不能線上點餐';

function isOnlineOrderingEnabled(env = process.env) {
  const raw = typeof env.ONLINE_ORDERING_ENABLED === 'string' ? env.ONLINE_ORDERING_ENABLED.trim() : '';
  if (raw) return /^(1|true|on|yes)$/i.test(raw);
  return env.FUNCTIONS_EMULATOR === 'true' || Boolean(env.JEST_WORKER_ID);
}

function onlineOrderingOffError() {
  return new HttpsError('failed-precondition', ONLINE_ORDERING_OFF_MESSAGE, {
    orderOutcome: 'not_created',
    reason: 'online_ordering_off',
  });
}

function assertOnlineOrderingEnabled(env = process.env) {
  if (!isOnlineOrderingEnabled(env)) throw onlineOrderingOffError();
}

const ORDER_TOOL_NAMES = new Set(['createOrder', 'proposeOrder', 'aiOrderFood', 'assignQueueNumber']);

/** 助理排進待辦的動作是不是下單（例如 queue_action 帶 toolName: 'createOrder'）。 */
function isOrderAssistantAction(data) {
  const params = data && typeof data.params === 'object' && data.params ? data.params : {};
  const toolName = String(params.toolName || data?.toolName || '').trim();
  return ORDER_TOOL_NAMES.has(toolName);
}

module.exports = {
  ONLINE_ORDERING_OFF_MESSAGE,
  isOrderAssistantAction,
  isOnlineOrderingEnabled,
  assertOnlineOrderingEnabled,
  onlineOrderingOffError,
};
