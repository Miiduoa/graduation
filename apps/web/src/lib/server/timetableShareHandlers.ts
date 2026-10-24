import { randomBytes, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MAX_PERIOD_SLOTS } from '@campus/shared';
import { HttpsError } from './httpsError';
import type { CallableRequest, GroupFirestore } from './groupInviteHandlers';

const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COURSES = 80;
const COURSE_COLORS = ['violet', 'blue', 'mint', 'orange', 'pink', 'lime', 'gray'] as const;

function text(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new HttpsError('invalid-argument', 'Invalid text');
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Explicit school segment only: lowercase letters/numbers/hyphen/underscore, 1–80 chars. */
function requireSchoolId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', '請先選擇學校，再分享課表。');
  }
  const schoolId = value.trim();
  if (!schoolId || schoolId.length > 80 || !/^[a-z0-9_-]+$/.test(schoolId)) {
    throw new HttpsError('invalid-argument', '請先選擇學校，再分享課表。');
  }
  return schoolId;
}

function user(request: CallableRequest, message: string): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', message);
  return request.auth.uid;
}

function cleanCourse(input: Record<string, unknown> = {}) {
  let day = Number(input.day);
  let start = Number(input.start);
  let end = Number(input.end);
  if (!Number.isInteger(day) || day < 0 || day > 5) day = 0;
  if (day === 0) {
    start = 0;
    end = 0;
  } else {
    if (!Number.isInteger(start) || start < 1 || start > MAX_PERIOD_SLOTS) start = 1;
    if (!Number.isInteger(end) || end < start || end > MAX_PERIOD_SLOTS) end = start;
  }
  const color = COURSE_COLORS.includes(input.color as (typeof COURSE_COLORS)[number])
    ? (input.color as (typeof COURSE_COLORS)[number])
    : 'gray';
  return {
    id: optionalText(input.id, 120).slice(0, 120) || randomUUID(),
    name: optionalText(input.name, 100) || '未命名課程',
    day,
    start,
    end,
    teacher: optionalText(input.teacher, 80),
    room: optionalText(input.room, 80),
    color,
  };
}

/**
 * Public share meta only keeps timetable display fields. The original callable
 * copied `record.meta` as-is; extra keys such as email or studentId are dropped.
 */
function publicMeta(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const meta: Record<string, unknown> = {};
  if ('school' in record) meta.school = optionalText(record.school, 80);
  if ('year' in record) meta.year = optionalText(record.year, 12);
  if ('semester' in record) meta.semester = optionalText(record.semester, 12);
  if ('className' in record) meta.className = optionalText(record.className, 80);
  if ('title' in record) meta.title = optionalText(record.title, 80);
  if ('credits' in record) {
    const credits = Number(record.credits);
    meta.credits = Number.isFinite(credits) ? Math.max(0, Math.min(60, credits)) : 0;
  }
  return meta;
}

function shareCourses(record: Record<string, unknown>) {
  const courses = Array.isArray(record.courses)
    ? record.courses
        .slice(0, MAX_COURSES)
        .map((course) => ({ ...cleanCourse(asRecord(course)), teacher: '' }))
    : [];
  if (!courses.length)
    throw new HttpsError('failed-precondition', '課表是空的，沒有可分享的內容。');
  return courses;
}

export { cleanCourse };

export function createTimetableShareHandlers({ db }: { db: GroupFirestore }) {
  async function createTimetableShare(request: CallableRequest) {
    const uid = user(request, '請先登入再建立分享連結。');
    const payload = asRecord(request.data);
    const schoolId = requireSchoolId(payload.schoolId);
    const token = randomBytes(16).toString('base64url');
    const expiresAt = Timestamp.fromMillis(Date.now() + SHARE_TTL_MS);
    const ownerRef = db.collection('timetableShareOwners').doc(token);
    const shareRef = db.collection('timetableShares').doc(token);

    await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const scopedRef = userRef
        .collection('schools')
        .doc(schoolId)
        .collection('personalTimetable')
        .doc('current');
      const scopedSnap = await transaction.get(scopedRef);
      let record: Record<string, unknown>;
      if (scopedSnap.exists) {
        record = scopedSnap.data() || {};
        if (record.schoolId !== schoolId) {
          throw new HttpsError(
            'failed-precondition',
            '無法確認這份課表所屬的學校，請重新載入後再分享。',
          );
        }
      } else {
        const legacyRef = userRef.collection('personalTimetable').doc('current');
        const legacySnap = await transaction.get(legacyRef);
        if (!legacySnap.exists) {
          throw new HttpsError('not-found', '還沒有可分享的課表。');
        }
        record = legacySnap.data() || {};
        if (record.schoolId !== schoolId) {
          throw new HttpsError(
            'failed-precondition',
            '無法確認這份課表所屬的學校，請重新載入後再分享。',
          );
        }
      }

      const courses = shareCourses(record);
      const meta = publicMeta(record.meta);
      const name =
        optionalText((asRecord(record.meta).title as string) || payload.name, 40) || '課表';

      transaction.set(ownerRef, {
        ownerUid: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(shareRef, {
        schoolId,
        name,
        courses,
        meta,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        revoked: false,
      });
    });

    return { token, expiresAt: expiresAt.toDate().toISOString(), path: `/timetable/s/${token}` };
  }

  async function revokeTimetableShare(request: CallableRequest) {
    const uid = user(request, '請先登入。');
    const payload = asRecord(request.data);
    const token = text(payload.token, 80, 'token');
    if (token.includes('/')) {
      throw new HttpsError('invalid-argument', 'Invalid token');
    }
    const shareRef = db.collection('timetableShares').doc(token);
    const ownerRef = db.collection('timetableShareOwners').doc(token);

    return db.runTransaction(async (transaction) => {
      const [snapshot, owner] = await Promise.all([
        transaction.get(shareRef),
        transaction.get(ownerRef),
      ]);
      const share = snapshot.exists ? snapshot.data() || {} : {};
      const ownerUid = owner.exists ? owner.data()?.ownerUid : share.ownerUid;
      if (!snapshot.exists || ownerUid !== uid) {
        throw new HttpsError('not-found', '找不到這份分享連結。');
      }
      if (share.revoked === true) {
        return { ok: true };
      }
      transaction.update(shareRef, { revoked: true, revokedAt: FieldValue.serverTimestamp() });
      return { ok: true };
    });
  }

  return { createTimetableShare, revokeTimetableShare };
}
