'use strict';

const { createHash } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');

const CLAIM_COLLECTION = 'notificationClaims';
const FANOUT_BATCH_SIZE = 1000;
/** 處理中 lease 預設 5 分鐘；逾時／進程被殺後可被重試接手。 */
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const TEACHING_ROLES = new Set(['instructor', 'owner', 'teacher', 'ta']);
/** 校園公告受眾：明確 allowlist；空 role 不推。含既有教職員代表角色。 */
const CAMPUS_AUDIENCE_ROLES = new Set(['student', 'teacher', 'admin', 'staff', 'editor']);

function safeId(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..'
    ? value
    : null;
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** claim／inbox 文件 id：sha256(eventKey)，避免複合鍵超長被 safeId 靜默拒絕。 */
function hashEventKey(eventKey) {
  return createHash('sha256').update(String(eventKey), 'utf8').digest('hex');
}

function recipientEventKey(eventKey, uid) {
  return `${eventKey}__uid__${uid}`;
}

function isLeaseActive(data, nowMs, leaseTtlMs) {
  if (!data || data.status !== 'processing') return false;
  const processingAt = Number(data.processingAt);
  if (!Number.isFinite(processingAt)) return false;
  return processingAt + leaseTtlMs > nowMs;
}

/**
 * 取得發送權：新建 processing lease，或接手已過期 lease。
 * 跳過 completed、未過期 lease、以及舊版無 status 的 create-only claim（視為已完成）。
 * 回傳 true 表示本呼叫取得發送權；false 表示應略過。
 */
async function claimNotificationEvent(db, eventKey, meta = {}, opts = {}) {
  if (typeof eventKey !== 'string' || !eventKey) return false;
  const docId = hashEventKey(eventKey);
  const ref = db.collection(CLAIM_COLLECTION).doc(docId);
  const nowMs = opts.nowMs ?? Date.now();
  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leasePayload = {
    eventKey,
    ...meta,
    status: 'processing',
    processingAt: nowMs,
    claimedAt: FieldValue.serverTimestamp(),
  };

  const decide = (snap) => {
    if (!snap.exists) return { action: 'create' };
    const data = typeof snap.data === 'function' ? snap.data() : snap.data;
    const row = data || {};
    if (row.status === 'completed') return { action: 'skip' };
    // 舊版僅 create、無 status／processingAt → 視為已送達，避免重送
    if (row.status == null) return { action: 'skip' };
    if (isLeaseActive(row, nowMs, leaseTtlMs)) return { action: 'skip' };
    return { action: 'takeover' };
  };

  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const decision = decide(snap);
      if (decision.action === 'skip') return false;
      if (decision.action === 'create') {
        if (typeof tx.create === 'function') {
          tx.create(ref, leasePayload);
        } else {
          tx.set(ref, leasePayload);
        }
        return true;
      }
      if (typeof tx.set === 'function') {
        tx.set(ref, leasePayload);
      } else {
        tx.update(ref, leasePayload);
      }
      return true;
    });
  }

  const snap = await ref.get();
  const decision = decide(snap);
  if (decision.action === 'skip') return false;
  if (decision.action === 'create') {
    try {
      await ref.create(leasePayload);
      return true;
    } catch (error) {
      if (error?.code === 6 || error?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(error))) {
        return false;
      }
      throw error;
    }
  }
  if (typeof ref.set === 'function') {
    await ref.set(leasePayload);
  } else {
    await ref.update(leasePayload);
  }
  return true;
}

/** 送達成功後標記 completed；重試會跳過。 */
async function completeNotificationClaim(db, eventKey) {
  if (typeof eventKey !== 'string' || !eventKey) return;
  const docId = hashEventKey(eventKey);
  const ref = db.collection(CLAIM_COLLECTION).doc(docId);
  const payload = {
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
    processingAt: null,
  };
  if (typeof ref.set === 'function') {
    await ref.set(payload, { merge: true });
  } else {
    await ref.update(payload);
  }
}

/**
 * 明確失敗時釋放 processing lease，讓觸發器可立即重試。
 * 已 completed 者不刪，避免誤清成功紀錄。
 */
async function releaseNotificationClaim(db, eventKey) {
  if (typeof eventKey !== 'string' || !eventKey) return;
  const docId = hashEventKey(eventKey);
  const ref = db.collection(CLAIM_COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() || {};
  if (data.status === 'completed') return;
  await ref.delete();
}

async function writeInboxNotification(db, uid, notificationId, payload) {
  const userId = safeId(uid);
  const id = safeId(notificationId);
  if (!userId || !id) {
    throw new Error('Invalid inbox notification path');
  }
  await db
    .collection('users')
    .doc(userId)
    .collection('notifications')
    .doc(id)
    .set(
      {
        title: payload.title,
        body: payload.body,
        type: payload.type,
        read: false,
        schoolId: payload.schoolId || null,
        data: payload.data || {},
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function deliverToUser({
  db,
  sendPushToUser,
  uid,
  inboxId,
  title,
  body,
  type,
  schoolId,
  data,
  category,
  log = console,
}) {
  try {
    await writeInboxNotification(db, uid, inboxId, {
      title,
      body,
      type,
      schoolId,
      data: { type, ...data },
    });
  } catch (error) {
    log.error('[coherenceNotify] inbox write failed', { uid, inboxId, error: String(error) });
    throw error;
  }
  try {
    await sendPushToUser(uid, { title, body }, { type, ...data }, category);
  } catch (error) {
    log.error('[coherenceNotify] push failed', { uid, type, error: String(error) });
    throw error;
  }
}

/**
 * 單收件人：lease → 送達 → completed；失敗釋放 lease 並丟錯以便重試。
 */
async function claimAndDeliverToUser({
  db,
  sendPushToUser,
  claim,
  releaseClaim,
  completeClaim,
  eventKey,
  claimMeta,
  uid,
  title,
  body,
  type,
  schoolId,
  data,
  category,
  claimOpts = {},
  log = console,
}) {
  if (!(await claim(db, eventKey, claimMeta, claimOpts))) {
    return { status: 'duplicate' };
  }
  try {
    await deliverToUser({
      db,
      sendPushToUser,
      uid,
      inboxId: hashEventKey(eventKey),
      title,
      body,
      type,
      schoolId,
      data,
      category,
      log,
    });
    await completeClaim(db, eventKey);
  } catch (error) {
    await releaseClaim(db, eventKey);
    throw error;
  }
  return { status: 'sent' };
}

/**
 * 多人扇出：每位收件人獨立 lease；每批 ≤1000；優先 sendPushToMultipleUsers。
 * 成功後才 completed；明確失敗釋放未完成者；逾時未 release 則靠 lease 過期接手。
 * 任一 inbox／硬推送失敗則丟錯；重試只補未完成者。
 */
async function fanoutToRecipients({
  db,
  sendPushToUser,
  sendPushToMultipleUsers,
  claim,
  releaseClaim,
  completeClaim,
  eventKey,
  claimMeta,
  recipients,
  title,
  body,
  type,
  schoolId,
  data,
  category,
  claimOpts = {},
  log = console,
}) {
  if (!recipients.length) {
    return { status: 'sent', recipients: 0 };
  }

  const inboxId = hashEventKey(eventKey);
  const pushData = { type, ...data };
  let delivered = 0;
  let skipped = 0;

  for (let offset = 0; offset < recipients.length; offset += FANOUT_BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + FANOUT_BATCH_SIZE);
    const pending = [];

    for (const uid of batch) {
      const key = recipientEventKey(eventKey, uid);
      if (await claim(db, key, { ...claimMeta, uid }, claimOpts)) {
        pending.push(uid);
      } else {
        skipped += 1;
      }
    }

    if (!pending.length) continue;

    const releasePending = async (uids) => {
      await Promise.all(
        uids.map((id) => releaseClaim(db, recipientEventKey(eventKey, id))),
      );
    };
    const completePending = async (uids) => {
      await Promise.all(
        uids.map((id) => completeClaim(db, recipientEventKey(eventKey, id))),
      );
    };

    for (let i = 0; i < pending.length; i += 1) {
      const uid = pending[i];
      try {
        await writeInboxNotification(db, uid, inboxId, {
          title,
          body,
          type,
          schoolId,
          data: pushData,
        });
      } catch (error) {
        log.error('[coherenceNotify] inbox write failed', {
          uid,
          inboxId,
          error: String(error),
        });
        // 本批尚無 completed；釋放全部 pending，重試可完整補送
        await releasePending(pending);
        throw error;
      }
    }

    if (typeof sendPushToMultipleUsers === 'function') {
      let results;
      try {
        results = await sendPushToMultipleUsers(
          pending,
          { title, body },
          pushData,
          category,
        );
      } catch (error) {
        log.error('[coherenceNotify] push batch failed', {
          eventKey,
          pending: pending.length,
          error: String(error),
        });
        await releasePending(pending);
        throw error;
      }
      const hardFailUids = new Set(
        (Array.isArray(results) ? results : [])
          .filter((row) => row && row.reason === 'recipient_unavailable')
          .map((row) => row.uid),
      );
      const succeeded = pending.filter((uid) => !hardFailUids.has(uid));
      await completePending(succeeded);
      delivered += succeeded.length;
      if (hardFailUids.size) {
        await releasePending([...hardFailUids]);
        throw new Error(
          `[coherenceNotify] push failed for ${hardFailUids.size} recipient(s)`,
        );
      }
    } else {
      for (let i = 0; i < pending.length; i += 1) {
        const uid = pending[i];
        try {
          await sendPushToUser(uid, { title, body }, pushData, category);
          await completeClaim(db, recipientEventKey(eventKey, uid));
          delivered += 1;
        } catch (error) {
          log.error('[coherenceNotify] push failed', { uid, type, error: String(error) });
          await releaseClaim(db, recipientEventKey(eventKey, uid));
          await releasePending(pending.slice(i + 1));
          throw error;
        }
      }
    }
  }

  if (delivered === 0 && skipped > 0) {
    return { status: 'duplicate', recipients: 0 };
  }
  return { status: 'sent', recipients: delivered };
}

async function listActiveGroupStudentUids(db, groupId, excludeUid) {
  const snap = await db
    .collection('groups')
    .doc(groupId)
    .collection('members')
    .where('status', '==', 'active')
    .get();
  return snap.docs
    .filter((doc) => {
      if (doc.id === excludeUid) return false;
      const role = String(doc.data()?.role || 'member').toLowerCase();
      return !TEACHING_ROLES.has(role);
    })
    .map((doc) => doc.id);
}

async function listSchoolAudienceUids(db, schoolId) {
  const snap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('members')
    .where('status', '==', 'active')
    .get();
  return snap.docs
    .filter((doc) => {
      const role = String(doc.data()?.role || '').toLowerCase();
      return CAMPUS_AUDIENCE_ROLES.has(role);
    })
    .map((doc) => doc.id);
}

function createAssignmentPublishedNotifyHandler({
  db,
  sendPushToUser,
  sendPushToMultipleUsers,
  claim = claimNotificationEvent,
  releaseClaim = releaseNotificationClaim,
  completeClaim = completeNotificationClaim,
  now = () => Date.now(),
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  log = console,
}) {
  return async function onAssignmentPublished(event) {
    const groupId = safeId(event.params?.groupId);
    const assignmentId = safeId(event.params?.assignmentId);
    const assignment = event.data?.data?.() || event.data?.data();
    if (!groupId || !assignmentId || !assignment) return { status: 'ignored' };
    if (assignment.published === false || ['draft', 'closed'].includes(String(assignment.status || ''))) {
      return { status: 'skipped-unpublished' };
    }
    if (['quiz', 'exam'].includes(String(assignment.type || ''))) {
      return { status: 'skipped-non-assignment' };
    }

    const eventKey = `assignment_published__${groupId}__${assignmentId}`;
    const schoolId = safeId(assignment.schoolId) || null;
    const title = text(assignment.title, '新作業');
    const body = `老師發布了「${title}」，請盡快查看。`;
    const recipients = await listActiveGroupStudentUids(db, groupId, safeId(assignment.createdBy));
    const data = {
      groupId,
      assignmentId,
      ...(schoolId ? { schoolId } : {}),
      channel: 'assignments',
    };

    return fanoutToRecipients({
      db,
      sendPushToUser,
      sendPushToMultipleUsers,
      claim,
      releaseClaim,
      completeClaim,
      eventKey,
      claimMeta: { kind: 'assignment_published', groupId, assignmentId },
      recipients,
      title: '📘 新作業',
      body,
      type: 'assignment',
      schoolId,
      data,
      category: 'assignments',
      claimOpts: { nowMs: now(), leaseTtlMs },
      log,
    });
  };
}

function createSubmissionNotifyHandler({
  db,
  sendPushToUser,
  claim = claimNotificationEvent,
  releaseClaim = releaseNotificationClaim,
  completeClaim = completeNotificationClaim,
  now = () => Date.now(),
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  log = console,
}) {
  return async function onAssignmentSubmissionWritten(event) {
    const groupId = safeId(event.params?.groupId);
    const assignmentId = safeId(event.params?.assignmentId);
    const studentUid = safeId(event.params?.studentUid);
    if (!groupId || !assignmentId || !studentUid) return { status: 'ignored' };

    const before = event.data?.before?.data?.() || event.data?.before?.data() || null;
    const after = event.data?.after?.data?.() || event.data?.after?.data() || null;
    // onDocumentCreated 相容：只有 after
    const row = after || (event.data?.data?.() || event.data?.data() || null);
    if (!row) return { status: 'ignored' };

    const results = [];
    const claimOpts = { nowMs: now(), leaseTtlMs };

    const submittedNow = !!row.submittedAt && !before?.submittedAt;
    if (submittedNow) {
      const eventKey = `assignment_submission__${groupId}__${assignmentId}__${studentUid}`;
      const assignmentSnap = await db
        .collection('groups')
        .doc(groupId)
        .collection('assignments')
        .doc(assignmentId)
        .get();
      const assignment = assignmentSnap.exists ? assignmentSnap.data() : {};
      const teacherUid = safeId(assignment.createdBy);
      const schoolId = safeId(assignment.schoolId) || safeId(row.schoolId) || null;
      if (teacherUid && teacherUid !== studentUid) {
        const title = text(assignment.title, '作業');
        const outcome = await claimAndDeliverToUser({
          db,
          sendPushToUser,
          claim,
          releaseClaim,
          completeClaim,
          eventKey,
          claimMeta: { kind: 'assignment_submission', groupId, assignmentId, studentUid },
          uid: teacherUid,
          title: '📝 待批改作業',
          body: `有學生繳交了「${title}」，請前往批改。`,
          type: 'assignment_submission',
          schoolId,
          data: {
            groupId,
            assignmentId,
            studentUid,
            ...(schoolId ? { schoolId } : {}),
            channel: 'assignments',
          },
          category: 'assignments',
          claimOpts,
          log,
        });
        results.push(outcome.status === 'duplicate' ? 'submission-duplicate' : 'submission');
      }
    }

    const gradedNow = row.gradePublished === true && before?.gradePublished !== true;
    if (gradedNow) {
      const eventKey = `assignment_grade__${groupId}__${assignmentId}__${studentUid}`;
      const assignmentSnap = await db
        .collection('groups')
        .doc(groupId)
        .collection('assignments')
        .doc(assignmentId)
        .get();
      const assignment = assignmentSnap.exists ? assignmentSnap.data() : {};
      const schoolId = safeId(assignment.schoolId) || safeId(row.schoolId) || null;
      const title = text(assignment.title, '作業');
      const score =
        typeof row.gradeScore === 'number' && Number.isFinite(row.gradeScore)
          ? String(row.gradeScore)
          : null;
      const outcome = await claimAndDeliverToUser({
        db,
        sendPushToUser,
        claim,
        releaseClaim,
        completeClaim,
        eventKey,
        claimMeta: { kind: 'assignment_grade', groupId, assignmentId, studentUid },
        uid: studentUid,
        title: '📊 成績已公布',
        body: score
          ? `「${title}」成績已公布：${score}`
          : `「${title}」成績與回饋已公布，請查看。`,
        type: 'feedback',
        schoolId,
        data: {
          groupId,
          assignmentId,
          ...(schoolId ? { schoolId } : {}),
          channel: 'grades',
        },
        category: 'grades',
        claimOpts,
        log,
      });
      results.push(outcome.status === 'duplicate' ? 'grade-duplicate' : 'grade');
    }

    return { status: results.length ? 'sent' : 'noop', results };
  };
}

function createSchoolAnnouncementNotifyHandler({
  db,
  sendPushToUser,
  sendPushToMultipleUsers,
  claim = claimNotificationEvent,
  releaseClaim = releaseNotificationClaim,
  completeClaim = completeNotificationClaim,
  now = () => Date.now(),
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  log = console,
}) {
  return async function onSchoolAnnouncementCreated(event) {
    const schoolId = safeId(event.params?.schoolId);
    const announcementId = safeId(event.params?.announcementId);
    const announcement = event.data?.data?.() || event.data?.data();
    if (!schoolId || !announcementId || !announcement) return { status: 'ignored' };

    const eventKey = `school_announcement__${schoolId}__${announcementId}`;
    const title = text(announcement.title, '校園公告');
    const body = text(announcement.body, '學校發布了一則新公告。').slice(0, 120);
    const recipients = await listSchoolAudienceUids(db, schoolId);
    const actor = safeId(announcement.createdBy);
    const targets = recipients.filter((uid) => uid !== actor);
    const data = {
      announcementId,
      schoolId,
      channel: 'announcements',
    };

    return fanoutToRecipients({
      db,
      sendPushToUser,
      sendPushToMultipleUsers,
      claim,
      releaseClaim,
      completeClaim,
      eventKey,
      claimMeta: { kind: 'school_announcement', schoolId, announcementId },
      recipients: targets,
      title: '📢 校園公告',
      body: title === body ? title : `${title}：${body}`,
      type: 'announcement',
      schoolId,
      data,
      category: 'announcements',
      claimOpts: { nowMs: now(), leaseTtlMs },
      log,
    });
  };
}

module.exports = {
  CLAIM_COLLECTION,
  FANOUT_BATCH_SIZE,
  DEFAULT_LEASE_TTL_MS,
  CAMPUS_AUDIENCE_ROLES,
  hashEventKey,
  claimNotificationEvent,
  completeNotificationClaim,
  releaseNotificationClaim,
  writeInboxNotification,
  createAssignmentPublishedNotifyHandler,
  createSubmissionNotifyHandler,
  createSchoolAnnouncementNotifyHandler,
};
