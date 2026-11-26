'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor } = require('./serviceWriteGuard');
const { projectWashingReservation, washingReservationVersion } = require('../washingReservationSource');

const inputSchema = z.object({
  reservationId: z.string().min(1).max(128).refine((id) => !id.includes('/')).optional(),
}).strict();
const MAX_RESERVATIONS = 20;

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const db = getFirestore();
  const reservations = db.collection('schools').doc(ctx.schoolId).collection('washingReservations');
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const snapshot = input.reservationId
      ? await tx.get(reservations.doc(input.reservationId))
      : await tx.get(reservations.where('userId', '==', ctx.uid)
        .where('status', 'in', ['reserved', 'active']).limit(MAX_RESERVATIONS + 1));
    if (input.reservationId && !snapshot.exists) {
      throw new HttpsError('not-found', '找不到此洗衣預約。');
    }
    const docs = input.reservationId ? [snapshot] : snapshot.docs;
    const projected = docs.map((document) => {
      const row = document.data();
      if (row.userId !== ctx.uid) throw new HttpsError('permission-denied', '這不是您的預約。');
      if (row.schoolId != null && row.schoolId !== ctx.schoolId) {
        throw new HttpsError('failed-precondition', '洗衣預約的學校資料不一致。');
      }
      if (!input.reservationId && !['reserved', 'active'].includes(row.status)) {
        throw new HttpsError('failed-precondition', '洗衣預約狀態已變更，請重新查詢。');
      }
      return {
        ...projectWashingReservation(document.id, row),
        reservationVersion: washingReservationVersion(document.id, row),
      };
    });
    return {
      ok: true,
      complete: projected.length <= MAX_RESERVATIONS,
      reservations: projected.slice(0, MAX_RESERVATIONS),
    };
  });
}

module.exports = {
  name: 'getMyWashingReservations',
  description: '查詢目前學校的本人洗衣預約。清單不完整時不能替使用者選取；指定預約編號可查取消後狀態。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
