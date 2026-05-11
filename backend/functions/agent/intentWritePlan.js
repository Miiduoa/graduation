'use strict';

/**
 * intent（與 classifyIntent / executeCampusAssistantCore 一致）→ 寫入工具計畫。
 * requiresConfirmation === true：prefetch 後僅記錄 deferred，須 executeAgentWrite 等路徑在使用者確認後執行。
 * requiresConfirmation === false：prefetch 後可自動 runTool（需可靠 buildInput）。
 *
 * @typedef {{ toolName: string, requiresConfirmation: boolean, buildInput?: (args: {
 *   lastUserMessage: string,
 *   context: Record<string, unknown>,
 *   prefetched: Record<string, unknown>,
 * }) => Record<string, unknown> | null }} IntentWritePlan
 */

/** @type {Record<string, IntentWritePlan>} */
const INTENT_WRITE_PLANS = {
  leave_request: {
    toolName: 'submitLeaveRequest',
    requiresConfirmation: true,
  },
  reserve_seat: {
    toolName: 'reserveSeat',
    requiresConfirmation: true,
  },
  borrow_book: {
    toolName: 'borrowBook',
    requiresConfirmation: true,
  },
  submit_repair_request: {
    toolName: 'submitRepairRequest',
    requiresConfirmation: true,
  },
  wash_reserve: {
    toolName: 'reserveWashingMachine',
    requiresConfirmation: true,
  },
  food_order: {
    toolName: 'createOrder',
    requiresConfirmation: true,
  },
};

/**
 * @param {string} intentName
 * @returns {IntentWritePlan | null}
 */
function getIntentWritePlan(intentName) {
  if (!intentName || typeof intentName !== 'string') return null;
  return INTENT_WRITE_PLANS[intentName] ?? null;
}

module.exports = { getIntentWritePlan, INTENT_WRITE_PLANS };
