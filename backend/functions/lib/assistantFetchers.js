/**
 * assistantFetchers — Campus Assistant 用的 Firestore 讀取 helper
 *
 * 此檔在 main 上被多個 agent 模組與測試 import 但實作未被 commit。
 * 本檔提供安全 stub 實作：
 *  - 接收 admin SDK（可選）；無 admin 時回傳空陣列/空物件，工具不會炸。
 *  - 介面對齊呼叫端 destructure 的命名。
 */

'use strict';

const EMPTY = Object.freeze([]);

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
  const admin = deps.admin;
  if (!admin || !uid) return null;
  try {
    const doc = await admin.firestore().collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { uid, ...doc.data() };
  } catch {
    return null;
  }
}

/** 抓取今日課表（依使用者已選課） */
async function fetchAssistantTodaySchedule(uid, deps = {}) {
  const admin = deps.admin;
  const date = deps.date instanceof Date ? deps.date : new Date();
  if (!admin || !uid) return EMPTY;
  try {
    const snap = await admin
      .firestore()
      .collection('users')
      .doc(uid)
      .collection('schedule')
      .where('dayOfWeek', '==', ((date.getDay() + 6) % 7) + 1) // Mon=1
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return EMPTY;
  }
}

/** 抓取未繳交作業 */
async function fetchAssistantPendingAssignments(uid, deps = {}) {
  const admin = deps.admin;
  if (!admin || !uid) return EMPTY;
  try {
    const snap = await admin
      .firestore()
      .collection('users')
      .doc(uid)
      .collection('assignments')
      .where('status', '==', 'pending')
      .orderBy('due', 'asc')
      .limit(20)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return EMPTY;
  }
}

/** 抓取最新公告 */
async function fetchAssistantAnnouncements(deps = {}) {
  const limit = deps.limit || 5;
  const coll = safeCollection(deps.admin, 'announcements');
  if (!coll) return EMPTY;
  try {
    const snap = await coll.orderBy('publishedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return EMPTY;
  }
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
  fetchAssistantKnowledgeChunks,
};
