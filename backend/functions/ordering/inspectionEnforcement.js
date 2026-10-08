const { createHash } = require('node:crypto');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { identifier, OPEN_STATUSES, writeOrderTransition } = require('../orderTransitions');
const { runInspectionTransaction } = require('./inspectionTransaction');

function deriveAction(score) {
  if (score >= 90) return 'no_action';
  if (score >= 75) return 'warning';
  if (score >= 60) return 'suspend_ordering';
  return 'force_close';
}
function reasonText(record, action) {
  const base = `衛生稽查分數 ${record.score ?? '?'} 分`;
  const comment = record.overallComment ? `：${record.overallComment}` : '';
  if (action === 'no_action') return `${base}（通過）`;
  if (action === 'warning') return `${base}（警告${comment}）`;
  if (action === 'suspend_ordering') return `${base}（暫停接單 7 天${comment}）`;
  return `${base}（強制下架${comment}）`;
}
function matchesVersion(snapshot, version) {
  return (
    snapshot.exists &&
    typeof snapshot.updateTime?.isEqual === 'function' &&
    snapshot.updateTime.isEqual(version)
  );
}

function createInspectionEnforcement({ db, now = Date.now }) {
  return async (event) => {
    if (!event.data?.after?.exists) return null;
    const { schoolId, inspectionId } = event.params;
    identifier(schoolId, 'schoolId');
    identifier(inspectionId, 'inspectionId');
    const version = event.data.after.updateTime;
    const school = db.collection('schools').doc(schoolId);
    const inspectionRef = school.collection('inspections').doc(inspectionId);
    const enforcementRef = school.collection('inspectionEnforcements').doc(inspectionId);
    const enforcement = await runInspectionTransaction(db, async (transaction) => {
      const [inspection, previous] = await transaction.getAll(inspectionRef, enforcementRef);
      // Firestore events may be retried or delivered out of order. Never enforce an old score.
      if (!matchesVersion(inspection, version)) return null;
      const record = inspection.data();
      if (!record.vendorId || !Number.isFinite(Number(record.score ?? 100))) return null;
      const vendorId = identifier(record.vendorId, 'vendorId');
      const action = deriveAction(Number(record.score ?? 100));
      const reason = reasonText(record, action);
      const previousData = previous.data();
      if (previous.exists && previousData.inspectionVersion?.isEqual(version)) {
        return { vendorId, action, reason };
      }
      const cafeteriaRef = school.collection('cafeterias').doc(vendorId);
      const [cafeteria] = await transaction.getAll(cafeteriaRef);
      const resumeAt =
        action === 'suspend_ordering' ? new Date(now() + 7 * 86400000).toISOString() : null;
      if (['suspend_ordering', 'force_close'].includes(action)) {
        const closure = {
          isOpen: false,
          orderingEnabled: false,
          suspendedAt: FieldValue.serverTimestamp(),
          suspendedReason: reason,
          suspendedAction: action,
          resumeAt,
          updatedAt: FieldValue.serverTimestamp(),
        };
        transaction.set(school.collection('vendors').doc(vendorId), closure, { merge: true });
        // createOrder reads this canonical configuration in its own transaction.
        if (cafeteria.exists) transaction.update(cafeteriaRef, closure);
      }
      transaction.set(enforcementRef, {
        inspectionId,
        inspectionVersion: version,
        vendorId,
        action,
        reason,
        resumeAt,
        affectedOrderIds: [],
        triggeredAt: FieldValue.serverTimestamp(),
      });
      return { vendorId, action, reason };
    });
    if (!enforcement || enforcement.action !== 'force_close') return null;
    let cursor;
    while (true) {
      let query = school
        .collection('orders')
        .where('cafeteriaId', '==', enforcement.vendorId)
        .where('status', 'in', OPEN_STATUSES)
        .orderBy(FieldPath.documentId())
        .limit(200);
      if (cursor) query = query.startAfter(cursor);
      const candidates = await query.get();
      for (const candidate of candidates.docs) {
        const refundId = `inspection_${createHash('sha256').update(`${schoolId}\0${candidate.id}`).digest('hex')}`;
        const refundRef = school.collection('refunds').doc(refundId);
        await runInspectionTransaction(db, async (transaction) => {
          const [inspection, orderSnapshot, receipt, refund] = await transaction.getAll(
            inspectionRef,
            candidate.ref,
            enforcementRef,
            refundRef,
          );
          if (
            !matchesVersion(inspection, version) ||
            !receipt.exists ||
            !receipt.data().inspectionVersion?.isEqual(version) ||
            !orderSnapshot.exists
          )
            return;
          const currentInspection = inspection.data();
          const order = orderSnapshot.data();
          if (
            String(currentInspection.vendorId || '').trim() !== enforcement.vendorId ||
            deriveAction(Number(currentInspection.score ?? 100)) !== 'force_close' ||
            order.cafeteriaId !== enforcement.vendorId ||
            !OPEN_STATUSES.includes(order.status)
          )
            return;
          const amount = order.totalAmount ?? order.total ?? order.totalPrice ?? 0;
          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
            throw new HttpsError('failed-precondition', 'Order amount requires review');
          if (
            refund.exists &&
            (refund.data().orderId !== candidate.id || refund.data().studentUid !== order.userId)
          )
            throw new HttpsError('failed-precondition', 'Refund request identity requires review');
          writeOrderTransition(
            transaction,
            db,
            candidate.ref,
            schoolId,
            candidate.id,
            order,
            'cancelled',
            {
              cancelReason: 'admin_vendor_suspended',
              cancelReasonText: enforcement.reason,
            },
          );
          const unpaidOnsite =
            order.paymentMethod === 'onsite' && order.paymentStatus === 'pending';
          if (!unpaidOnsite && !refund.exists)
            transaction.create(refundRef, {
              orderId: candidate.id,
              studentUid: order.userId,
              vendorId: enforcement.vendorId,
              orderTotal: amount,
              currency: typeof order.currency === 'string' ? order.currency : null,
              paymentMethod: typeof order.paymentMethod === 'string' ? order.paymentMethod : null,
              paymentStatus: typeof order.paymentStatus === 'string' ? order.paymentStatus : null,
              reasonCode: 'admin_vendor_suspended',
              reasonText: enforcement.reason,
              status: 'needs_review',
              manualReviewRequired: true,
              initiator: 'admin',
              requestedAt: FieldValue.serverTimestamp(),
            });
          transaction.update(enforcementRef, {
            affectedOrderIds: FieldValue.arrayUnion(candidate.id),
          });
        });
      }
      // Orders created through the canonical producer are now blocked. Drain older open orders in bounded batches.
      if (candidates.size < 200) break;
      cursor = candidates.docs[candidates.size - 1].id;
    }
    return null;
  };
}

module.exports = { createInspectionEnforcement };
