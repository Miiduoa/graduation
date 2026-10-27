import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from './httpsError';
import type { CallableRequest, GroupFirestore } from './groupInviteHandlers';

const SCHEMA_VERSION = 2;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function documentId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${name} is invalid`);
  }
  return value;
}

function actor(request: CallableRequest): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return request.auth.uid;
}

function requireMember(
  snapshot: { exists: boolean; data: () => Record<string, unknown> },
  instructor = false,
) {
  const member = snapshot.data();
  if (
    !snapshot.exists ||
    member.status !== 'active' ||
    (instructor && !['owner', 'instructor'].includes(String(member.role)))
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

function timestampMillis(value: unknown): number | null {
  const millis =
    value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
      ? (value as { toMillis: () => number }).toMillis()
      : NaN;
  return Number.isFinite(millis) ? millis : null;
}

function startOptions(data: Record<string, unknown>) {
  const minutes = data.qrExpiryMinutes === undefined ? 5 : data.qrExpiryMinutes;
  if (!Number.isInteger(minutes) || Number(minutes) < 1 || Number(minutes) > 30) {
    throw new HttpsError('invalid-argument', 'qrExpiryMinutes must be an integer from 1 to 30');
  }
  const hasLat = data.classroomLat !== undefined && data.classroomLat !== null;
  const hasLng = data.classroomLng !== undefined && data.classroomLng !== null;
  let location: { lat: number; lng: number; radiusM: number } | null = null;
  if (hasLat || hasLng) {
    if (
      !hasLat ||
      !hasLng ||
      !Number.isFinite(data.classroomLat) ||
      Math.abs(Number(data.classroomLat)) > 90 ||
      !Number.isFinite(data.classroomLng) ||
      Math.abs(Number(data.classroomLng)) > 180
    ) {
      throw new HttpsError('invalid-argument', 'A valid latitude and longitude are required');
    }
    location = { lat: Number(data.classroomLat), lng: Number(data.classroomLng), radiusM: 100 };
  }
  return { qrExpiryMinutes: Number(minutes), location };
}

function profileFields(member: Record<string, unknown>) {
  const fields: { displayName?: string; studentId?: string } = {};
  const displayName = member.displayName || member.userName;
  if (typeof displayName === 'string' && displayName.trim()) {
    fields.displayName = displayName.trim().slice(0, 120);
  }
  if (typeof member.studentId === 'string' && member.studentId.trim()) {
    fields.studentId = member.studentId.trim().slice(0, 80);
  }
  return fields;
}

function sameToken(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionIdsFromQuery(snapshot: { docs?: Array<{ id?: string }> } | null | undefined) {
  const ids: string[] = [];
  const docs = snapshot && Array.isArray(snapshot.docs) ? snapshot.docs : [];
  for (const entry of docs) {
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (id) ids.push(id);
  }
  return ids;
}

type DocSnap = { exists: boolean; data: () => Record<string, unknown> };
type SessionTransaction = {
  get: (query: unknown) => Promise<{ docs?: Array<{ id?: string }> }>;
  getAll: (...refs: unknown[]) => Promise<DocSnap[]>;
  create: (ref: unknown, data: unknown) => void;
  update: (ref: unknown, data: unknown) => void;
};

export function createLiveSessionHandlers({
  db,
  now = Date.now,
  notifyStarted,
  logger = console,
}: {
  db: GroupFirestore;
  now?: () => number;
  notifyStarted?: (input: { groupId: string; sessionId: string; uid: string }) => Promise<void>;
  logger?: { warn: (...args: unknown[]) => void };
}) {
  function refs(groupId: string, sessionId: string, uid: string) {
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

  async function otherActiveSessionIds(
    transaction: SessionTransaction,
    group: {
      collection: (name: string) => {
        where: (field: string, op: string, value: unknown) => unknown;
      };
    },
    sessionId: string,
  ) {
    const [activeLive, activeAttendance] = await Promise.all([
      transaction.get(group.collection('liveSessions').where('active', '==', true)),
      transaction.get(group.collection('attendanceSessions').where('active', '==', true)),
    ]);
    return [
      ...new Set([...sessionIdsFromQuery(activeLive), ...sessionIdsFromQuery(activeAttendance)]),
    ].filter((id) => id !== sessionId);
  }

  function closeActiveSession(
    transaction: SessionTransaction,
    documents: { live: unknown; attendance: unknown },
    endedAt: unknown,
  ) {
    transaction.update(documents.live, { active: false, endedAt });
    transaction.update(documents.attendance, { active: false, endedAt });
  }

  async function closeOtherActiveSessions(
    transaction: SessionTransaction,
    groupId: string,
    sessionId: string,
    endedAt: unknown,
  ) {
    const group = db.collection('groups').doc(groupId);
    const otherIds = await otherActiveSessionIds(transaction, group, sessionId);
    if (otherIds.length === 0) return;
    const extra = [];
    for (const id of otherIds) {
      extra.push(
        group.collection('liveSessions').doc(id),
        group.collection('attendanceSessions').doc(id),
      );
    }
    const snapshots = await transaction.getAll(...extra);
    for (let index = 0; index < otherIds.length; index += 1) {
      const live = snapshots[index * 2];
      const attendance = snapshots[index * 2 + 1];
      if (!live.exists || !attendance.exists || live.data().active !== attendance.data().active) {
        throw new HttpsError('failed-precondition', 'Session records require administrator repair');
      }
      if (live.data().active !== true) continue;
      closeActiveSession(
        transaction,
        {
          live: extra[index * 2],
          attendance: extra[index * 2 + 1],
        },
        endedAt,
      );
    }
  }

  async function startLiveSession(request: CallableRequest) {
    const uid = actor(request);
    const data = asRecord(request.data);
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
        if (live.data().active === true) {
          await closeOtherActiveSessions(
            transaction,
            groupId,
            sessionId,
            Timestamp.fromMillis(now()),
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
      await closeOtherActiveSessions(transaction, groupId, sessionId, startedAt);
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
        logger.warn('Live session started; notification delivery failed', {
          groupId,
          sessionId,
          code: (error as { code?: unknown }).code || 'unknown',
        });
      }
    }
    return result;
  }

  async function endLiveSession(request: CallableRequest) {
    const uid = actor(request);
    const data = asRecord(request.data);
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

  async function joinLiveSession(request: CallableRequest) {
    const uid = actor(request);
    const data = asRecord(request.data);
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
      if (!live.exists || !attendance.exists) {
        throw new HttpsError('failed-precondition', 'Session records are missing');
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
        // A lost response can be retried after the attendance window closes.
        // Current membership, the private token and the receipt identity still apply.
        return {
          success: true,
          alreadyJoined: true,
          checkedInAt: new Date(confirmedAt).toISOString(),
        };
      }
      if (live.data().active !== true || attendance.data().active !== true) {
        throw new HttpsError('failed-precondition', 'Session is not active');
      }
      const checkedInMillis = now();
      const expiresAt = timestampMillis(secret.data().qrExpiresAt);
      if (expiresAt === null || checkedInMillis >= expiresAt)
        throw new HttpsError('deadline-exceeded', 'QR code has expired');
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


  async function correctAttendanceRecord(request: CallableRequest) {
    const teacherUid = actor(request);
    const data = asRecord(request.data);
    const groupId = documentId(data.groupId, 'groupId');
    const sessionId = documentId(data.sessionId, 'sessionId');
    const studentUid = documentId(data.studentUid, 'studentUid');
    const requestId =
      data.requestId === undefined ? randomUUID() : documentId(data.requestId, 'requestId');
    if (teacherUid === studentUid)
      throw new HttpsError('permission-denied', 'Cannot correct your own record');
    const status = data.status;
    if (typeof status !== 'string' || !['present', 'late', 'absent', 'excused'].includes(status))
      throw new HttpsError('invalid-argument', 'A supported attendance status is required');
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (reason.length < 6 || reason.length > 300)
      throw new HttpsError('invalid-argument', 'A reason between 6 and 300 characters is required');

    const group = db.collection('groups').doc(groupId);
    const attendance = group.collection('attendanceSessions').doc(sessionId);
    const record = attendance.collection('attendanceRecords').doc(studentUid);
    const correctionId = `correction_${createHash('sha256')
      .update(JSON.stringify([groupId, sessionId, teacherUid, requestId]))
      .digest('hex')}`;
    const correction = attendance.collection('attendanceCorrections').doc(correctionId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify([studentUid, status, reason]))
      .digest('hex');

    return db.runTransaction(async (transaction: SessionTransaction) => {
      const [teacher, student, liveSnap, attendanceSnap, recordSnap, auditSnap] =
        await transaction.getAll(
          group.collection('members').doc(teacherUid),
          group.collection('members').doc(studentUid),
          group.collection('liveSessions').doc(sessionId),
          attendance,
          record,
          correction,
        );
      requireMember(teacher, true);
      const membership = requireMember(student);
      if (!['member', 'student'].includes(String(membership.role)))
        throw new HttpsError('permission-denied', 'Target must be an active student member');
      if (
        !liveSnap.exists ||
        !attendanceSnap.exists ||
        liveSnap.data().schemaVersion !== SCHEMA_VERSION ||
        attendanceSnap.data().schemaVersion !== SCHEMA_VERSION ||
        liveSnap.data().groupId !== groupId ||
        attendanceSnap.data().groupId !== groupId ||
        liveSnap.data().sessionId !== sessionId ||
        attendanceSnap.data().sessionId !== sessionId ||
        liveSnap.data().active !== attendanceSnap.data().active
      ) {
        throw new HttpsError('failed-precondition', 'An active course record is required');
      }

      if (auditSnap.exists) {
        if (auditSnap.data().requestHash !== requestHash)
          throw new HttpsError('already-exists', 'Request ID already used for another correction');
        return {
          success: true,
          reused: true,
          status: auditSnap.data().nextStatus,
        };
      }

      // Do not finalize an absence or excused status while students can still sign in.
      if (liveSnap.data().active === true && ['absent', 'excused'].includes(status)) {
        throw new HttpsError('failed-precondition', 'Finish the attendance session before finalizing absence or leave');
      }
      const previous = recordSnap.exists ? recordSnap.data() : null;
      if (
        previous &&
        (previous.uid !== studentUid ||
          previous.groupId !== groupId ||
          previous.sessionId !== sessionId ||
          !['present', 'late', 'absent', 'excused'].includes(String(previous.status)))
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Attendance record requires administrator repair',
        );
      }
      const previousStatus = previous ? String(previous.status) : null;
      const wasPresent = previousStatus === 'present' || previousStatus === 'late';
      const isPresent = status === 'present' || status === 'late';
      const delta = Number(isPresent) - Number(wasPresent);
      const liveCount = liveSnap.data().attendeeCount;
      const attendanceCount = attendanceSnap.data().attendeeCount;
      if (
        typeof liveCount !== 'number' ||
        typeof attendanceCount !== 'number' ||
        !Number.isSafeInteger(liveCount) ||
        !Number.isSafeInteger(attendanceCount) ||
        liveCount !== attendanceCount ||
        liveCount < 0 ||
        (delta < 0 && liveCount < 1)
      ) {
        throw new HttpsError('failed-precondition', 'Attendance counts require administrator repair');
      }
      const correctedAt = Timestamp.fromMillis(now());
      const oldMillis = timestampMillis(previous?.checkedInAt);
      const checkedInAt = isPresent
        ? Timestamp.fromMillis(wasPresent && oldMillis !== null ? oldMillis : correctedAt.toMillis())
        : null;
      const updatedRecord = {
        uid: studentUid,
        groupId,
        sessionId,
        status,
        source: 'manual',
        checkedInAt,
        correctedBy: teacherUid,
        correctedAt,
        ...profileFields(membership),
      };
      if (recordSnap.exists) transaction.update(record, updatedRecord);
      else transaction.create(record, updatedRecord);
      if (delta !== 0) {
        transaction.update(attendance, { attendeeCount: FieldValue.increment(delta) });
        transaction.update(group.collection('liveSessions').doc(sessionId), {
          attendeeCount: FieldValue.increment(delta),
        });
      }
      transaction.create(correction, {
        requestHash,
        requestId,
        groupId,
        sessionId,
        studentUid,
        teacherUid,
        previousStatus,
        nextStatus: status,
        reason,
        correctedAt,
      });
      return {
        success: true,
        reused: false,
        status,
        checkedInAt: checkedInAt ? checkedInAt.toDate().toISOString() : null,
      };
    });
  }

  return { startLiveSession, endLiveSession, joinLiveSession, correctAttendanceRecord };
}
