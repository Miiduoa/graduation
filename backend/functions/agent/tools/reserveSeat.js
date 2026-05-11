'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const inputSchema = z.object({
  seatId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('reserveSeat requires ctx.uid');
  if (!schoolId) throw new Error('reserveSeat requires ctx.schoolId');

  const db = getFirestore();

  // 衝突檢查
  const conflictsSnap = await db
    .collection('schools').doc(schoolId).collection('seatReservations')
    .where('seatId', '==', input.seatId)
    .where('date', '==', input.date)
    .where('status', '==', 'active')
    .get();

  for (const doc of conflictsSnap.docs) {
    const ex = doc.data();
    if (
      (input.startTime >= ex.startTime && input.startTime < ex.endTime) ||
      (input.endTime > ex.startTime && input.endTime <= ex.endTime) ||
      (input.startTime <= ex.startTime && input.endTime >= ex.endTime)
    ) {
      throw new Error('該時段座位已被預約，請選其他時間。');
    }
  }

  // 當日預約上限
  const userSnap = await db
    .collection('schools').doc(schoolId).collection('seatReservations')
    .where('userId', '==', uid)
    .where('date', '==', input.date)
    .where('status', '==', 'active')
    .get();
  if (userSnap.size >= 2) throw new Error('您今天的預約次數已達上限（2次）。');

  const reservationRef = db.collection('schools').doc(schoolId).collection('seatReservations').doc();
  const payload = {
    userId: uid,
    schoolId,
    seatId: input.seatId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.runTransaction(async (tx) => {
    tx.set(reservationRef, payload);
    tx.set(
      db.collection('users').doc(uid).collection('schools').doc(schoolId)
        .collection('seatReservations').doc(reservationRef.id),
      payload,
    );
  });

  return {
    reservationId: reservationRef.id,
    seatId: input.seatId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
  };
}

module.exports = {
  name: 'reserveSeat',
  description: '幫使用者預約圖書館或自習室座位。需要 seatId、日期（YYYY-MM-DD）、開始時間、結束時間（HH:mm）。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
