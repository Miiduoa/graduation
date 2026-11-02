'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const CLAIM_COLLECTION = 'notificationClaims';
const TEACHING_ROLES = new Set(['instructor', 'owner', 'teacher', 'ta']);
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

/**
 * 以 create-only claim 做到同一事件不重複推送。
 * 回傳 true 表示本呼叫取得發送權；false 表示已處理過。
 */
async function claimNotificationEvent(db, eventKey, meta = {}) {
  const key = safeId(eventKey) || null;
  if (!key) return false;
  const ref = db.collection(CLAIM_COLLECTION).doc(key);
  try {
    await ref.create({
      eventKey: key,
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

async function writeInboxNotification(db, uid, notificationId, payload) {
  const userId = safeId(uid);
  const id = safeId(notificationId);
  if (!userId || !id) return;
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
  }
  try {
    await sendPushToUser(uid, { title, body }, { type, ...data }, category);
  } catch (error) {
    log.error('[coherenceNotify] push failed', { uid, type, error: String(error) });
  }
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
      return !role || CAMPUS_AUDIENCE_ROLES.has(role);
    })
    .map((doc) => doc.id);
}

function createAssignmentPublishedNotifyHandler({
  db,
  sendPushToUser,
  claim = claimNotificationEvent,
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
    if (!(await claim(db, eventKey, { kind: 'assignment_published', groupId, assignmentId }))) {
      return { status: 'duplicate' };
    }

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

    for (const uid of recipients) {
      await deliverToUser({
        db,
        sendPushToUser,
        uid,
        inboxId: eventKey,
        title: '📘 新作業',
        body,
        type: 'assignment',
        schoolId,
        data,
        category: 'assignments',
        log,
      });
    }
    return { status: 'sent', recipients: recipients.length };
  };
}

function createSubmissionNotifyHandler({
  db,
  sendPushToUser,
  claim = claimNotificationEvent,
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
      if (await claim(db, eventKey, { kind: 'assignment_submission', groupId, assignmentId, studentUid })) {
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
          await deliverToUser({
            db,
            sendPushToUser,
            uid: teacherUid,
            inboxId: eventKey,
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
          results.push('submission');
        }
      } else {
        results.push('submission-duplicate');
      }
    }

    const gradedNow = row.gradePublished === true && before?.gradePublished !== true;
    if (gradedNow) {
      const eventKey = `assignment_grade__${groupId}__${assignmentId}__${studentUid}`;
      if (await claim(db, eventKey, { kind: 'assignment_grade', groupId, assignmentId, studentUid })) {
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
        await deliverToUser({
          db,
          sendPushToUser,
          uid: studentUid,
          inboxId: eventKey,
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
        results.push('grade');
      } else {
        results.push('grade-duplicate');
      }
    }

    return { status: results.length ? 'sent' : 'noop', results };
  };
}

function createSchoolAnnouncementNotifyHandler({
  db,
  sendPushToUser,
  claim = claimNotificationEvent,
  log = console,
}) {
  return async function onSchoolAnnouncementCreated(event) {
    const schoolId = safeId(event.params?.schoolId);
    const announcementId = safeId(event.params?.announcementId);
    const announcement = event.data?.data?.() || event.data?.data();
    if (!schoolId || !announcementId || !announcement) return { status: 'ignored' };

    const eventKey = `school_announcement__${schoolId}__${announcementId}`;
    if (!(await claim(db, eventKey, { kind: 'school_announcement', schoolId, announcementId }))) {
      return { status: 'duplicate' };
    }

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

    for (const uid of targets) {
      await deliverToUser({
        db,
        sendPushToUser,
        uid,
        inboxId: eventKey,
        title: '📢 校園公告',
        body: title === body ? title : `${title}：${body}`,
        type: 'announcement',
        schoolId,
        data,
        category: 'announcements',
        log,
      });
    }
    return { status: 'sent', recipients: targets.length };
  };
}

module.exports = {
  CLAIM_COLLECTION,
  claimNotificationEvent,
  writeInboxNotification,
  createAssignmentPublishedNotifyHandler,
  createSubmissionNotifyHandler,
  createSchoolAnnouncementNotifyHandler,
};
