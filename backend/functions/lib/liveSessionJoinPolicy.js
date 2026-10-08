'use strict';

/**
 * Joining a live classroom and recording attendance are separate operations.
 * A group member can enter the classroom without a QR token, but only an
 * unexpired, server-issued QR token can create an attendance record.
 */
function evaluateLiveSessionJoin({
  memberExists,
  memberStatus,
  sessionActive,
  expectedQrToken,
  qrExpiresAtMs,
  providedQrToken,
  nowMs,
}) {
  if (!sessionActive) {
    return { ok: false, code: 'not-found', message: 'Session not found or not active' };
  }

  if (
    !memberExists ||
    (memberStatus != null && memberStatus !== 'active' && memberStatus !== 'joined')
  ) {
    return { ok: false, code: 'permission-denied', message: 'Group membership required' };
  }

  if (providedQrToken == null || providedQrToken === '') {
    return { ok: true, recordAttendance: false };
  }

  if (typeof providedQrToken !== 'string' || providedQrToken !== expectedQrToken) {
    return { ok: false, code: 'permission-denied', message: 'Invalid QR token' };
  }

  if (!Number.isFinite(qrExpiresAtMs) || qrExpiresAtMs <= nowMs) {
    return { ok: false, code: 'deadline-exceeded', message: 'QR code has expired' };
  }

  return { ok: true, recordAttendance: true };
}

module.exports = { evaluateLiveSessionJoin };
