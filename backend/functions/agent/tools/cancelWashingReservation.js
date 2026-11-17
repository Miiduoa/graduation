'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor } = require('./serviceWriteGuard');
const { assertWashingReservationVersion, washingReservationExpiry } = require('../washingReservationSource');

const inputSchema = z.object({
  reservationId: z.string().min(1).max(128).refine((id) => !id.includes('/')),
  expectedReservationVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  machineId: z.string().min(1).max(128).refine((id) => !id.includes('/')).optional(),
  dormitory: z.string().min(1).max(100).optional(),
  startTime: z.string().min(1).max(40).optional(),
  reservedUntil: z.string().max(40).nullable().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const ref = db.doc('schools/' + schoolId + '/washingReservations/' + input.reservationId);
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    if (ctx.agentActionKey) {
      const permission = await tx.get(db.doc('users/' + uid + '/settings/assistantPermissions'));
      if (!permission.exists || permission.data()?.cancelWashingReservation !== true) {
        throw new HttpsError('permission-denied', '請先允許助理取消洗衣預約。');
      }
    }
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到此預約。');
    const reservation = snapshot.data();
    if (reservation.userId !== uid) throw new HttpsError('permission-denied', '這不是您的預約。');
    if (reservation.schoolId != null && reservation.schoolId !== schoolId) {
      throw new HttpsError('failed-precondition', '洗衣預約的學校資料不一致。');
    }
    if (!['reserved', 'active'].includes(reservation.status)) {
      throw new HttpsError('failed-precondition', '此預約已結束，不能重複取消。');
    }
    if (typeof reservation.machineId !== 'string' || !reservation.machineId || reservation.machineId.includes('/')) {
      throw new HttpsError('failed-precondition', '預約資料不完整，未變更紀錄。');
    }
    const reviewed = assertWashingReservationVersion(ctx, input, input.reservationId, reservation);
    const machineRef = db.doc('schools/' + schoolId + '/washingMachines/' + reservation.machineId);
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
    let reservedUntil = null;
    if (reviewed) reservedUntil = reviewed.reservedUntil;
    else {
      // Keep ID-only service cancellation available for old incomplete records.
      // Such records cannot enter the Agent's strict source/confirmation flow.
      try { reservedUntil = washingReservationExpiry(reservation.reservedUntil); } catch { /* no known expiry */ }
    }
    return {
      success: true, reservationId: input.reservationId,
      machineId: reservation.machineId,
      dormitory: reviewed ? reviewed.dormitory : typeof reservation.dormitory === 'string' ? reservation.dormitory : null,
      startTime: reviewed ? reviewed.startTime : typeof reservation.startTime === 'string' ? reservation.startTime : null,
      reservedUntil, status: 'cancelled', schoolId, userId: uid,
    };
  });
}

module.exports = {
  name: 'cancelWashingReservation',
  description: '取消本人已確認的洗衣預約。必須先讀取本人預約、確認來源版本與機台內容，再由使用者確認。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
