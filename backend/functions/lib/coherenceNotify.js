'use strict';

const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const CLAIM_COLLECTION = 'notificationClaims';
const FANOUT_BATCH_SIZE = 1000;
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
  return crypto.createHash('sha256').update(String(eventKey), 'utf8').digest('hex');
}

function recipientEventKey(eventKey, uid) {
  return `${eventKey}__uid__${uid}`;
}

/**
 * 以 create-only claim 做到同一事件（或同一收件人）不重複推送。
 * 文件 id 為 eventKey 的 sha256；原文存在 eventKey 欄位。
 * 回傳 true 表示本呼叫取得發送權；false 表示已處理過或鍵無效。
 */
async function claimNotificationEvent(db, eventKey, meta = {}) {
  if (typeof eventKey !== 'string' || !eventKey) return false;
  const docId = hashEventKey(eventKey);
  const ref = db.collection(CLAIM_COLLECTION).doc(docId);
  try {
    await ref.create({
      eventKey,
      ...meta,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(error))) {
      return false;
    }
    throw error;
  }
}

/** 發送失敗時釋放 claim，讓觸發器重試可補送該收件人。 */
async function releaseNotificationClaim(db, eventKey) {
  if (typeof eventKey !== 'string' || !eventKey) return;
  const docId = hashEventKey(eventKey);
  await db.collection(CLAIM_COLLECTION).doc(docId).delete();
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
 * 單收件人：claim → 送達；失敗釋放 claim 並丟錯以便重試。
 */
async function claimAndDeliverToUser({
  db,
  sendPushToUser,
  claim,
  releaseClaim,
  eventKey,
  claimMeta,
  uid,
  title,
  body,
  type,
  schoolId,
  data,
  category,
  log = console,
}) {
  if (!(await claim(db, eventKey, claimMeta))) {
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
  } catch (error) {
    await releaseClaim(db, eventKey);
    throw error;
  }
  return { status: 'sent' };
}

/**
 * 多人扇出：每位收件人獨立 claim；每批 ≤1000；優先 sendPushToMultipleUsers。
 * 任一 inbox／硬推送失敗則釋放未完成者的 claim 並丟錯；重試只補未 claim 成功者。
 */
async function fanoutToRecipients({
  db,
  sendPushToUser,
  sendPushToMultipleUsers,
  claim,
  releaseClaim,
  eventKey,
  claimMeta,
  recipients,
  title,
  body,
  type,
  schoolId,
  data,
  category,
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
      if (await claim(db, key, { ...claimMeta, uid })) {
        pending.push(uid);
      } else {
        skipped += 1;
      }
    }

    if (!pending.length) continue;

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
        // 釋放本批全部 claim（含已寫 inbox 尚未推播者），重試可完整補送
        await Promise.all(
          pending.map((id) => releaseClaim(db, recipientEventKey(eventKey, id))),
        );
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
        await Promise.all(
          pending.map((uid) => releaseClaim(db, recipientEventKey(eventKey, uid))),
        );
        throw error;
      }
      const hardFails = (Array.isArray(results) ? results : []).filter(
        (row) => row && row.reason === 'recipient_unavailable',
      );
      if (hardFails.length) {
        await Promise.all(
          hardFails.map((row) => releaseClaim(db, recipientEventKey(eventKey, row.uid))),
        );
        throw new Error(
          `[coherenceNotify] push failed for ${hardFails.length} recipient(s)`,
        );
      }
    } else {
      for (let i = 0; i < pending.length; i += 1) {
        const uid = pending[i];
        try {
          await sendPushToUser(uid, { title, body }, pushData, category);
        } catch (error) {
          log.error('[coherenceNotify] push failed', { uid, type, error: String(error) });
          await releaseClaim(db, recipientEventKey(eventKey, uid));
          await Promise.all(
            pending
              .slice(i + 1)
              .map((id) => releaseClaim(db, recipientEventKey(eventKey, id))),
          );
          throw error;
        }
      }
    }

    delivered += pending.length;
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
      eventKey,
      claimMeta: { kind: 'assignment_published', groupId, assignmentId },
      recipients,
      title: '📘 新作業',
      body,
      type: 'assignment',
      schoolId,
      data,
      category: 'assignments',
      log,
    });
  };
}

function createSubmissionNotifyHandler({
  db,
  sendPushToUser,
  claim = claimNotificationEvent,
  releaseClaim = releaseNotificationClaim,
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
      eventKey,
      claimMeta: { kind: 'school_announcement', schoolId, announcementId },
      recipients: targets,
      title: '📢 校園公告',
      body: title === body ? title : `${title}：${body}`,
      type: 'announcement',
      schoolId,
      data,
      category: 'announcements',
      log,
    });
  };
}

module.exports = {
  CLAIM_COLLECTION,
  FANOUT_BATCH_SIZE,
  CAMPUS_AUDIENCE_ROLES,
  hashEventKey,
  claimNotificationEvent,
  releaseNotificationClaim,
  writeInboxNotification,
  createAssignmentPublishedNotifyHandler,
  createSubmissionNotifyHandler,
  createSchoolAnnouncementNotifyHandler,
};
