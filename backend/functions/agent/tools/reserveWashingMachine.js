'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const inputSchema = z.object({
  dormitory: z.string().min(1),
  machineId: z.string().min(1),
  startTime: z.string().min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('reserveWashingMachine requires ctx.uid');
  if (!schoolId) throw new Error('reserveWashingMachine requires ctx.schoolId');

  const db = getFirestore();
  const machineRef = db.collection('schools').doc(schoolId)
    .collection('washingMachines').doc(input.machineId);
  const machineDoc = await machineRef.get();
  if (!machineDoc.exists) throw new Error('找不到此洗衣機。');
  if (machineDoc.data().status !== 'available') throw new Error('此洗衣機目前無法預約（非空閒狀態）。');

  const existingSnap = await db.collection('schools').doc(schoolId)
    .collection('washingReservations')
    .where('machineId', '==', input.machineId)
    .where('startTime', '==', input.startTime)
    .where('status', 'in', ['reserved', 'active'])
    .get();
  if (!existingSnap.empty) throw new Error('此時段已被預約，請選其他時間。');

  const reservationRef = db.collection('schools').doc(schoolId)
    .collection('washingReservations').doc();
  const reservedUntil = new Date(Date.now() + 10 * 60 * 1000);

  await db.runTransaction(async (tx) => {
    tx.set(reservationRef, {
      userId: uid,
      schoolId,
      dormitory: input.dormitory,
      machineId: input.machineId,
      startTime: input.startTime,
      status: 'reserved',
      reservedUntil: Timestamp.fromDate(reservedUntil),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(machineRef, {
      status: 'reserved',
      reservedBy: uid,
      reservedUntil: Timestamp.fromDate(reservedUntil),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    reservationId: reservationRef.id,
    machineId: input.machineId,
    startTime: input.startTime,
    reservedUntil: reservedUntil.toISOString(),
  };
}

module.exports = {
  name: 'reserveWashingMachine',
  description: '幫使用者預約宿舍洗衣機。需要宿舍棟名、machineId、開始時間（ISO 或 HH:mm 字串）。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
