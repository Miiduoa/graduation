/** Firestore readers shared by the campus assistant and its tools. */

'use strict';

const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { createAuthzHelpers } = require('../authz');
const { toJsDate } = require('./assistantFormat');

const EMPTY = Object.freeze([]);

function assertId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/') || value === '.' || value === '..') {
    throw new HttpsError('invalid-argument', `${label} is required`);
  }
}

function database(deps = {}) {
  return deps.db || (deps.admin ? deps.admin.firestore() : getFirestore());
}

async function readSchoolRows(schoolId, collections, { order, limit, requiredField, deps = {} } = {}) {
  assertId(schoolId, 'schoolId');
  const db = database(deps);
  const school = db.collection('schools').doc(schoolId);
  for (const [index, name] of collections.entries()) {
    const legacy = index === collections.length - 1;
    let source = legacy
      ? db.collection(name).where('schoolId', '==', schoolId)
      : school.collection(name);
    if (order) source = source.orderBy(...order);
    if (limit) source = source.limit(limit);
    // A failed authoritative read is not an empty collection and must not trigger fallback.
    const snapshot = await source.get();
    if (snapshot.empty) continue;
    return snapshot.docs.map((entry) => {
      const data = entry.data();
      if ((legacy && data.schoolId !== schoolId) || (data.schoolId != null && data.schoolId !== schoolId)) {
        throw new HttpsError('failed-precondition', 'School data does not match the requested school');
      }
      if (requiredField && (typeof data[requiredField] !== 'string' || !data[requiredField].trim())) {
        throw new HttpsError('failed-precondition', 'School data is incomplete');
      }
      return { ...data, id: entry.id, schoolId };
    });
  }
  return [];
}

async function fetchAssistantAnnouncements(schoolId, deps = {}) {
  return readSchoolRows(schoolId, ['announcements', 'announcements'], {
    order: ['publishedAt', 'desc'], limit: 20, requiredField: 'title', deps,
  });
}

async function fetchAssistantEvents(schoolId, deps = {}) {
  const events = await readSchoolRows(schoolId, ['clubEvents', 'events', 'events'], {
    requiredField: 'title', deps,
  });
  return events.sort((a, b) =>
    (toJsDate(a.startsAt)?.getTime() ?? Infinity) - (toJsDate(b.startsAt)?.getTime() ?? Infinity));
}

async function fetchAssistantMenus(schoolId, deps = {}) {
  return readSchoolRows(schoolId, ['menus', 'menus'], { limit: 100, requiredField: 'name', deps });
}

async function fetchAssistantPois(schoolId, deps = {}) {
  return readSchoolRows(schoolId, ['pois', 'pois'], { requiredField: 'name', deps });
}

async function fetchAssistantSummary(uid, schoolId, collectionName, deps = {}) {
  assertId(uid, 'uid');
  assertId(schoolId, 'schoolId');
  const db = database(deps);
  const { assertActiveSchoolMember } = createAuthzHelpers(db);
  await assertActiveSchoolMember(schoolId, uid);
  const snapshot = await db.collection('users').doc(uid).collection('schools').doc(schoolId)
    .collection(collectionName).orderBy('generatedAt', 'desc').limit(1).get();
  if (snapshot.empty) return null;
  const entry = snapshot.docs[0];
  const data = entry.data();
  if (data.schoolId !== schoolId) {
    throw new HttpsError('failed-precondition', 'Summary does not match the requested school');
  }
  const summary = collectionName === 'dailyBriefs' ? data.content : data.summary;
  if (typeof summary !== 'string') throw new HttpsError('failed-precondition', 'Summary content is unavailable');
  // Membership can be revoked while the document request is in flight.
  await assertActiveSchoolMember(schoolId, uid);
  return { ...data, id: entry.id, schoolId, summary };
}

async function fetchAssistantDailyBrief(uid, schoolId, deps = {}) {
  return fetchAssistantSummary(uid, schoolId, 'dailyBriefs', deps);
}

async function fetchAssistantWeeklyReport(uid, schoolId, deps = {}) {
  return fetchAssistantSummary(uid, schoolId, 'weeklyReports', deps);
}

function safeCollection(admin, name) {
  if (!admin) return null;
  try {
    return admin.firestore().collection(name);
  } catch {
    return null;
  }
}

/** 抓取使用者基本資料 */
async function fetchAssistantUserProfile(uid, deps = {}) {
  assertId(uid, 'uid');
  const entry = await database(deps).collection('users').doc(uid).get();
  if (!entry.exists) return null;
  const data = entry.data();
  return {
    uid,
    schoolId: data.primarySchoolId || data.schoolId || null,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    role: typeof data.role === 'string' ? data.role : null,
  };
}

async function fetchAssistantTodaySchedule(uid, schoolId, deps = {}) {
  assertId(uid, 'uid');
  assertId(schoolId, 'schoolId');
  await createAuthzHelpers(database(deps)).assertActiveSchoolMember(schoolId, uid);
  // The authoritative timetable uses the separately authenticated academic-records
  // service. No Firestore schedule producer is connected to this assistant reader.
  return {
    status: 'unavailable',
    slots: null,
    message: '助理目前無法讀取你的課表，不能判定今天有沒有課。請開啟「我的課表」查看學校資料。',
  };
}

/** 抓取未繳交作業 */
async function fetchAssistantPendingAssignments(uid, schoolId, deps = {}) {
  assertId(uid, 'uid');
  assertId(schoolId, 'schoolId');
  const db = database(deps);
  const { assertActiveSchoolMember } = createAuthzHelpers(db);
  await assertActiveSchoolMember(schoolId, uid);
  let groupIds;
  if (deps.preferredGroupId) {
    assertId(deps.preferredGroupId, 'groupId');
    groupIds = [deps.preferredGroupId];
  } else {
    const memberships = await db.collection('users').doc(uid).collection('groups')
      .where('schoolId', '==', schoolId).get();
    groupIds = memberships.docs.filter((entry) => {
      const membership = entry.data();
      if (membership.schoolId !== schoolId || (membership.groupId && membership.groupId !== entry.id)) {
        throw new HttpsError('failed-precondition', 'Course membership does not match the requested school');
      }
      return membership.status === 'active';
    }).map((entry) => entry.id);
  }

  async function authorizeCourse(groupId) {
    const groupRef = db.collection('groups').doc(groupId);
    const [group, member] = await Promise.all([
      groupRef.get(), groupRef.collection('members').doc(uid).get(),
    ]);
    if (!group.exists || group.data().schoolId !== schoolId ||
        !member.exists || member.data().status !== 'active') {
      throw new HttpsError('permission-denied', 'Active membership in this school course is required');
    }
    if (typeof group.data().type !== 'string' || !group.data().type.trim()) {
      throw new HttpsError('failed-precondition', 'Group type is unavailable');
    }
    return { groupRef, group: group.data(), member: member.data() };
  }

  const pending = [];
  const readGroupIds = [];
  for (const groupId of groupIds) {
    assertId(groupId, 'groupId');
    const { groupRef, group, member } = await authorizeCourse(groupId);
    if (group.type !== 'course') continue;
    if (['admin', 'owner', 'instructor', 'moderator'].includes(member.role)) continue;
    readGroupIds.push(groupId);
    const assignments = await groupRef.collection('assignments').get();
    for (const entry of assignments.docs) {
      const assignment = entry.data();
      if (assignment.published === false || ['draft', 'closed'].includes(assignment.status)) continue;
      if ((assignment.schoolId != null && assignment.schoolId !== schoolId) ||
          (assignment.groupId != null && assignment.groupId !== groupId) ||
          typeof assignment.title !== 'string' || !assignment.title.trim()) {
        throw new HttpsError('failed-precondition', 'Assignment source is incomplete or inconsistent');
      }
      const submission = await groupRef.collection('assignments').doc(entry.id)
        .collection('submissions').doc(uid).get();
      if (submission.exists && submission.data().submittedAt) continue;
      pending.push({
        id: entry.id, title: assignment.title, dueAt: assignment.dueAt ?? null,
        groupId, groupName: typeof group.name === 'string' ? group.name : null, schoolId,
      });
    }
  }
  for (const groupId of readGroupIds) {
    const { group } = await authorizeCourse(groupId);
    if (group.type !== 'course') throw new HttpsError('failed-precondition', 'Course changed during the request');
  }
  await assertActiveSchoolMember(schoolId, uid);
  return pending.sort((a, b) =>
    (toJsDate(a.dueAt)?.getTime() ?? Infinity) - (toJsDate(b.dueAt)?.getTime() ?? Infinity));
}

/** 抓取知識庫 chunks（提供 RAG） */
async function fetchAssistantKnowledgeChunks(query, deps = {}) {
  const limit = deps.limit || 5;
  const coll = safeCollection(deps.admin, 'assistantKnowledge');
  if (!coll || !query) return EMPTY;
  try {
    // 簡化：以 tags 等屬性 token 比對；若有 vector store 由呼叫端覆寫
    const snap = await coll.limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return EMPTY;
  }
}

module.exports = {
  fetchAssistantUserProfile,
  fetchAssistantTodaySchedule,
  fetchAssistantPendingAssignments,
  fetchAssistantAnnouncements,
  fetchAssistantEvents,
  fetchAssistantMenus,
  fetchAssistantPois,
  fetchAssistantDailyBrief,
  fetchAssistantWeeklyReport,
  fetchAssistantKnowledgeChunks,
};
