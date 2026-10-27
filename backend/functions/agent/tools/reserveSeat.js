'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor, userServiceGuard, resourceServiceGuard } = require('./serviceWriteGuard');

const inputSchema = z.object({
  seatId: z.string().min(1).max(128).refine((id) => !id.includes('/')),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date ||
      input.startTime >= input.endTime) {
    throw new HttpsError('invalid-argument', '請選擇有效的日期及起訖時間。');
  }
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const reservations = db.collection('schools').doc(schoolId).collection('seatReservations');
  const reservationRef = reservations.doc();
  const seatRef = db.doc(`schools/${schoolId}/librarySeats/${input.seatId}`);
  const userGuard = userServiceGuard(db, ctx, 'seats');
  const seatGuard = resourceServiceGuard(db, schoolId, 'seat', input.seatId, input.date);
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const [seat, conflicts, userReservations] = await Promise.all([
      tx.get(seatRef),
      tx.get(reservations.where('seatId', '==', input.seatId).where('date', '==', input.date).where('status', '==', 'active')),
      tx.get(reservations.where('userId', '==', uid).where('date', '==', input.date).where('status', '==', 'active')),
      tx.get(userGuard), tx.get(seatGuard),
    ]);
    if (!seat.exists) throw new HttpsError('not-found', '找不到此校園的座位。');
    if (seat.data().available === false || ['disabled', 'maintenance', 'inactive'].includes(seat.data().status)) {
      throw new HttpsError('failed-precondition', '此座位目前不開放預約。');
    }
    for (const existing of conflicts.docs) {
      const row = existing.data();
      if (typeof row.startTime !== 'string' || typeof row.endTime !== 'string' ||
          (input.startTime < row.endTime && input.endTime > row.startTime)) {
        throw new HttpsError('already-exists', '該時段座位已被預約，請選其他時間。');
      }
    }
    if (userReservations.size >= 2) throw new HttpsError('failed-precondition', '您今天的預約次數已達上限（2 次）。');
    const payload = {
      userId: uid, schoolId, ...input, status: 'active', createdAt: FieldValue.serverTimestamp(),
    };
    tx.create(reservationRef, payload);
    tx.set(db.doc(`users/${uid}/schools/${schoolId}/seatReservations/${reservationRef.id}`), payload);
    tx.set(userGuard, { updatedAt: FieldValue.serverTimestamp() });
    tx.set(seatGuard, { updatedAt: FieldValue.serverTimestamp() });
    return { reservationId: reservationRef.id, ...input };
  });
}

module.exports = {
  name: 'reserveSeat',
  description: '幫使用者預約圖書館或自習室座位。需要 seatId、日期（YYYY-MM-DD）、開始時間、結束時間（HH:mm）。',
  inputSchema, execute, requiresConfirmation: true,
};
