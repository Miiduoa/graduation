'use strict';

const CAMPUS_PUBLIC_FIELDS = Object.freeze({
  courses: ['courses', 'studentInfo', 'semester', 'totalCredits'],
  grades: ['grades', 'summary', 'allSemesters', 'creditSummary', 'coverage'],
  announcements: ['announcements'],
  studentInfo: ['studentInfo'],
  absence: ['absences'],
  creditSummary: ['creditSummary'],
});

const SESSION_PAGE_SIZE = 200;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function snapshotExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === 'function' ? snap.exists() === true : snap.exists === true;
}

/** 校務 cookie 與內部錯誤只留在伺服器，回應只包含頁面需要的資料欄位。 */
function publicCampusDataResult(kind, result) {
  const source = record(result);
  const out = { success: true };
  for (const key of CAMPUS_PUBLIC_FIELDS[kind] || []) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/**
 * 只在既有且屬於呼叫者的 session 上寫入 mypuCookies。
 * 文件不存在（例如刪帳號後）就不寫，避免 merge-set 重建孤兒文件。
 */
async function persistOwnedMypuCookies(db, sessionRef, ownerUid, mypuCookies) {
  if (!mypuCookies || !sessionRef || typeof db?.runTransaction !== 'function') return false;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snapshotExists(snap)) return false;
    const data = typeof snap.data === 'function' ? snap.data() : undefined;
    if (!data || data.ownerUid !== ownerUid) return false;
    tx.set(sessionRef, { mypuCookies }, { merge: true });
    return true;
  });
}

async function deleteOwnedPuSessions(db, ownerUid) {
  if (!ownerUid || typeof db?.collection !== 'function') return 0;
  let deleted = 0;
  const query = db.collection('_puSessions').where('ownerUid', '==', ownerUid);
  while (true) {
    const snapshot = await query.limit(SESSION_PAGE_SIZE).get();
    const docs = snapshot?.docs || [];
    if (!docs.length) return deleted;
    for (const doc of docs) {
      if (typeof doc.ref?.delete !== 'function') {
        throw new Error('Cannot delete PU session');
      }
      await doc.ref.delete();
      deleted += 1;
    }
    if (docs.length < SESSION_PAGE_SIZE) return deleted;
  }
}

module.exports = {
  CAMPUS_PUBLIC_FIELDS,
  publicCampusDataResult,
  persistOwnedMypuCookies,
  deleteOwnedPuSessions,
};
