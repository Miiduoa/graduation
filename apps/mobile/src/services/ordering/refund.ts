/**
 * 退款流程
 *
 * 兩條路徑：
 *   A. Hold 階段退款（最常見、最便宜）：直接 releaseWalletHold，狀態 completed
 *   B. Captured 後退款（已取餐但客訴）：呼叫閘道真退款，狀態 processing → completed
 *
 * 自動觸發退款的情境：
 *   - 店家拒單（hold → release）
 *   - 學生取消（hold → release）
 *   - 系統超時自動取消（hold → release）
 *   - 稽查不合格強制下架（hold → release，已 captured 部分走真退款）
 *
 * 不自動退款的情境：
 *   - system_no_show（學生未取餐）— 由 admin 個案處理
 *   - system_payment_failed — 本來就沒扣款
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
} from 'firebase/firestore';
import { getDb, getFunctionsInstance, getAuthInstance } from '../../firebase';
import type {
  Refund,
  RefundStatus,
  CancelReasonCode,
  WalletHold,
} from './types';
import { getCancelReasonInfo } from './cancelReason';
import { releaseWalletHold, getHoldById } from './wallet';

const REFUND_LOCAL_KEY = '@ordering_refunds';

function tryFirebase(): boolean {
  try {
    getDb();
    getAuthInstance();
    return true;
  } catch {
    return false;
  }
}

async function readLocalRefunds(): Promise<Record<string, Refund>> {
  try {
    const raw = await AsyncStorage.getItem(REFUND_LOCAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocalRefunds(map: Record<string, Refund>): Promise<void> {
  await AsyncStorage.setItem(REFUND_LOCAL_KEY, JSON.stringify(map));
}

/**
 * 建立退款單 + 自動處理
 *
 * 流程：
 *   1. 建立 Refund 文件（status='requested'）
 *   2. 若 reason.triggersRefund=false：標記 rejected 並結束
 *   3. 若有對應的 WalletHold 且狀態=held：releaseWalletHold → status='completed'
 *   4. 若 hold 已 captured：呼叫雲端 refundCaptured fn → status='processing'
 */
export async function createRefund(args: {
  orderId: string;
  studentUid: string;
  schoolId: string;
  vendorId: string;
  amount: number;
  reasonCode: CancelReasonCode;
  reasonText: string;
  walletHoldId: string | null;
  transactionId: string | null;
  initiator: Refund['initiator'];
  destination: Refund['destination'];
}): Promise<Refund> {
  const reasonInfo = getCancelReasonInfo(args.reasonCode);
  const id = `refund-${args.orderId}-${Date.now()}`;

  let initialStatus: RefundStatus = 'requested';
  if (!reasonInfo.triggersRefund) {
    initialStatus = 'rejected';
  }

  const refund: Refund = {
    id,
    orderId: args.orderId,
    studentUid: args.studentUid,
    schoolId: args.schoolId,
    vendorId: args.vendorId,
    amount: args.amount,
    currency: 'TWD',
    reasonCode: args.reasonCode,
    reasonText: args.reasonText,
    destination: args.destination,
    status: initialStatus,
    initiator: args.initiator,
    walletHoldId: args.walletHoldId,
    transactionId: args.transactionId,
    gatewayRefundId: null,
    requestedAt: new Date().toISOString(),
    processedAt: null,
    completedAt: null,
    budgetRefunded: null,
  };

  await persistRefund(refund);

  if (!reasonInfo.triggersRefund) {
    return refund;
  }

  // 路徑 A：hold 階段（最快）
  if (refund.walletHoldId) {
    const hold = await getHoldById(refund.walletHoldId);
    if (hold && hold.status === 'held') {
      const releaseResult = await releaseWalletHold({
        uid: refund.studentUid,
        schoolId: refund.schoolId,
        holdId: refund.walletHoldId,
      });
      if (releaseResult.ok) {
        refund.status = 'completed';
        refund.processedAt = new Date().toISOString();
        refund.completedAt = new Date().toISOString();
        refund.budgetRefunded = refund.amount;
        await persistRefund(refund);
        return refund;
      }
      // release 失敗：標 failed，留給 admin 介入
      refund.status = 'failed';
      refund.processedAt = new Date().toISOString();
      await persistRefund(refund);
      return refund;
    }

    // 已 captured 走真退款
    if (hold && hold.status === 'captured') {
      return processCapturedRefund(refund, hold);
    }
  }

  // 沒有 hold 資料：直接走 transactionId 真退款（或標 failed）
  if (refund.transactionId) {
    return processCapturedRefund(refund, null);
  }

  refund.status = 'failed';
  await persistRefund(refund);
  return refund;
}

/** 路徑 B：已 captured 後退款（走真退款閘道） */
async function processCapturedRefund(
  refund: Refund,
  _hold: WalletHold | null,
): Promise<Refund> {
  refund.status = 'processing';
  refund.processedAt = new Date().toISOString();
  await persistRefund(refund);

  if (tryFirebase() && getAuthInstance().currentUser) {
    try {
      const fn = httpsCallable<
        Record<string, unknown>,
        { ok?: boolean; gatewayRefundId?: string; reason?: string }
      >(getFunctionsInstance(), 'refundCaptured');
      const result = await fn({
        schoolId: refund.schoolId,
        orderId: refund.orderId,
        amount: refund.amount,
        transactionId: refund.transactionId,
        walletHoldId: refund.walletHoldId,
      });
      if (result.data?.ok) {
        refund.status = 'completed';
        refund.completedAt = new Date().toISOString();
        refund.gatewayRefundId = result.data.gatewayRefundId ?? null;
        refund.budgetRefunded = refund.amount;
      } else {
        refund.status = 'failed';
      }
    } catch (err) {
      console.warn('[refund] cloud refundCaptured failed:', err);
      refund.status = 'failed';
    }
  } else {
    // 本機 demo：直接視為完成
    refund.status = 'completed';
    refund.completedAt = new Date().toISOString();
    refund.gatewayRefundId = `mock-refund-${Date.now()}`;
    refund.budgetRefunded = refund.amount;
  }

  await persistRefund(refund);
  return refund;
}

async function persistRefund(refund: Refund): Promise<void> {
  // 本機
  const local = await readLocalRefunds();
  local[refund.id] = refund;
  await writeLocalRefunds(local);

  // 雲端
  if (tryFirebase()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', refund.schoolId, 'refunds', refund.id);
      await setDoc(
        ref,
        {
          ...refund,
          requestedAt: refund.requestedAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.warn('[refund] firestore persist failed:', err);
    }
  }
}

export async function getRefundsByOrder(orderId: string): Promise<Refund[]> {
  const local = await readLocalRefunds();
  return Object.values(local).filter((r) => r.orderId === orderId);
}

export async function getRefundsByUser(uid: string, limit = 50): Promise<Refund[]> {
  const local = await readLocalRefunds();
  return Object.values(local)
    .filter((r) => r.studentUid === uid)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, limit);
}

/** 手動標記 admin 介入處理（demo） */
export async function adminMarkRefund(
  refundId: string,
  status: RefundStatus,
): Promise<Refund | null> {
  const local = await readLocalRefunds();
  const refund = local[refundId];
  if (!refund) return null;
  refund.status = status;
  if (status === 'completed') refund.completedAt = new Date().toISOString();
  await persistRefund(refund);
  return refund;
}

/** 用於後端推送到雲端 collection（如果 client side firestore 失敗） */
export async function ensureRefundCollectionPath(schoolId: string): Promise<string> {
  if (!tryFirebase()) return `/schools/${schoolId}/refunds`;
  try {
    const db = getDb();
    const ref = collection(db, 'schools', schoolId, 'refunds');
    return ref.path;
  } catch {
    return `/schools/${schoolId}/refunds`;
  }
}
