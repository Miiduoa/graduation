/**
 * 原子下單 (Atomic Order)
 *
 * 串連所有環節，確保「下單」這個動作不會出現半成功狀態：
 *
 *   1. 過敏原檢查 (allergens.checkAllergens)
 *   2. 預扣庫存 (stock.reserveStock) — 對每個品項
 *   3. 取得號碼牌 (Cloud Function `assignQueueNumber`，含 client fallback)
 *   4. Wallet hold (wallet.holdWallet)
 *   5. 建立訂單 (cafeteriaData.createOrder)
 *   6. 產生取餐碼 (pickupCode.issuePickupCode)
 *
 * 任一階段失敗 → 回滾前面所有階段。
 *
 * 取消流程：cancelOrderAtomic
 *   1. 撤銷取餐碼
 *   2. 釋放庫存
 *   3. release / refund wallet
 *   4. 標記訂單 cancelled
 *   5. 預算回補
 *
 * 取餐完成：completeOrderAtomic
 *   1. 核銷取餐碼 (前置條件，於店家端執行)
 *   2. capture wallet
 *   3. commit sale（reserved → sold）
 *   4. 標記訂單 completed
 *   5. 寫入 nutrition log
 */

import {
  httpsCallable,
} from 'firebase/functions';
import { getFunctionsInstance, getAuthInstance } from '../../firebase';
import {
  createOrder as cafeteriaCreateOrder,
  updateOrderStatus,
  logNutrition,
  trackSpending,
  getVendor,
  type Order,
  type OrderItem,
  type MenuItem,
} from '../cafeteriaData';
import type {
  AtomicOrderRequest,
  AtomicOrderResponse,
  CancelOrderResult,
  CancelReasonCode,
  DietaryProfile,
  PickupCode,
} from './types';
import {
  checkAllergens,
  isValidOverrideToken,
} from './allergens';
import {
  reserveStock,
  releaseStock,
  commitSale,
} from './stock';
import {
  holdWallet,
  releaseWalletHold,
  captureWallet,
} from './wallet';
import {
  issuePickupCode,
  revokePickupCode,
  consumePickupCode,
} from './pickupCode';
import { createRefund } from './refund';
import { getCancelReasonInfo } from './cancelReason';

type RollbackStep = () => Promise<void>;

function tryFirebase(): boolean {
  try {
    getAuthInstance();
    getFunctionsInstance();
    return true;
  } catch {
    return false;
  }
}

/**
 * 取得號碼牌 — Cloud Function 優先，本機 fallback
 *
 * Cloud Function: assignQueueNumber({ schoolId, vendorId }) → { serial }
 */
async function assignQueueNumber(
  schoolId: string,
  vendorId: string,
): Promise<number> {
  if (tryFirebase() && getAuthInstance().currentUser) {
    try {
      const fn = httpsCallable<
        { schoolId: string; vendorId: string },
        { serial?: number }
      >(getFunctionsInstance(), 'assignQueueNumber');
      const result = await fn({ schoolId, vendorId });
      const serial = result.data?.serial;
      if (typeof serial === 'number' && serial > 0) return serial;
    } catch (err) {
      console.warn('[atomicOrder] cloud assignQueueNumber failed:', err);
    }
  }
  // 本機 fallback：基於時間的偽序號
  const today = new Date();
  const dayMinutes =
    today.getHours() * 60 + today.getMinutes() - 7 * 60; // 從早上 7 點起算
  return Math.max(1, Math.floor(dayMinutes / 2));
}

/**
 * 主要 API：原子下單
 */
export async function placeOrderAtomic(
  request: AtomicOrderRequest,
  dietaryProfile: DietaryProfile,
  menuItems: Array<Pick<MenuItem, 'id' | 'name' | 'allergens'>>,
): Promise<AtomicOrderResponse> {
  const rollback: RollbackStep[] = [];

  const fail = async (
    stage: NonNullable<AtomicOrderResponse['failure']>['stage'],
    code: string,
    message: string,
  ): Promise<AtomicOrderResponse> => {
    // 反向執行所有 rollback
    let needsManual = false;
    for (let i = rollback.length - 1; i >= 0; i--) {
      try {
        await rollback[i]();
      } catch (err) {
        console.warn(`[atomicOrder] rollback step ${i} failed:`, err);
        needsManual = true;
      }
    }
    return {
      ok: false,
      orderId: null,
      queueNumber: null,
      pickupCode: null,
      walletHoldId: null,
      estimatedMinutes: 0,
      failure: {
        stage,
        code,
        message,
        ...(needsManual ? { needsManualReconciliation: true } : {}),
      },
    };
  };

  // 0. 前置檢查
  if (!request.studentUid || !request.schoolId || !request.vendorId) {
    return fail('precondition', 'missing_fields', '缺少必要欄位');
  }
  if (request.items.length === 0) {
    return fail('precondition', 'empty_cart', '購物車是空的');
  }
  if (request.totalPrice <= 0) {
    return fail('precondition', 'invalid_total', '總金額異常');
  }

  // 檢查店家狀態
  const vendor = getVendor(request.vendorId);
  if (!vendor) {
    return fail('precondition', 'vendor_not_found', '找不到店家');
  }
  if (!vendor.isOpen) {
    return fail('precondition', 'vendor_closed', '店家目前未營業');
  }

  // 1. 過敏原檢查
  const itemsForCheck = request.items
    .map((it) => menuItems.find((m) => m.id === it.menuItemId))
    .filter((m): m is Pick<MenuItem, 'id' | 'name' | 'allergens'> => !!m);

  const allergenResult = await checkAllergens(itemsForCheck, dietaryProfile);
  if (allergenResult.severity === 'block') {
    if (!isValidOverrideToken(request.allergenOverrideToken)) {
      return fail(
        'allergen_check',
        'allergen_block',
        allergenResult.message,
      );
    }
  }

  // 2. 預扣每個品項的庫存
  const reservations: Array<{ menuItemId: string; qty: number }> = [];
  for (const item of request.items) {
    const result = await reserveStock(
      request.schoolId,
      request.vendorId,
      item.menuItemId,
      item.quantity,
    );
    if (!result.ok) {
      return fail(
        'stock_reserve',
        result.reason ?? 'unknown',
        `「${item.menuItemName}」庫存不足或已售完`,
      );
    }
    reservations.push({ menuItemId: item.menuItemId, qty: item.quantity });
    // 註冊 rollback
    rollback.push(() =>
      releaseStock(request.schoolId, request.vendorId, item.menuItemId, item.quantity),
    );
  }

  // 3. 號碼牌
  let queueNumber: number;
  try {
    queueNumber = await assignQueueNumber(request.schoolId, request.vendorId);
  } catch (err: any) {
    return fail('queue_assign', 'queue_failed', err?.message ?? '號碼牌取得失敗');
  }

  // 4. Wallet hold
  const holdResult = await holdWallet({
    uid: request.studentUid,
    schoolId: request.schoolId,
    orderId: `pending-${Date.now()}`, // 暫時 id
    amount: request.totalPrice,
    paymentMethod: request.paymentMethod,
  });
  if (!holdResult.ok || !holdResult.holdId) {
    return fail(
      'wallet_hold',
      holdResult.reason ?? 'unknown',
      holdResult.reason === 'insufficient_balance' ? '餘額不足' : '付款預扣失敗',
    );
  }
  rollback.push(() =>
    releaseWalletHold({
      uid: request.studentUid,
      schoolId: request.schoolId,
      holdId: holdResult.holdId!,
    }).then(() => undefined),
  );

  // 5. 建立訂單
  let order: Order;
  try {
    order = await cafeteriaCreateOrder({
      studentUid: request.studentUid,
      vendorId: request.vendorId,
      cafeteriaId: request.cafeteriaId,
      items: request.items,
      totalPrice: request.totalPrice,
      note: buildOrderNote(request, holdResult.holdId!, queueNumber),
      estimatedPickup: null,
    });
  } catch (err: any) {
    return fail(
      'order_persist',
      'persist_failed',
      err?.message ?? '訂單建立失敗',
    );
  }
  rollback.push(async () => {
    await updateOrderStatus(order.id, 'cancelled', {
      cancelReason: 'system_payment_failed',
    });
  });

  // 6. 取餐碼
  let pickupCode: PickupCode;
  try {
    pickupCode = await issuePickupCode({
      orderId: order.id,
      vendorId: request.vendorId,
      studentUid: request.studentUid,
      schoolId: request.schoolId,
    });
  } catch (err: any) {
    return fail(
      'order_persist',
      'pickup_code_failed',
      err?.message ?? '取餐碼產生失敗',
    );
  }

  // 估算等待時間（每單 5 分鐘 + 號碼牌前面的等候）
  const estimatedMinutes = Math.max(5, Math.min(45, 5 + Math.floor(queueNumber / 6)));

  return {
    ok: true,
    orderId: order.id,
    queueNumber,
    pickupCode,
    walletHoldId: holdResult.holdId,
    estimatedMinutes,
  };
}

function buildOrderNote(
  request: AtomicOrderRequest,
  holdId: string,
  queueNumber: number,
): string {
  const parts = [request.note?.trim() ?? ''];
  parts.push(`[hold:${holdId}]`);
  parts.push(`[queue:${queueNumber}]`);
  if (request.source === 'ai_agent') parts.push('[source:ai_agent]');
  if (request.groupOrderId) parts.push(`[group:${request.groupOrderId}]`);
  return parts.filter(Boolean).join(' ');
}

/** 從 Order.note 中解析 holdId（與 buildOrderNote 對齊） */
export function parseHoldIdFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/\[hold:([^\]\s]+)\]/);
  return m ? m[1] : null;
}

/**
 * 取消訂單（整合）
 *
 * 自動處理：
 *   - 釋放庫存
 *   - 撤銷取餐碼
 *   - release wallet hold / 退款
 *   - 預算回補
 *   - 標記訂單 cancelled
 */
export async function cancelOrderAtomic(args: {
  order: Order;
  schoolId: string;
  reasonCode: CancelReasonCode;
  reasonText?: string;
  initiator: 'student' | 'vendor' | 'system' | 'admin';
}): Promise<CancelOrderResult> {
  const { order, schoolId, reasonCode } = args;
  const reasonInfo = getCancelReasonInfo(reasonCode);
  const reasonText = args.reasonText ?? reasonInfo.label;

  // 1. 釋放庫存
  let stockReleased = true;
  try {
    for (const item of order.items) {
      await releaseStock(schoolId, order.vendorId, item.menuItemId, item.quantity);
    }
  } catch (err) {
    console.warn('[cancelOrderAtomic] releaseStock failed:', err);
    stockReleased = false;
  }

  // 2. 撤銷取餐碼
  try {
    await revokePickupCode(schoolId, order.id);
  } catch (err) {
    console.warn('[cancelOrderAtomic] revokePickupCode failed:', err);
  }

  // 3. 退款（含 release wallet hold）
  const holdId = parseHoldIdFromNote(order.note);
  let refund = null;
  if (reasonInfo.triggersRefund) {
    try {
      refund = await createRefund({
        orderId: order.id,
        studentUid: order.studentUid,
        schoolId,
        vendorId: order.vendorId,
        amount: order.totalPrice,
        reasonCode,
        reasonText,
        walletHoldId: holdId,
        transactionId: null,
        initiator: args.initiator,
        destination: 'campus_card',
      });
    } catch (err) {
      console.warn('[cancelOrderAtomic] createRefund failed:', err);
    }
  } else if (holdId) {
    // 即使不退款，也要 release hold 避免錢被永遠凍結
    try {
      await releaseWalletHold({
        uid: order.studentUid,
        schoolId,
        holdId,
      });
    } catch (err) {
      console.warn('[cancelOrderAtomic] releaseWalletHold (no-refund) failed:', err);
    }
  }

  // 4. 標記訂單 cancelled
  await updateOrderStatus(order.id, 'cancelled', {
    cancelReason: reasonCode,
  });

  // 5. 預算回補
  let budgetRefunded: number | null = null;
  if (refund?.status === 'completed' && order.studentUid) {
    try {
      await trackSpending(order.studentUid, -order.totalPrice);
      budgetRefunded = order.totalPrice;
    } catch (err) {
      console.warn('[cancelOrderAtomic] trackSpending (refund) failed:', err);
    }
  }

  return {
    ok: true,
    orderId: order.id,
    newStatus: 'cancelled',
    refund,
    stockReleased,
    budgetRefunded,
    reason: reasonInfo,
  };
}

/**
 * 取餐完成（店家端執行）
 *
 * 流程：
 *   1. 核銷取餐碼（必先驗證）
 *   2. capture wallet
 *   3. commit sale（reserved → sold）
 *   4. 標記訂單 completed
 *   5. 寫 nutrition log（學生端）
 */
export async function completeOrderAtomic(args: {
  order: Order;
  schoolId: string;
  shortCode: string;
  operatorUid: string;
  vendorName: string;
  itemsForNutrition?: Array<{ name: string; calories: number | null }>;
}): Promise<{
  ok: boolean;
  orderId: string;
  reason?: string;
}> {
  const { order, schoolId, shortCode, operatorUid } = args;

  // 1. 核銷取餐碼
  const verifyResult = await consumePickupCode({
    schoolId,
    orderId: order.id,
    shortCode,
    operatorUid,
  });
  if (!verifyResult.ok) {
    return {
      ok: false,
      orderId: order.id,
      reason: verifyResult.reason ?? 'pickup_code_invalid',
    };
  }

  // 2. capture wallet
  const holdId = parseHoldIdFromNote(order.note);
  if (holdId) {
    try {
      await captureWallet({
        uid: order.studentUid,
        schoolId,
        holdId,
      });
    } catch (err) {
      console.warn('[completeOrderAtomic] captureWallet failed:', err);
      // 不阻擋取餐，但要警示 admin
    }
  }

  // 3. commit sale
  try {
    for (const item of order.items) {
      await commitSale(schoolId, order.vendorId, item.menuItemId, item.quantity);
    }
  } catch (err) {
    console.warn('[completeOrderAtomic] commitSale failed:', err);
  }

  // 4. 標記訂單 completed
  await updateOrderStatus(order.id, 'completed');

  // 5. nutrition log
  if (args.itemsForNutrition?.length) {
    try {
      for (const nutri of args.itemsForNutrition) {
        await logNutrition(order.studentUid, {
          vendorName: args.vendorName,
          itemName: nutri.name,
          calories: nutri.calories,
        });
      }
    } catch (err) {
      console.warn('[completeOrderAtomic] logNutrition failed:', err);
    }
  }

  // 預算統計（已花費）
  try {
    await trackSpending(order.studentUid, order.totalPrice);
  } catch (err) {
    console.warn('[completeOrderAtomic] trackSpending failed:', err);
  }

  return { ok: true, orderId: order.id };
}

// 重新匯出常用型別以方便消費者
export type {
  AtomicOrderRequest,
  AtomicOrderResponse,
  CancelOrderResult,
  OrderItem,
};
