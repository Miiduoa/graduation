const { HttpsError } = require('firebase-functions/v2/https');

async function assertAccountAvailable(db, uid) {
  if (!uid) return;
  const profile = await db.collection('users').doc(uid).get();
  const data = profile.exists ? profile.data() : {};
  if (data.accountDeletionInProgress === true || data.status === 'deleted') {
    throw new HttpsError('failed-precondition', '帳號正在刪除或已停用。', {
      reason: 'account-deletion',
    });
  }
}

// This admission check blocks new calls. Handlers with in-flight writes still need
// to read the account marker inside their transaction to serialize with deletion.
function createAccountGuardedOnCall({ onCall, getDb }) {
  return (options, handler) => {
    const { allowClosingAccount = false, ...firebaseOptions } = options;
    return onCall(firebaseOptions, async (request, ...args) => {
      if (!allowClosingAccount) await assertAccountAvailable(getDb(), request.auth?.uid);
      return handler(request, ...args);
    });
  };
}

module.exports = { assertAccountAvailable, createAccountGuardedOnCall };
