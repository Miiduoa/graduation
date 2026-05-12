'use strict';

/**
 * 訂餐強化模組 — Cloud Functions 統一匯出
 *
 * 在 backend/functions/index.js 用：
 *   const ordering = require('./ordering');
 *   exports.assignQueueNumber = ordering.assignQueueNumber;
 *   exports.dailyQueueReset = ordering.dailyQueueReset;
 *   exports.walletHold = ordering.walletHold;
 *   exports.walletCapture = ordering.walletCapture;
 *   exports.walletRelease = ordering.walletRelease;
 *   exports.refundCaptured = ordering.refundCaptured;
 *   exports.verifyPickupCode = ordering.verifyPickupCode;
 *   exports.scheduledOrderTimeoutSweep = ordering.scheduledOrderTimeoutSweep;
 *   exports.scheduledFlashDealExpiry = ordering.scheduledFlashDealExpiry;
 *   exports.onInspectionWritten = ordering.onInspectionWritten;
 */

const queueNumber = require('./queueNumber');
const wallet = require('./wallet');
const refund = require('./refund');
const pickupCode = require('./pickupCode');
const orderTimeout = require('./orderTimeout');
const inspectionTrigger = require('./inspectionTrigger');

module.exports = {
  // 號碼牌
  assignQueueNumber: queueNumber.assignQueueNumber,
  dailyQueueReset: queueNumber.dailyQueueReset,

  // 錢包 hold-capture-release
  walletHold: wallet.walletHold,
  walletCapture: wallet.walletCapture,
  walletRelease: wallet.walletRelease,

  // 退款（capture 後）
  refundCaptured: refund.refundCaptured,

  // 取餐碼核銷
  verifyPickupCode: pickupCode.verifyPickupCode,

  // 排程
  scheduledOrderTimeoutSweep: orderTimeout.scheduledOrderTimeoutSweep,
  scheduledFlashDealExpiry: orderTimeout.scheduledFlashDealExpiry,

  // Firestore triggers
  onInspectionWritten: inspectionTrigger.onInspectionWritten,
};
