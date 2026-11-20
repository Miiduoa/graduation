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
const OWNED_SESSION_COLLECTIONS = Object.freeze(['_puSessions', '_puTronClassSessions']);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function snapshotExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === 'function' ? snap.exists() === true : snap.exists === true;
}

function snapshotData(snap) {
  return typeof snap?.data === 'function' ? snap.data() : undefined;
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
 * 只在既有且屬於呼叫者的 session 上 merge 欄位。
 * 文件不存在（例如刪帳號或登出後）就不寫，避免 merge-set 重建孤兒文件。
 */
async function mergeOwnedPuSessionFields(db, sessionRef, ownerUid, fields) {
  if (!fields || !sessionRef || typeof db?.runTransaction !== 'function') return false;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snapshotExists(snap)) return false;
    const data = snapshotData(snap);
    if (!data || data.ownerUid !== ownerUid) return false;
    tx.set(sessionRef, fields, { merge: true });
    return true;
  });
}

/**
 * 只在既有且屬於呼叫者的 session 上寫入 mypuCookies。
 * 文件不存在（例如刪帳號後）就不寫，避免 merge-set 重建孤兒文件。
 */
async function persistOwnedMypuCookies(db, sessionRef, ownerUid, mypuCookies) {
  if (!mypuCookies) return false;
  return mergeOwnedPuSessionFields(db, sessionRef, ownerUid, { mypuCookies });
}

/**
 * 背景 SSO 寫回：portal session 仍存在且 ownerUid 相符才建立 TronClass session 並 merge。
 * portal 不在就不寫、也不新建 `_puTronClassSessions`。
 */
async function linkOwnedTronClassSession(
  db,
  portalRef,
  ownerUid,
  tronClassRef,
  tronClassData,
  portalFields,
) {
  if (
    !portalRef ||
    !tronClassRef ||
    !ownerUid ||
    !tronClassData ||
    typeof db?.runTransaction !== 'function'
  ) {
    return false;
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(portalRef);
    if (!snapshotExists(snap)) return false;
    const data = snapshotData(snap);
    if (!data || data.ownerUid !== ownerUid) return false;
    tx.set(tronClassRef, tronClassData);
    if (portalFields) tx.set(portalRef, portalFields, { merge: true });
    return true;
  });
}

async function deleteOwnedCollection(db, collectionName, ownerUid) {
  let deleted = 0;
  const query = db.collection(collectionName).where('ownerUid', '==', ownerUid);
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

async function deleteOwnedPuSessions(db, ownerUid) {
  if (!ownerUid || typeof db?.collection !== 'function') return 0;
  let deleted = 0;
  for (const collectionName of OWNED_SESSION_COLLECTIONS) {
    deleted += await deleteOwnedCollection(db, collectionName, ownerUid);
  }
  return deleted;
}

module.exports = {
  CAMPUS_PUBLIC_FIELDS,
  publicCampusDataResult,
  mergeOwnedPuSessionFields,
  persistOwnedMypuCookies,
  linkOwnedTronClassSession,
  deleteOwnedPuSessions,
};
