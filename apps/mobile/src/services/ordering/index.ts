/**
 * 訂餐強化模組 — 統一匯出
 *
 * 從 UI / AI / 其他服務引用都從這個 barrel：
 *
 * ```ts
 * import {
 *   placeOrderAtomic,
 *   cancelOrderAtomic,
 *   completeOrderAtomic,
 *   checkAllergens,
 *   getMyPickupCode,
 *   STUDENT_CANCEL_REASONS,
 *   VENDOR_CANCEL_REASONS,
 * } from '../services/ordering';
 * ```
 */

// 型別
export * from './types';

// 過敏原
export {
  getDietaryProfile,
  updateDietaryProfile,
  checkAllergens,
  isValidOverrideToken,
} from './allergens';

// 庫存
export {
  getStock,
  setDailyCap,
  setManualSoldOut,
  reserveStock,
  releaseStock,
  commitSale,
} from './stock';

// 取餐碼
export {
  issuePickupCode,
  getMyPickupCode,
  consumePickupCode,
  revokePickupCode,
} from './pickupCode';

// Wallet hold-capture
export {
  getWalletSummary,
  holdWallet,
  captureWallet,
  releaseWalletHold,
  getHoldById,
  topupLocalWallet,
} from './wallet';

// 取消原因
export {
  STUDENT_CANCEL_REASONS,
  VENDOR_CANCEL_REASONS,
  SYSTEM_CANCEL_REASONS,
  getCancelReasonInfo,
  isStudentReason,
  isVendorReason,
  isSystemReason,
  getReasonsForRole,
} from './cancelReason';

// 退款
export {
  createRefund,
  getRefundsByOrder,
  getRefundsByUser,
  adminMarkRefund,
} from './refund';

// 揪團拆帳
export {
  computeMemberShares,
  holdGroupPayments,
  captureGroupPayments,
  releaseGroupPayments,
} from './groupSplit';

// 稽查連動
export {
  deriveEnforcementAction,
  enforceInspection,
  liftVendorSuspension,
} from './inspection';

// 原子下單 / 取消 / 完成
export {
  placeOrderAtomic,
  cancelOrderAtomic,
  completeOrderAtomic,
  parseHoldIdFromNote,
} from './atomicOrder';

// 訂單超時掃描
export {
  sweepOrderTimeouts,
  resetLocalDailyCaches,
} from './timeoutSweep';
