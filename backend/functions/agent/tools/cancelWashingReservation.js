'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor } = require('./serviceWriteGuard');

const inputSchema = z.object({
  reservationId: z.string().min(1).max(128).refine((id) => !id.includes('/')),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const ref = db.doc(`schools/${schoolId}/washingReservations/${input.reservationId}`);
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到此預約。');
    const reservation = snapshot.data();
    if (reservation.userId !== uid) throw new HttpsError('permission-denied', '這不是您的預約。');
    if (!['reserved', 'active'].includes(reservation.status)) {
      throw new HttpsError('failed-precondition', '此預約已結束，不能重複取消。');
    }
    if (typeof reservation.machineId !== 'string' || !reservation.machineId || reservation.machineId.includes('/')) {
      throw new HttpsError('failed-precondition', '預約資料不完整，未變更紀錄。');
    }
    const machineRef = db.doc(`schools/${schoolId}/washingMachines/${reservation.machineId}`);
    const machineSnap = await tx.get(machineRef);
    const machine = machineSnap.exists ? machineSnap.data() : {};
    const matches = machine.activeReservationId
      ? machine.activeReservationId === input.reservationId
      : machine.reservedBy === uid &&
        typeof machine.reservedUntil?.toMillis === 'function' &&
        machine.reservedUntil.toMillis() === reservation.reservedUntil?.toMillis?.();
    tx.update(ref, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
    // 僅釋放與這筆預約相符的機器；過期舊申請不能取消別人或自己的新預約。
    if (matches && machine.status === 'reserved' && machine.reservedBy === uid) {
      tx.update(machineRef, { status: 'available', reservedBy: null, reservedUntil: null,
        activeReservationId: null, updatedAt: FieldValue.serverTimestamp() });
    }
    return { success: true };
  });
}

// 僅供既有取消 callable 共用，不列入 Agent 工具白名單。
module.exports = { inputSchema, execute };
