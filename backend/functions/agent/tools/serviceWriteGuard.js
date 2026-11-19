'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { isAccountUnavailable } = require('../../accountLifecycle');

function assertServiceScope(ctx) {
  if (!ctx.uid || typeof ctx.uid !== 'string' || ctx.uid.includes('/')) {
    throw new HttpsError('unauthenticated', '請先登入。');
  }
  if (typeof ctx.schoolId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(ctx.schoolId)) {
    throw new HttpsError('invalid-argument', '請先選擇有效的學校。');
  }
}

// 在與服務寫入相同的交易內重讀身分，撤銷校籍、停用或刪除帳號時會重新驗證。
async function readServiceActor(tx, db, ctx) {
  const [member, account] = await Promise.all([
    tx.get(db.doc(`schools/${ctx.schoolId}/members/${ctx.uid}`)),
    tx.get(db.doc(`users/${ctx.uid}`)),
  ]);
  if (!member.exists || (member.data().status && member.data().status !== 'active')) {
    throw new HttpsError('permission-denied', '請使用目前學校的有效帳號。');
  }
  // Preserve the admission policy for new/legacy profiles; a failed tx.get is
  // never converted into an empty profile and therefore aborts the write.
  const profile = account.exists ? account.data() : {};
  if (isAccountUnavailable(profile)) {
    throw new HttpsError('failed-precondition', '帳號正在刪除或已停用。');
  }
}

// 明確的鎖文件讓跨資源配額及空座位競爭也會重試，不能只依賴查詢回傳的文件。
// 這些路徑沒有用戶端寫入規則，只供 Admin SDK 在交易中讀寫。
function userServiceGuard(db, ctx, service) {
  return db.doc(`users/${ctx.uid}/schools/${ctx.schoolId}/serviceWriteGuards/${service}`);
}

function resourceServiceGuard(db, schoolId, ...identity) {
  const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return db.doc(`schools/${schoolId}/serviceWriteGuards/${id}`);
}

module.exports = { assertServiceScope, readServiceActor, userServiceGuard, resourceServiceGuard };
