'use strict';

const { createHash, timingSafeEqual, randomBytes: systemRandomBytes } = require('node:crypto');

const PROTOCOL = 'sha256-v1';
const RECEIPT_VERSION = 1;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validDocumentId(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value &&
    Buffer.byteLength(value, 'utf8') <= 128 && !/[\/\u0000-\u001f\u007f]/u.test(value) &&
    value !== '.' && value !== '..' && !/^__.*__$/u.test(value);
}

function timestampMillis(value) {
  try {
    if (!value || typeof value.toMillis !== 'function') return null;
    const time = value.toMillis();
    return Number.isSafeInteger(time) && time >= 0 && time <= 8_640_000_000_000_000
      ? time : null;
  } catch {
    return null;
  }
}

function hashQrToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenMatches(token, expectedHash) {
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(hashQrToken(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}

/**
 * Factory dependencies are the Admin SDK instances used by index.js. The same
 * callbacks can be tested with a transactional store without a production account.
 * A QR token is proof of possession, not proof of physical presence.
 */
function createLiveAttendanceHandlers({
  db, FieldValue, Timestamp, HttpsError,
  clock = Date.now,
  randomBytes = systemRandomBytes,
  notifySessionStarted = async () => {},
  warn = () => {},
}) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const documentId = (value, name) => {
    if (!validDocumentId(value)) fail('invalid-argument', `Invalid ${name}`);
    return value;
  };
  const authenticatedUid = (request) => {
    const uid = request?.auth?.uid;
    if (!validDocumentId(uid)) fail('unauthenticated', 'Sign in before accessing attendance');
    return uid;
  };
  const serverNow = () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
      fail('internal', 'Server clock is unavailable');
    }
    return now;
  };
  const activeMember = (snapshot) => {
    if (!snapshot.exists || snapshot.data()?.status !== 'active') {
      fail('permission-denied', 'Active group membership is required');
    }
    return snapshot.data();
  };
  const teacherMember = (snapshot) => {
    const member = activeMember(snapshot);
    if (!['owner', 'instructor'].includes(member.role)) {
      fail('permission-denied', 'Only active instructors can start attendance');
    }
    return member;
  };
  const storedReceipt = (data, uid, groupId, sessionId) => {
    const checkedAt = timestampMillis(data?.checkedInAt);
    if (data?.uid !== uid || data?.groupId !== groupId || data?.sessionId !== sessionId ||
        data?.source !== 'qr' || data?.verificationVersion !== RECEIPT_VERSION ||
        !['present', 'late'].includes(data?.status) || checkedAt === null) {
      fail('failed-precondition', 'An existing attendance decision requires instructor review');
    }
    return {
      valid: true, uid, groupId, sessionId,
      status: data.status, checkedInAt: new Date(checkedAt).toISOString(),
    };
  };

  async function startLiveSession(request) {
    const uid = authenticatedUid(request);
    const input = request?.data;
    if (!isObject(input)) fail('invalid-argument', 'Expected a session request');
    const groupId = documentId(input.groupId, 'groupId');
    const minutes = input.qrExpiryMinutes ?? 5;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 15) {
      fail('invalid-argument', 'QR lifetime must be an integer from 1 to 15 minutes');
    }
    const hasLocation = input.classroomLat !== undefined || input.classroomLng !== undefined;
    if (hasLocation && (!Number.isFinite(input.classroomLat) || !Number.isFinite(input.classroomLng) ||
        Math.abs(input.classroomLat) > 90 || Math.abs(input.classroomLng) > 180)) {
      fail('invalid-argument', 'Provide both valid classroom coordinates');
    }

    const groupRef = db.collection('groups').doc(groupId);
    const memberRef = groupRef.collection('members').doc(uid);
    const sessionId = `qr_${randomBytes(16).toString('hex')}`;
    const qrToken = randomBytes(24).toString('base64url');
    const liveRef = groupRef.collection('liveSessions').doc(sessionId);
    const attendanceRef = groupRef.collection('attendanceSessions').doc(sessionId);

    // Transaction retries regenerate the time window but not the token. No token
    // or notification is released until both documents have committed together.
    const created = await db.runTransaction(async (transaction) => {
      const group = await transaction.get(groupRef);
      const membership = await transaction.get(memberRef);
      if (!group.exists) fail('not-found', 'Group not found');
      teacherMember(membership);
      const now = serverNow();
      const startedAt = Timestamp.fromMillis(now);
      const expiresAt = Timestamp.fromMillis(now + minutes * 60_000);
      const location = hasLocation
        ? { location: { lat: input.classroomLat, lng: input.classroomLng, radiusM: 100 } } : {};
      const common = {
        sessionId, groupId, teacherId: uid, startedAt, endedAt: null,
        active: true, attendeeCount: 0, ...location,
      };
      transaction.create(liveRef, {
        ...common, qrProtocol: PROTOCOL, qrTokenHash: hashQrToken(qrToken),
        qrExpiresAt: expiresAt, reactions: { understood: 0, partial: 0, confused: 0 },
      });
      transaction.create(attendanceRef, {
        ...common, liveSessionId: sessionId, attendanceMode: 'qr',
        source: 'live_session', qrEnabled: true,
      });
      return { success: true, groupId, sessionId, qrToken, qrExpiresAt: new Date(now + minutes * 60_000).toISOString() };
    });

    // Push notifications are best-effort after persistence. A push failure must
    // not turn a committed session into an apparent failure and cause duplication.
    try {
      await notifySessionStarted({ groupId, sessionId, teacherId: uid });
    } catch {
      try { warn('Live session created; notification delivery failed'); } catch { /* noncritical */ }
    }
    return created;
  }

  async function join(request, requireAttendance) {
    const uid = authenticatedUid(request);
    const input = request?.data;
    if (!isObject(input)) fail('invalid-argument', 'Expected a check-in request');
    // groupId is a Firestore course-space ID. Never guess it from an external LMS ID.
    const groupId = documentId(input.groupId, 'groupId');
    const sessionId = documentId(input.sessionId, 'sessionId');
    const supplied = input.qrToken;
    const hasToken = supplied !== undefined && supplied !== null && supplied !== '';
    if (requireAttendance && !hasToken) fail('invalid-argument', 'A complete QR token is required');
    if (hasToken && (typeof supplied !== 'string' || supplied.trim() !== supplied ||
        supplied.length < 16 || supplied.length > 512 || /\s/u.test(supplied))) {
      fail('invalid-argument', 'Invalid QR token format');
    }

    const groupRef = db.collection('groups').doc(groupId);
    const sessionRef = groupRef.collection('liveSessions').doc(sessionId);
    const memberRef = groupRef.collection('members').doc(uid);
    const mirrorRef = groupRef.collection('attendanceSessions').doc(sessionId);
    const recordRef = mirrorRef.collection('attendanceRecords').doc(uid);

    return db.runTransaction(async (transaction) => {
      const group = await transaction.get(groupRef);
      const session = await transaction.get(sessionRef);
      const membership = await transaction.get(memberRef);
      // Authorization stays in the retried transaction, not in a stale precheck.
      const member = activeMember(membership);
      if (!group.exists || !session.exists) fail('not-found', 'Course session not found');
      const state = session.data();
      if (!isObject(state) || state.sessionId !== sessionId ||
          (state.groupId !== undefined && state.groupId !== groupId)) {
        fail('failed-precondition', 'Session metadata does not match the requested course');
      }
      const now = serverNow();

      if (hasToken) {
        if (member.role !== 'member' || state.teacherId === uid) {
          fail('permission-denied', 'Only an enrolled student can record attendance');
        }
        // Do not accept old sessions with a member-readable bearer token. An
        // instructor must close/restart them; no unsafe automatic migration.
        if (own(state, 'qrToken') || state.qrProtocol !== PROTOCOL ||
            typeof state.qrTokenHash !== 'string' || !/^[0-9a-f]{64}$/u.test(state.qrTokenHash)) {
          fail('failed-precondition', 'Restart this legacy attendance session');
        }
        if (!tokenMatches(supplied, state.qrTokenHash)) fail('permission-denied', 'Invalid QR token');

        const existing = await transaction.get(recordRef);
        if (existing.exists) {
          // A retry may retrieve the same committed receipt after session expiry.
          // This is a read-only acknowledgement, not a new attendance decision.
          const receipt = storedReceipt(existing.data(), uid, groupId, sessionId);
          return { success: true, attendanceRecorded: true, alreadyRecorded: true, ...receipt };
        }
        const mirror = await transaction.get(mirrorRef);
        if (!mirror.exists || mirror.data()?.active !== true ||
            mirror.data()?.groupId !== groupId || mirror.data()?.sessionId !== sessionId ||
            mirror.data()?.liveSessionId !== sessionId || mirror.data()?.teacherId !== state.teacherId) {
          fail('failed-precondition', 'Attendance session is missing, closed or inconsistent');
        }
      }

      if (state.active !== true || state.endedAt != null) fail('not-found', 'Session is not active');
      const startedAtMs = timestampMillis(state.startedAt);
      if (startedAtMs === null || startedAtMs > now) fail('failed-precondition', 'Session time is invalid');
      const joined = isObject(state.attendees) && own(state.attendees, uid);
      const checkedInAt = Timestamp.fromMillis(now);
      let receipt = null;
      if (hasToken) {
        const expiresAtMs = timestampMillis(state.qrExpiresAt);
        if (expiresAtMs === null || expiresAtMs <= startedAtMs) {
          fail('failed-precondition', 'QR expiry metadata is invalid');
        }
        if (now >= expiresAtMs) fail('deadline-exceeded', 'QR code has expired');
        const lateAt = state.lateAfterAt === undefined ? null : timestampMillis(state.lateAfterAt);
        if (state.lateAfterAt !== undefined && (lateAt === null || lateAt < startedAtMs)) {
          fail('failed-precondition', 'Late-attendance boundary is invalid');
        }
        const status = lateAt !== null && now > lateAt ? 'late' : 'present';
        const record = {
          uid, groupId, sessionId, status, source: 'qr', verificationVersion: RECEIPT_VERSION,
          checkedInAt,
        };
        transaction.create(recordRef, record);
        // Nested map keys keep a UID containing '.' literal. set() with dotted
        // property names would write a different field, unlike update().
        transaction.set(mirrorRef, {
          attendees: { [uid]: checkedInAt }, attendeeCount: FieldValue.increment(1),
        }, { merge: true });
        receipt = storedReceipt(record, uid, groupId, sessionId);
      }
      if (!joined) {
        transaction.set(sessionRef, {
          attendees: { [uid]: checkedInAt }, attendeeCount: FieldValue.increment(1),
        }, { merge: true });
      }
      return receipt
        ? { success: true, attendanceRecorded: true, alreadyRecorded: false, ...receipt }
        : { success: true, attendanceRecorded: false };
    });
  }

  async function endLiveSession(request) {
    const uid = authenticatedUid(request);
    const input = request?.data;
    if (!isObject(input)) fail('invalid-argument', 'Expected a session request');
    const groupId = documentId(input.groupId, 'groupId');
    const sessionId = documentId(input.sessionId, 'sessionId');
    const groupRef = db.collection('groups').doc(groupId);
    const liveRef = groupRef.collection('liveSessions').doc(sessionId);
    const mirrorRef = groupRef.collection('attendanceSessions').doc(sessionId);
    const memberRef = groupRef.collection('members').doc(uid);
    return db.runTransaction(async (transaction) => {
      const member = await transaction.get(memberRef);
      const live = await transaction.get(liveRef);
      const mirror = await transaction.get(mirrorRef);
      teacherMember(member);
      if (!live.exists || !mirror.exists) fail('not-found', 'Session not found');
      const data = live.data();
      const attendance = mirror.data();
      if (data.teacherId !== uid) fail('permission-denied', 'Only the session creator can close it');
      if ((data.groupId !== undefined && data.groupId !== groupId) || data.sessionId !== sessionId ||
          attendance.groupId !== groupId || attendance.sessionId !== sessionId ||
          attendance.teacherId !== uid || attendance.liveSessionId !== sessionId) {
        fail('failed-precondition', 'Session metadata is inconsistent');
      }
      if (data.active === false && attendance.active === false) {
        const prior = timestampMillis(data.endedAt);
        if (prior === null) fail('failed-precondition', 'Missing closure timestamp');
        return { success: true, groupId, sessionId, active: false, endedAt: new Date(prior).toISOString() };
      }
      const now = serverNow();
      const endedAt = Timestamp.fromMillis(now);
      transaction.set(liveRef, { active: false, endedAt }, { merge: true });
      transaction.set(mirrorRef, { active: false, endedAt }, { merge: true });
      return { success: true, groupId, sessionId, active: false, endedAt: new Date(now).toISOString() };
    });
  }

  return {
    startLiveSession,
    endLiveSession,
    joinLiveSession: (request) => join(request, false),
    verifyAttendanceClaim: (request) => join(request, true),
  };
}

module.exports = { createLiveAttendanceHandlers, hashQrToken };
