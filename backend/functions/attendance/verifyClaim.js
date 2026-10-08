'use strict';

const { timingSafeEqual } = require('node:crypto');

function isDocumentId(value, maximum = 200) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\x00-\x1f\x7f/]/.test(value)
    && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

function timestampMillis(value) {
  try {
    const milliseconds = value instanceof Date ? value.getTime() : value?.toMillis?.();
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
  } catch {
    return null;
  }
}

function matchesToken(expected, supplied) {
  if (typeof expected !== 'string' || expected.length === 0 || expected.length > 1024) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * QR check-in for sessions created by startLiveSession. Course IDs are exact
 * groups/{id} document IDs, not TronClass IDs or a client-provided session config.
 * Dependencies are explicit so the same handler is exercised against the emulator.
 */
function createVerifyAttendanceClaim({ db, FieldValue, Timestamp, HttpsError, clock = Date.now }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };

  return async function verifyAttendanceClaim(request) {
    const uid = request?.auth?.uid;
    if (!isDocumentId(uid, 128)) fail('unauthenticated', 'Sign in before checking attendance.');
    const data = request?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      fail('invalid-argument', 'Expected an attendance request.');
    }
    const { courseId, sessionId, claim } = data;
    if (!isDocumentId(courseId) || !isDocumentId(sessionId)) {
      fail('invalid-argument', 'Invalid course or session ID.');
    }
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      fail('invalid-argument', 'A QR claim is required.');
    }
    if (claim.uid !== undefined && claim.uid !== uid) {
      fail('permission-denied', 'A check-in cannot be submitted for another account.');
    }
    if (typeof claim.token !== 'string' || claim.token.length === 0 || claim.token.length > 1024) {
      fail('invalid-argument', 'The complete classroom QR token is required.');
    }

    const groupRef = db.collection('groups').doc(courseId);
    const memberRef = groupRef.collection('members').doc(uid);
    const liveRef = groupRef.collection('liveSessions').doc(sessionId);
    const sessionRef = groupRef.collection('attendanceSessions').doc(sessionId);
    const recordRef = sessionRef.collection('attendanceRecords').doc(uid);

    // Returning the transaction's result waits for the commit, not just the writes.
    return db.runTransaction(async (transaction) => {
      const group = await transaction.get(groupRef);
      const member = await transaction.get(memberRef);
      const live = await transaction.get(liveRef);
      const session = await transaction.get(sessionRef);
      const record = await transaction.get(recordRef);
      const membership = member.data();
      if (!group.exists || group.data()?.status === 'deleted' || group.data()?.status === 'archived'
          || !member.exists || membership?.status !== 'active'
          || !['member', 'student', 'ta'].includes(membership?.role)) {
        fail('permission-denied', 'An active student membership is required.');
      }
      if (!live.exists || !session.exists) fail('not-found', 'Attendance session not found.');
      const liveData = live.data();
      const sessionData = session.data();
      if (liveData?.teacherId === uid) fail('permission-denied', 'The teacher cannot check in as a student.');
      if (sessionData?.groupId !== courseId || sessionData?.liveSessionId !== sessionId
          || sessionData?.source !== 'live_session' || sessionData?.attendanceMode !== 'qr') {
        fail('failed-precondition', 'This endpoint supports the live classroom QR workflow only.');
      }

      const receipt = (status, checkedInAt, alreadyRecorded) => ({
        valid: true, attendanceRecorded: true, status, uid, courseId, sessionId,
        checkedInAt: new Date(checkedInAt).toISOString(), alreadyRecorded,
      });
      if (record.exists) {
        const previous = record.data();
        const previousTime = timestampMillis(previous?.checkedInAt);
        if (previous?.uid !== uid || previous?.groupId !== courseId || previous?.sessionId !== sessionId
            || !['present', 'late'].includes(previous?.status) || previousTime === null) {
          fail('failed-precondition', 'Existing attendance requires teacher review.');
        }
        // A lost-response retry returns the original receipt, even after QR expiry.
        // It must not overwrite a teacher's grade/status or change the first timestamp.
        return receipt(previous.status, previousTime, true);
      }

      if (liveData?.active !== true || sessionData?.active !== true) {
        fail('failed-precondition', 'Attendance is not open.');
      }
      const now = clock();
      const started = timestampMillis(liveData.startedAt);
      const expires = timestampMillis(liveData.qrExpiresAt);
      const lateAt = liveData.lateAfterAt == null ? null : timestampMillis(liveData.lateAfterAt);
      const closes = liveData.closesAt == null ? null : timestampMillis(liveData.closesAt);
      if (!Number.isSafeInteger(now) || now < 0 || started === null || expires === null
          || expires <= started || (liveData.lateAfterAt != null && (lateAt === null || lateAt < started))
          || (liveData.closesAt != null && (closes === null || closes <= started))) {
        fail('failed-precondition', 'The server session timing is incomplete.');
      }
      if (now < started) fail('failed-precondition', 'Attendance has not started.');
      if (now >= expires || (closes !== null && now >= closes)) {
        fail('deadline-exceeded', 'The classroom QR or attendance window has expired.');
      }
      if (!matchesToken(liveData.qrToken, claim.token)) fail('permission-denied', 'Invalid classroom QR.');
      const count = sessionData.attendeeCount ?? 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) {
        fail('failed-precondition', 'Attendance count requires repair.');
      }
      const status = lateAt !== null && now > lateAt ? 'late' : 'present';
      const checkedInAt = Timestamp.fromMillis(now);
      transaction.create(recordRef, {
        uid, groupId: courseId, sessionId, status, source: 'qr', checkedInAt,
      });
      // A nested map preserves UIDs containing dots as literal keys.
      transaction.set(sessionRef, {
        attendees: { [uid]: checkedInAt }, attendeeCount: FieldValue.increment(1),
      }, { merge: true });
      return receipt(status, now, false);
    });
  };
}

module.exports = { createVerifyAttendanceClaim };
