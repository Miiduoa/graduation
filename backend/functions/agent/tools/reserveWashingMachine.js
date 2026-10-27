'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor } = require('./serviceWriteGuard');

const inputSchema = z.object({
  dormitory: z.string().trim().min(1).max(100),
  machineId: z.string().min(1).max(128).refine((id) => !id.includes('/')),
  startTime: z.string().min(1).max(40),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const machineRef = db.doc(`schools/${schoolId}/washingMachines/${input.machineId}`);
  const reservations = db.collection('schools').doc(schoolId).collection('washingReservations');
  const reservationRef = reservations.doc();
  const reservedUntil = new Date(Date.now() + 10 * 60 * 1000);
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const [machine, existing] = await Promise.all([
      tx.get(machineRef),
      tx.get(reservations.where('machineId', '==', input.machineId).where('startTime', '==', input.startTime)
        .where('status', 'in', ['reserved', 'active'])),
    ]);
    if (!machine.exists) throw new HttpsError('not-found', '找不到此洗衣機。');
    if (machine.data().status !== 'available') {
      throw new HttpsError('failed-precondition', '此洗衣機目前無法預約。');
    }
    if (machine.data().dormitory && machine.data().dormitory !== input.dormitory) {
      throw new HttpsError('invalid-argument', '所選洗衣機不屬於這棟宿舍。');
    }
    if (!existing.empty) throw new HttpsError('already-exists', '此時段已被預約，請選其他時間。');
    tx.create(reservationRef, {
      userId: uid, schoolId, ...input, status: 'reserved',
      reservedUntil: Timestamp.fromDate(reservedUntil), createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(machineRef, {
      status: 'reserved', reservedBy: uid, reservedUntil: Timestamp.fromDate(reservedUntil),
      activeReservationId: reservationRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { reservationId: reservationRef.id, machineId: input.machineId,
      startTime: input.startTime, reservedUntil: reservedUntil.toISOString() };
  });
}

module.exports = {
  name: 'reserveWashingMachine',
  description: '幫使用者預約宿舍洗衣機。需要宿舍棟名、machineId、開始時間（ISO 或 HH:mm 字串）。',
  inputSchema, execute, requiresConfirmation: true,
};
