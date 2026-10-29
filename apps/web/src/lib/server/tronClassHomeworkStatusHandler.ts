import { createHash } from 'node:crypto';
import type { CallableRequest } from './groupInviteHandlers';
import type { AcademicFirestore } from './academicRecordsHandlers';
import { requireAcademicAccount, schoolSessionCookies, schoolSessionExpiry } from './academicRecordsHandlers';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { HttpsError } from './httpsError';

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function receiptForUser(
  records: unknown[], userId: number, expectedReceiptId: string | null, homeworkId: number,
): { receiptId: string | null; submittedAt: string | null } | null {
  for (const raw of records) {
    const item = record(raw);
    const linkedHomework = item.homework_id ?? item.homework_activity_id ?? item.activity_id;
    if (linkedHomework != null && Number(linkedHomework) !== homeworkId) continue;
    const owner = Number(item.student_id ?? item.user_id ?? NaN);
    const id = item.id ?? item.submission_id;
    const ownerKnown = Number.isSafeInteger(owner) && owner > 0;
    if (ownerKnown ? owner !== userId :
      !expectedReceiptId || id == null || String(id) !== expectedReceiptId) continue;
    const status = String(item.status ?? item.submission_status ?? '').toLowerCase();
    const submittedAt = item.submitted_at ?? item.created_at;
    if (!submittedAt && !['submitted', 'graded', 'finished'].includes(status)) continue;
    return {
      receiptId: id != null && /^[1-9][0-9]{0,19}$/.test(String(id)) ? String(id) : null,
      submittedAt: typeof submittedAt === 'string' && Number.isFinite(Date.parse(submittedAt))
        ? submittedAt : null,
    };
  }
  return null;
}

export function createTronClassHomeworkStatusHandler({
  db, source, now = Date.now,
}: {
  db: AcademicFirestore;
  source: LmsReadonlySource;
  now?: () => number;
}) {
  return async (request: CallableRequest) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    if (request.auth?.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '尚未連結靜宜大學帳號。');
    }
    const data = record(request.data);
    const courseId = positive(data.courseId);
    const homeworkId = positive(data.homeworkId);
    if (!courseId || !homeworkId ||
      Object.keys(data).some((key) => key !== 'courseId' && key !== 'homeworkId')) {
      throw new HttpsError('invalid-argument', '請選擇有效的課程與作業。');
    }
    if (!source.fetchHomeworkSubmissions) {
      throw new HttpsError('unimplemented', '目前無法查詢校方繳交紀錄。');
    }
    await requireAcademicAccount(db, uid);
    const portals = await db.collection('_puSessions').where('ownerUid', '==', uid)
      .orderBy('expiresAt', 'desc').limit(1).get();
    const portal = portals.docs[0]?.data();
    const linkedId = portal?.tronClassSessionId;
    if (portal?.ownerUid !== uid || schoolSessionExpiry(portal.expiresAt) <= now() ||
      typeof linkedId !== 'string' || !/^[a-f0-9]{32}$/.test(linkedId)) {
      throw new HttpsError('failed-precondition', '玩課雲連線已過期，請重新連線。');
    }
    const lmsSnap = await db.doc('_puTronClassSessions/' + linkedId).get();
    const session = lmsSnap.data();
    const cookies = schoolSessionCookies(session?.cookies);
    const userId = positive(session?.userId);
    if (!lmsSnap.exists || session?.ownerUid !== uid ||
      schoolSessionExpiry(session.expiresAt) <= now() || !cookies || !userId) {
      throw new HttpsError('failed-precondition', '玩課雲連線已過期，請重新連線。');
    }
    let courses: unknown;
    try {
      courses = await source.fetchCourses(cookies, { userId, status: 'ongoing' });
    } catch {
      throw new HttpsError('unavailable', '暫時無法確認修課資料，請稍後再試。');
    }
    if (!Array.isArray(courses) ||
      !courses.some((item) => positive(record(item).id) === courseId)) {
      throw new HttpsError('permission-denied', '目前修課清單不包含這門課。');
    }
    const key = createHash('sha256').update(uid + ':' + courseId + ':' + homeworkId).digest('hex');
    const lockRef = db.doc('_puTronClassHomeworkSubmissionLocks/' + key);
    const lockSnap = await lockRef.get();
    const lock = lockSnap.data();
    if (lockSnap.exists && (lock?.ownerUid !== uid ||
        lock.courseId !== courseId || lock.homeworkId !== homeworkId)) {
      throw new HttpsError('permission-denied', '作業繳交紀錄與目前帳號不一致。');
    }
    let records: unknown[];
    try {
      records = await source.fetchHomeworkSubmissions(cookies, courseId, homeworkId);
      if (!Array.isArray(records)) throw new Error('Invalid submission history');
    } catch {
      throw new HttpsError('unavailable', '暫時無法查核校方作業回執，請稍後再試。');
    }
    await requireAcademicAccount(db, uid);
    const expectedId = typeof lock?.receiptId === 'string' ? lock.receiptId : null;
    const evidence = receiptForUser(records, userId, expectedId, homeworkId);
    const checkedAt = new Date(now()).toISOString();
    if (evidence) {
      if (lockSnap.exists && typeof lockRef.set === 'function') {
        await lockRef.set({
          state: 'verified',
          receiptId: evidence.receiptId ?? expectedId,
          submittedAt: evidence.submittedAt,
          lastCheckedAt: new Date(now()),
        }, { merge: true });
      }
      return { status: 'verified' as const,
        receiptId: evidence.receiptId ?? expectedId, submittedAt: evidence.submittedAt, checkedAt };
    }
    if (lockSnap.exists && lock?.state !== 'failed') {
      return { status: 'pending' as const, receiptId: expectedId,
        submittedAt: null, checkedAt };
    }
    return { status: 'not_submitted' as const,
      receiptId: null, submittedAt: null, checkedAt };
  };
}
