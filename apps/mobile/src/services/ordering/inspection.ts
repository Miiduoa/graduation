/**
 * 衛生稽查 → 自動連動店家狀態
 *
 * 規則：
 *   - 稽查分數 >= 90：no_action
 *   - 75 ~ 89：warning（標記，但仍接單）
 *   - 60 ~ 74：suspend_ordering（暫停接單 7 天）
 *   - < 60：force_close（強制下架 + 召回所有 pending/confirmed/preparing 訂單退款）
 *
 * 觸發點：
 *   - AdminCafeteriaScreen 新增稽查時呼叫 enforceInspection
 *   - 後端 onInspectionWritten trigger 也會跑同樣邏輯（雙保險）
 */

import {
  doc,
  setDoc,
  collection,
  query as fsQuery,
  where,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDb } from '../../firebase';
import type {
  InspectionEnforcement,
  InspectionEnforcementAction,
} from './types';
import type { InspectionRecord, Order } from '../cafeteriaData';
import { createRefund } from './refund';
import { revokePickupCode } from './pickupCode';
import { releaseStock } from './stock';

function tryFirestore(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/** 由分數推導動作 */
export function deriveEnforcementAction(score: number): InspectionEnforcementAction {
  if (score >= 90) return 'no_action';
  if (score >= 75) return 'warning';
  if (score >= 60) return 'suspend_ordering';
  return 'force_close';
}

/** 由分數推導解禁時間（暫停接單 7 天） */
function deriveResumeAt(action: InspectionEnforcementAction): string | null {
  if (action === 'suspend_ordering') {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null; // force_close 待人工解禁
}

/**
 * 對稽查紀錄執行連動處置
 *
 * @returns 完整的 enforcement 紀錄
 */
export async function enforceInspection(
  schoolId: string,
  record: InspectionRecord,
): Promise<InspectionEnforcement> {
  const action = deriveEnforcementAction(record.score);
  const resumeAt = deriveResumeAt(action);
  const triggeredAt = new Date().toISOString();

  const enforcement: InspectionEnforcement = {
    inspectionId: record.id,
    vendorId: record.vendorId,
    triggeredAt,
    action,
    reason: buildReasonText(record, action),
    affectedOrderIds: [],
    resumeAt,
  };

  // 1. no_action / warning：只記錄，不影響營運
  if (action === 'no_action' || action === 'warning') {
    await persistEnforcement(schoolId, enforcement);
    return enforcement;
  }

  // 2. suspend_ordering / force_close：標記店家
  await markVendorSuspended(schoolId, record.vendorId, {
    action,
    resumeAt,
    reason: enforcement.reason,
  });

  // 3. force_close 才召回未取訂單
  if (action === 'force_close' || action === 'recall_pending_orders') {
    const affectedIds = await recallPendingOrders({
      schoolId,
      vendorId: record.vendorId,
      reason: enforcement.reason,
    });
    enforcement.affectedOrderIds = affectedIds;
  }

  await persistEnforcement(schoolId, enforcement);
  return enforcement;
}

function buildReasonText(
  record: InspectionRecord,
  action: InspectionEnforcementAction,
): string {
  const base = `衛生稽查分數 ${record.score} 分`;
  switch (action) {
    case 'no_action':
      return `${base}（通過）`;
    case 'warning':
      return `${base}（警告：${record.overallComment || '部分項目不合格'}）`;
    case 'suspend_ordering':
      return `${base}（暫停接單 7 天：${record.overallComment || '需改善多項'}）`;
    case 'force_close':
      return `${base}（強制下架：${record.overallComment || '嚴重不合格'}）`;
    case 'recall_pending_orders':
      return `${base}（召回未取訂單）`;
    default:
      return base;
  }
}

async function markVendorSuspended(
  schoolId: string,
  vendorId: string,
  args: {
    action: InspectionEnforcementAction;
    resumeAt: string | null;
    reason: string;
  },
): Promise<void> {
  if (!tryFirestore()) return;
  try {
    const db = getDb();
    const ref = doc(db, 'schools', schoolId, 'vendors', vendorId);
    await setDoc(
      ref,
      {
        isOpen: false,
        orderingEnabled: false,
        suspendedAt: serverTimestamp(),
        suspendedReason: args.reason,
        suspendedAction: args.action,
        resumeAt: args.resumeAt,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[inspection] markVendorSuspended failed:', err);
  }
}

/** 召回未取的訂單 — 全數自動退款 */
async function recallPendingOrders(args: {
  schoolId: string;
  vendorId: string;
  reason: string;
}): Promise<string[]> {
  if (!tryFirestore()) return [];

  const affected: string[] = [];
  try {
    const db = getDb();
    const ordersRef = collection(db, 'schools', args.schoolId, 'orders');
    const q = fsQuery(
      ordersRef,
      where('cafeteriaId', '==', args.vendorId),
      where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready']),
    );
    const snap = await getDocs(q);

    for (const docSnap of snap.docs) {
      const order = docSnap.data() as Order & { walletHoldId?: string | null };
      affected.push(docSnap.id);

      // 取消訂單
      try {
        await updateDoc(docSnap.ref, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelReason: 'admin_vendor_suspended',
          cancelReasonText: args.reason,
        });
      } catch (err) {
        console.warn('[inspection] cancel order failed:', err);
      }

      // 退款
      try {
        await createRefund({
          orderId: docSnap.id,
          studentUid: order.studentUid,
          schoolId: args.schoolId,
          vendorId: args.vendorId,
          amount: order.totalPrice,
          reasonCode: 'admin_vendor_suspended',
          reasonText: args.reason,
          walletHoldId: order.walletHoldId ?? null,
          transactionId: null,
          initiator: 'admin',
          destination: 'campus_card',
        });
      } catch (err) {
        console.warn('[inspection] refund failed:', err);
      }

      // 撤銷取餐碼
      try {
        await revokePickupCode(args.schoolId, docSnap.id);
      } catch {
        // ignore
      }

      // 釋放庫存
      try {
        const items = order.items ?? [];
        for (const item of items) {
          await releaseStock(args.schoolId, args.vendorId, item.menuItemId, item.quantity);
        }
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.warn('[inspection] recallPendingOrders failed:', err);
  }

  return affected;
}

async function persistEnforcement(
  schoolId: string,
  enforcement: InspectionEnforcement,
): Promise<void> {
  if (!tryFirestore()) return;
  try {
    const db = getDb();
    const ref = doc(
      db,
      'schools',
      schoolId,
      'inspectionEnforcements',
      enforcement.inspectionId,
    );
    await setDoc(ref, { ...enforcement, persistedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[inspection] persistEnforcement failed:', err);
  }
}

/**
 * 管理員手動解禁
 */
export async function liftVendorSuspension(
  schoolId: string,
  vendorId: string,
  adminUid: string,
): Promise<boolean> {
  if (!tryFirestore()) return false;
  try {
    const db = getDb();
    const ref = doc(db, 'schools', schoolId, 'vendors', vendorId);
    await setDoc(
      ref,
      {
        orderingEnabled: true,
        isOpen: true,
        suspendedAt: null,
        suspendedReason: null,
        suspendedAction: null,
        resumeAt: null,
        liftedBy: adminUid,
        liftedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (err) {
    console.warn('[inspection] liftVendorSuspension failed:', err);
    return false;
  }
}
