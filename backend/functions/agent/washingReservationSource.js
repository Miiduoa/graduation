'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const KNOWN_STATUSES = new Set(['reserved', 'active', 'cancelled', 'inUse', 'completed', 'noshow']);

function incomplete() {
  throw new HttpsError('failed-precondition', '洗衣預約資料不完整，請重新查詢。');
}

function sourceText(value, maximum, identifier = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      (identifier && (value !== value.trim() || value.includes('/')))) incomplete();
  return value;
}

function washingReservationExpiry(value) {
  if (value == null) return null;
  let date;
  try {
    if (value instanceof Date) date = value;
    else if (typeof value?.toDate === 'function') date = value.toDate();
    else if (typeof value === 'string') date = new Date(value);
  } catch { incomplete(); }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) incomplete();
  return date.toISOString();
}

function projectWashingReservation(reservationId, row) {
  if (!row || typeof row !== 'object' || !KNOWN_STATUSES.has(row.status)) incomplete();
  return {
    reservationId: sourceText(reservationId, 128, true),
    machineId: sourceText(row.machineId, 128, true),
    dormitory: sourceText(row.dormitory, 100),
    startTime: sourceText(row.startTime, 40),
    reservedUntil: washingReservationExpiry(row.reservedUntil),
    status: sourceText(row.status, 40),
  };
}

// A version binds the reviewed source; it never grants ownership or school access.
function washingReservationVersion(reservationId, row) {
  return createHash('sha256')
    .update(JSON.stringify(projectWashingReservation(reservationId, row)))
    .digest('hex');
}

function assertWashingReservationVersion(ctx, input, reservationId, row) {
  const displayFields = ['machineId', 'dormitory', 'startTime', 'reservedUntil'];
  const hasDisplay = displayFields.some((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (!ctx.agentActionKey && input.expectedReservationVersion === undefined && !hasDisplay) return null;
  if (ctx.agentActionKey && displayFields.some((field) => !Object.prototype.hasOwnProperty.call(input, field))) {
    throw new HttpsError('failed-precondition', '洗衣預約確認內容不完整，請重新查詢。');
  }
  const projected = projectWashingReservation(reservationId, row);
  if ((ctx.agentActionKey || input.expectedReservationVersion !== undefined) &&
      input.expectedReservationVersion !== washingReservationVersion(reservationId, row)) {
    throw new HttpsError('failed-precondition', '洗衣預約已變更，請重新查詢並確認。');
  }
  if (displayFields.some((field) => Object.prototype.hasOwnProperty.call(input, field) &&
      input[field] !== projected[field])) {
    throw new HttpsError('failed-precondition', '確認內容與洗衣預約不一致，請重新查詢。');
  }
  return projected;
}

module.exports = {
  projectWashingReservation,
  washingReservationVersion,
  assertWashingReservationVersion,
  washingReservationExpiry,
};
