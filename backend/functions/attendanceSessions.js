const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const SCHEMA_VERSION = 2;

function documentId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${name} is invalid`);
  }
  return value;
}

function actor(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return request.auth.uid;
}

function requireMember(snapshot, instructor = false) {
  const member = snapshot.data();
  if (
    !snapshot.exists ||
    member.status !== 'active' ||
    (instructor && !['owner', 'instructor'].includes(member.role))
  ) {
    throw new HttpsError(
      'permission-denied',
      instructor
        ? 'An active instructor membership is required'
        : 'An active group membership is required',
    );
  }
  return member;
}

function timestampMillis(value) {
  const millis = value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
  return Number.isFinite(millis) ? millis : null;
}

function startOptions(data) {
  const minutes = data.qrExpiryMinutes === undefined ? 5 : data.qrExpiryMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
    throw new HttpsError('invalid-argument', 'qrExpiryMinutes must be an integer from 1 to 30');
  }
  const hasLat = data.classroomLat !== undefined && data.classroomLat !== null;
  const hasLng = data.classroomLng !== undefined && data.classroomLng !== null;
  let location = null;
  if (hasLat || hasLng) {
    if (
      !hasLat ||
      !hasLng ||
      !Number.isFinite(data.classroomLat) ||
      Math.abs(data.classroomLat) > 90 ||
      !Number.isFinite(data.classroomLng) ||
      Math.abs(data.classroomLng) > 180
    ) {
      throw new HttpsError('invalid-argument', 'A valid latitude and longitude are required');
    }
    location = { lat: data.classroomLat, lng: data.classroomLng, radiusM: 100 };
  }
  return { qrExpiryMinutes: minutes, location };
}

function profileFields(member) {
  const fields = {};
  const displayName = member.displayName || member.userName;
  if (typeof displayName === 'string' && displayName.trim()) {
    fields.displayName = displayName.trim().slice(0, 120);
  }
  if (typeof member.studentId === 'string' && member.studentId.trim()) {
    fields.studentId = member.studentId.trim().slice(0, 80);
  }
  return fields;
}

function sameToken(actual, expected) {
  if (typeof expected !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createLiveSessionHandlers({ db, now = Date.now, notifyStarted, logger = console }) {
  function refs(groupId, sessionId, uid) {
    const group = db.collection('groups').doc(groupId);
    const attendance = group.collection('attendanceSessions').doc(sessionId);
    return {
      group,
      member: group.collection('members').doc(uid),
      live: group.collection('liveSessions').doc(sessionId),
      attendance,
      secret: group.collection('liveSessionSecrets').doc(sessionId),
      record: attendance.collection('attendanceRecords').doc(uid),
    };
  }

  async function startLiveSession(request) {
    const uid = actor(request);
    const data = request.data || {};
    const groupId = documentId(data.groupId, 'groupId');
    const requestId =
      data.requestId === undefined ? randomUUID() : documentId(data.requestId, 'requestId');
    const options = startOptions(data);
    const requestHash = createHash('sha256').update(JSON.stringify(options)).digest('hex');
    // Scope retries to the caller and group, so another instructor cannot reuse a caller's key.
    const sessionId = `session_${createHash('sha256')
      .update(JSON.stringify([groupId, uid, requestId]))
      .digest('hex')}`;
    const documents = refs(groupId, sessionId, uid);
    const qrToken = randomBytes(32).toString('base64url');

    const result = await db.runTransaction(async (transaction) => {
      const [group, member, live, attendance, secret] = await transaction.getAll(
        documents.group,
        documents.member,
        documents.live,
        documents.attendance,
        documents.secret,
      );
      requireMember(member, true);
      if (!group.exists) throw new HttpsError('not-found', 'Group not found');
      if (live.exists || attendance.exists || secret.exists) {
        if (!live.exists || !attendance.exists || !secret.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Session records require administrator repair',
          );
        }
        if (secret.data().requestHash !== requestHash) {
          throw new HttpsError(
            'already-exists',
            'This requestId was used with different session settings',
          );
        }
        if (
          live.data().teacherId !== uid ||
          attendance.data().teacherId !== uid ||
          secret.data().teacherId !== uid
        ) {
          throw new HttpsError('permission-denied', 'Session ownership does not match');
        }
        const expiresAt = timestampMillis(secret.data().qrExpiresAt);
        if (expiresAt === null || live.data().active !== attendance.data().active) {
          throw new HttpsError(
            'failed-precondition',
            'Session records require administrator repair',
          );
        }
        return {
          success: true,
          sessionId,
          qrToken: secret.data().qrToken,
          qrExpiresAt: new Date(expiresAt).toISOString(),
          active: live.data().active === true,
          reused: true,
        };
      }

      const startedAt = Timestamp.fromMillis(now());
      const qrExpiresAt = Timestamp.fromMillis(
        startedAt.toMillis() + options.qrExpiryMinutes * 60_000,
      );
      const metadata = {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        groupId,
        teacherId: uid,
        startedAt,
        endedAt: null,
        active: true,
        qrExpiresAt,
        attendeeCount: 0,
        ...(options.location ? { location: options.location } : {}),
      };
      transaction.create(documents.live, {
        ...metadata,
        reactions: { understood: 0, partial: 0, confused: 0 },
      });
      transaction.create(documents.attendance, {
        ...metadata,
        liveSessionId: sessionId,
        attendanceMode: 'qr',
        source: 'live_session',
        qrEnabled: true,
      });
      transaction.create(documents.secret, { teacherId: uid, qrToken, qrExpiresAt, requestHash });
      return {
        success: true,
        sessionId,
        qrToken,
        qrExpiresAt: qrExpiresAt.toDate().toISOString(),
        active: true,
        reused: false,
      };
    });

    if (!result.reused && notifyStarted) {
      try {
        await notifyStarted({ groupId, sessionId, uid });
      } catch (error) {
        // A notification failure must never turn an already committed start into a failed request.
        logger.warn('Live session started; notification delivery failed', {
          groupId,
          sessionId,
          code: error.code || 'unknown',
        });
      }
    }
    return result;
  }

  async function endLiveSession(request) {
    const uid = actor(request);
    const data = request.data || {};
    const groupId = documentId(data.groupId, 'groupId');
    const sessionId = documentId(data.sessionId, 'sessionId');
    const documents = refs(groupId, sessionId, uid);
    return db.runTransaction(async (transaction) => {
      const [member, live, attendance] = await transaction.getAll(
        documents.member,
        documents.live,
        documents.attendance,
      );
      requireMember(member, true);
      if (!live.exists) throw new HttpsError('not-found', 'Session not found');
      if (live.data().teacherId !== uid)
        throw new HttpsError('permission-denied', 'Only the session instructor can end it');
      if (
        !attendance.exists ||
        attendance.data().teacherId !== uid ||
        attendance.data().active !== live.data().active
      ) {
        throw new HttpsError('failed-precondition', 'Session records require administrator repair');
      }
      if (live.data().active === false) return { success: true, alreadyEnded: true };
      if (live.data().active !== true)
        throw new HttpsError('failed-precondition', 'Invalid session status');
      const endedAt = Timestamp.fromMillis(now());
      transaction.update(documents.live, { active: false, endedAt });
      transaction.update(documents.attendance, { active: false, endedAt });
      return { success: true, alreadyEnded: false };
    });
  }

  async function joinLiveSession(request) {
    const uid = actor(request);
    const data = request.data || {};
    const groupId = documentId(data.groupId, 'groupId');
    const sessionId = documentId(data.sessionId, 'sessionId');
    if (typeof data.qrToken !== 'string' || data.qrToken.length < 16 || data.qrToken.length > 512) {
      throw new HttpsError('invalid-argument', 'A valid QR token is required');
    }
    const documents = refs(groupId, sessionId, uid);
    return db.runTransaction(async (transaction) => {
      const [member, live, attendance, secret, record] = await transaction.getAll(
        documents.member,
        documents.live,
        documents.attendance,
        documents.secret,
        documents.record,
      );
      const membership = requireMember(member);
      if (
        !live.exists ||
        !attendance.exists ||
        live.data().active !== true ||
        attendance.data().active !== true
      ) {
        throw new HttpsError('failed-precondition', 'Session is not active');
      }
      // Legacy sessions exposed their token publicly. Never accept that token as proof of attendance.
      if (
        live.data().schemaVersion !== SCHEMA_VERSION ||
        attendance.data().schemaVersion !== SCHEMA_VERSION ||
        !secret.exists
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Ask the instructor to start a new attendance session',
        );
      }
      if (!sameToken(data.qrToken, secret.data().qrToken))
        throw new HttpsError('permission-denied', 'Invalid QR token');
      const checkedInMillis = now();
      const expiresAt = timestampMillis(secret.data().qrExpiresAt);
      if (expiresAt === null || checkedInMillis >= expiresAt)
        throw new HttpsError('deadline-exceeded', 'QR code has expired');
      if (record.exists) {
        const existing = record.data();
        const confirmedAt = timestampMillis(existing.checkedInAt);
        if (
          existing.uid !== uid ||
          existing.sessionId !== sessionId ||
          existing.groupId !== groupId ||
          confirmedAt === null ||
          existing.status !== 'present'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Attendance record requires administrator repair',
          );
        }
        return {
          success: true,
          alreadyJoined: true,
          checkedInAt: new Date(confirmedAt).toISOString(),
        };
      }
      const checkedInAt = Timestamp.fromMillis(checkedInMillis);
      transaction.create(documents.record, {
        uid,
        sessionId,
        groupId,
        status: 'present',
        source: 'qr',
        checkedInAt,
        ...profileFields(membership),
      });
      transaction.update(documents.live, { attendeeCount: FieldValue.increment(1) });
      transaction.update(documents.attendance, { attendeeCount: FieldValue.increment(1) });
      return {
        success: true,
        alreadyJoined: false,
        checkedInAt: checkedInAt.toDate().toISOString(),
      };
    });
  }

  return { startLiveSession, endLiveSession, joinLiveSession };
}

module.exports = { createLiveSessionHandlers };
