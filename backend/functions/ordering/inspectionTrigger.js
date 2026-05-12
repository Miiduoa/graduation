'use strict';

/**
 * Firestore Trigger: onInspectionWritten
 *
 * 當管理員新增 / 更新衛生稽查紀錄時，自動執行連動處置：
 *   - 分數 < 60 → force_close + 召回未取訂單
 *   - 60-74 → suspend_ordering（7 天暫停接單）
 *   - 75-89 → warning（標記但不停權）
 *   - >= 90 → no_action
 *
 * 這層做 server-side enforcement，避免 client side enforcement.ts 在
 * 學生 / 店家 app 上未必能執行（admin 才有寫 vendor 文件的權限）。
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'asia-east1';

function deriveAction(score) {
  if (score >= 90) return 'no_action';
  if (score >= 75) return 'warning';
  if (score >= 60) return 'suspend_ordering';
  return 'force_close';
}

function deriveResumeAt(action) {
  if (action === 'suspend_ordering') {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

module.exports.onInspectionWritten = onDocumentWritten(
  {
    document: 'schools/{schoolId}/inspections/{inspectionId}',
    region: REGION,
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return null;

    const { schoolId, inspectionId } = event.params;
    const score = Number(after.score ?? 100);
    const action = deriveAction(score);

    const db = getFirestore();
    const vendorId = String(after.vendorId || '').trim();
    if (!vendorId) return null;

    const reason = buildReasonText(after, action);
    const resumeAt = deriveResumeAt(action);
    const enforcementRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('inspectionEnforcements')
      .doc(inspectionId);
    const vendorRef = db.collection('schools').doc(schoolId).collection('vendors').doc(vendorId);

    // no_action / warning：只記錄
    if (action === 'no_action' || action === 'warning') {
      await enforcementRef.set(
        {
          inspectionId,
          vendorId,
          action,
          reason,
          resumeAt: null,
          affectedOrderIds: [],
          triggeredAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return null;
    }

    // suspend_ordering / force_close：停權店家
    await vendorRef.set(
      {
        isOpen: false,
        orderingEnabled: false,
        suspendedAt: FieldValue.serverTimestamp(),
        suspendedReason: reason,
        suspendedAction: action,
        resumeAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // force_close：召回未取訂單
    const affectedOrderIds = [];
    if (action === 'force_close') {
      const ordersRef = db.collection('schools').doc(schoolId).collection('orders');
      const snap = await ordersRef
        .where('cafeteriaId', '==', vendorId)
        .where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready'])
        .limit(200)
        .get();

      for (const docSnap of snap.docs) {
        const order = docSnap.data();
        affectedOrderIds.push(docSnap.id);
        try {
          await docSnap.ref.update({
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'admin_vendor_suspended',
            cancelReasonText: reason,
          });
          // 寫入 refund collection（實際退款由 wallet 模組或定期 batch 處理）
          await db.collection('schools').doc(schoolId).collection('refunds').add({
            orderId: docSnap.id,
            studentUid: order.userId || order.studentUid,
            vendorId,
            amount: order.totalAmount || order.total || order.totalPrice || 0,
            currency: 'TWD',
            reasonCode: 'admin_vendor_suspended',
            reasonText: reason,
            status: 'requested',
            initiator: 'admin',
            destination: 'campus_card',
            walletHoldId: null,
            transactionId: null,
            requestedAt: FieldValue.serverTimestamp(),
          });
        } catch (err) {
          console.warn('[onInspectionWritten] cancel order failed:', err);
        }
      }
    }

    await enforcementRef.set(
      {
        inspectionId,
        vendorId,
        action,
        reason,
        resumeAt,
        affectedOrderIds,
        triggeredAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return null;
  },
);

function buildReasonText(record, action) {
  const score = record?.score ?? '?';
  const comment = record?.overallComment || '';
  const base = `衛生稽查分數 ${score} 分`;
  switch (action) {
    case 'no_action':
      return `${base}（通過）`;
    case 'warning':
      return `${base}（警告${comment ? `：${comment}` : ''}）`;
    case 'suspend_ordering':
      return `${base}（暫停接單 7 天${comment ? `：${comment}` : ''}）`;
    case 'force_close':
      return `${base}（強制下架${comment ? `：${comment}` : ''}）`;
    default:
      return base;
  }
}
