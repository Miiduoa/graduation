import { createHash } from 'node:crypto';
import type { CallableRequest } from './groupInviteHandlers';
import type { AcademicFirestore } from './academicRecordsHandlers';
import { requireAcademicAccount, schoolSessionCookies, schoolSessionExpiry } from './academicRecordsHandlers';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { HttpsError } from './httpsError';
import { HOMEWORK_MAX_PAGES, HOMEWORK_PAGE_SIZE, isHomeworkSubmitted } from '@campus/shared/src/puLmsReadonly';

type Row = Record<string, unknown>;
type Result = { status: 'verified' | 'pending'; receiptId: string | null; submittedAt: string | null };

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseInput(value: unknown) {
  const data = row(value);
  const courseId = positive(data.courseId);
  const homeworkId = positive(data.homeworkId);
  const content = data.content;
  if (!courseId || !homeworkId || typeof content !== 'string' ||
      !content.trim() || content.length > 12000 || data.confirmed !== true ||
      Object.keys(data).some((key) => !['courseId', 'homeworkId', 'content', 'confirmed'].includes(key))) {
    throw new HttpsError('invalid-argument', '請確認作業、輸入 12000 字以內的文字，再同意繳交。');
  }
  return { courseId, homeworkId, content: content.trim() };
}

function isOwnReceipt(value: unknown, userId: number, receiptId: string | null): boolean {
  const item = row(value);
  const id = item.id ?? item.submission_id;
  const owner = Number(item.student_id ?? item.user_id ?? NaN);
  const status = String(item.status ?? item.submission_status ?? '').toLowerCase();
  const hasEvidence = Boolean(item.submitted_at || item.created_at ||
    ['submitted', 'graded', 'finished'].includes(status));
  if (!hasEvidence) return false;
  if (Number.isSafeInteger(owner) && owner > 0) return owner === userId;
  return Boolean(receiptId && id != null && String(id) === receiptId);
}

async function getHomework(source: LmsReadonlySource, cookies: Record<string, string>,
  courseId: number, homeworkId: number): Promise<Row> {
  for (let page = 1; page <= HOMEWORK_MAX_PAGES; page++) {
    const result = await source.fetchHomeworkPage(cookies, courseId, page, HOMEWORK_PAGE_SIZE);
    if (!result.ok) throw new HttpsError('unavailable', '目前無法確認玩課雲作業狀態，未進行繳交。');
    const entries = result.value.homework_activities;
    const match = entries.find((item) => positive(row(item).id) === homeworkId);
    if (match) return row(match);
    const total = result.value.total;
    if (entries.length < HOMEWORK_PAGE_SIZE ||
        total !== null && page * HOMEWORK_PAGE_SIZE >= total) break;
  }
  throw new HttpsError('not-found', '在目前修課資料中找不到這份作業，未進行繳交。');
}

/** 文字繳交：本人身分、即時修課、作業與原站回執缺一不可。 */
export function createTronClassHomeworkSubmitHandler({
  db, source, now = Date.now,
}: {
  db: AcademicFirestore;
  source: LmsReadonlySource;
  now?: () => number;
}) {
  return async (request: CallableRequest): Promise<Result> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    if (request.auth?.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '這個帳號沒有靜宜大學玩課雲寫入權限。');
    }
    const { courseId, homeworkId, content } = parseInput(request.data);
    if (!source.submitHomeworkText || !source.fetchHomeworkSubmissions || !db.runTransaction) {
      throw new HttpsError('unimplemented', '目前環境尚未啟用校方文字繳交。');
    }
    await requireAcademicAccount(db, uid);
    const portals = await db.collection('_puSessions').where('ownerUid', '==', uid)
      .orderBy('expiresAt', 'desc').limit(1).get();
    const portalSnap = portals.docs[0];
    const portal = portalSnap?.data();
    const linkedId = portal?.tronClassSessionId;
    if (!portalSnap || portal?.ownerUid !== uid ||
        schoolSessionExpiry(portal.expiresAt) <= now() ||
        typeof linkedId !== 'string' || !/^[a-f0-9]{32}$/.test(linkedId)) {
      throw new HttpsError('failed-precondition', '玩課雲連線已到期，請重新連線。');
    }
    const lmsRef = db.doc('_puTronClassSessions/' + linkedId);
    const session = await lmsRef.get();
    const stored = session.data();
    const cookies = schoolSessionCookies(stored?.cookies);
    const userId = positive(stored?.userId);
    if (!session.exists || stored?.ownerUid !== uid || !cookies || !userId ||
        schoolSessionExpiry(stored.expiresAt) <= now()) {
      throw new HttpsError('failed-precondition', '無法確認玩課雲本人工作階段，未進行繳交。');
    }

    // An earlier request may already have reached the school. Reject it before
    // fetching remote state, as a transient read error must not allow a second POST.
    const key = createHash('sha256').update(uid + ':' + courseId + ':' + homeworkId).digest('hex');
    const lockRef = db.doc('_puTronClassHomeworkSubmissionLocks/' + key);
    const earlier = await lockRef.get();
    if (earlier.exists && earlier.data()?.state !== 'failed') {
      throw new HttpsError('already-exists', '這份作業已有繳交請求，請先核對玩課雲狀態，避免重複繳交。');
    }

    // 不接受前端傳入課程所有權或作業狀態。
    const courses = await source.fetchCourses(cookies, { userId, status: 'ongoing' });
    if (!Array.isArray(courses) ||
        !courses.some((course) => positive(row(course).id) === courseId)) {
      throw new HttpsError('permission-denied', '目前修課清單不包含這門課，未進行繳交。');
    }
    const homework = await getHomework(source, cookies, courseId, homeworkId);
    const detail = source.fetchHomeworkDetail
      ? row(await source.fetchHomeworkDetail(cookies, courseId, homeworkId))
      : {};
    const policy = { ...homework, ...row(homework.data), ...detail, ...row(detail.data) };
    if (isHomeworkSubmitted(homework as { submitted?: unknown }) ||
        homework.is_submitted === true || policy.is_submitted === true ||
        ['submitted', 'graded'].includes(String(homework.submission_status || ''))) {
      throw new HttpsError('already-exists', '校方已顯示這份作業繳交完成，請勿重複送出。');
    }
    if (policy.closed === true || policy.is_closed === true ||
        ['closed', 'archived'].includes(String(policy.status || '').toLowerCase())) {
      throw new HttpsError('failed-precondition', '老師已關閉這份作業，無法直接繳交。');
    }
    const type = String(policy.submission_type ?? policy.submit_type ?? '').toLowerCase();
    if (['file', 'files', 'attachment', 'upload', 'file_only'].includes(type)) {
      throw new HttpsError('failed-precondition', '這份作業只接受附件，請至玩課雲上傳檔案。');
    }
    const deadline = policy.deadline ?? policy.end_time ?? policy.end_date;
    const due = typeof deadline === 'string' ? Date.parse(deadline) : NaN;
    if (Number.isFinite(due) && due < now() &&
        policy.allow_late !== true && policy.allow_late_submission !== true) {
      throw new HttpsError('failed-precondition', '作業已過截止時間，請至玩課雲確認是否可補交。');
    }
    const existing = await source.fetchHomeworkSubmissions(cookies, courseId, homeworkId);
    if (!Array.isArray(existing)) {
      throw new HttpsError('unavailable', '目前無法確認繳交歷史，未進行繳交。');
    }
    const submitted = existing.filter((item) => isOwnReceipt(item, userId, null));
    const max = Number(policy.max_submissions ?? policy.max_submission_count);
    if (Number.isSafeInteger(max) && max > 0 && submitted.length >= max) {
      throw new HttpsError('failed-precondition', '這份作業已達老師設定的繳交次數上限。');
    }
    if (submitted.length) {
      throw new HttpsError('already-exists', '玩課雲已有你的繳交紀錄，請先核對。');
    }

    // 單一使用者同一份作業只發起一次不可自動重試的 POST。
    await db.runTransaction(async (tx) => {
      const [currentPortal, currentLms, previous] = await Promise.all([
        tx.get(portalSnap.ref), tx.get(lmsRef), tx.get(lockRef),
      ]);
      if (!currentPortal.exists || currentPortal.data()?.ownerUid !== uid ||
          currentPortal.data()?.tronClassSessionId !== linkedId ||
          schoolSessionExpiry(currentPortal.data()?.expiresAt) <= now() ||
          !currentLms.exists || currentLms.data()?.ownerUid !== uid ||
          schoolSessionExpiry(currentLms.data()?.expiresAt) <= now()) {
        throw new HttpsError('failed-precondition', '連線狀態已改變，未進行繳交。');
      }
      if (previous.exists && previous.data()?.state !== 'failed') {
        throw new HttpsError('already-exists', '這份作業已有繳交請求，請先核對玩課雲狀態，避免重複繳交。');
      }
      tx.set(lockRef, { ownerUid: uid, courseId, homeworkId,
        state: 'submitting', createdAt: new Date(now()) });
    });

    let receipt: { accepted: boolean; receiptId: string | null; submittedAt: string | null };
    try {
      receipt = await source.submitHomeworkText(cookies, courseId, homeworkId, content);
    } catch {
      await lockRef.set?.({ state: 'pending', lastCheckedAt: new Date(now()) }, { merge: true });
      throw new HttpsError('unavailable', '校方回應未明，請先到玩課雲核對，避免重複送出。');
    }
    if (!receipt.accepted) {
      await lockRef.set?.({ state: 'pending' }, { merge: true });
      throw new HttpsError('unavailable', '校方沒有確認接收，請到玩課雲核對。');
    }

    let verified = false;
    try {
      const updated = await source.fetchHomeworkSubmissions(cookies, courseId, homeworkId);
      verified = updated.some((item) => isOwnReceipt(item, userId, receipt.receiptId));
    } catch {
      // 已寫入的請求絕不因確認逾時而再次 POST。
    }
    await lockRef.set?.({ state: verified ? 'verified' : 'pending',
      receiptId: receipt.receiptId, submittedAt: receipt.submittedAt,
      lastCheckedAt: new Date(now()) }, { merge: true });
    await db.doc('_puTronClassLmsCache/' + uid).delete?.().catch(() => undefined);
    return { status: verified ? 'verified' : 'pending',
      receiptId: receipt.receiptId, submittedAt: receipt.submittedAt };
  };
}
