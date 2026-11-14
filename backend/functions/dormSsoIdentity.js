// Input must come directly from the verified school SSO adapter, never users/{uid}.
async function writeDormSsoIdentity({ db, uid, schoolId, userInfo }) {
  const value = userInfo.studentId || userInfo.employee_id;
  const studentId = typeof value === 'string' ? value.trim() : '';
  const name = userInfo.name || userInfo.displayName;
  // No client rule grants access to this collection. Replace stale claims on refresh.
  const identity = {
    studentId: /^[a-zA-Z0-9_-]{1,50}$/.test(studentId) ? studentId : null,
    displayName: typeof name === 'string' ? name.trim().slice(0, 160) : '',
  };
  const ref = db.collection('schools').doc(schoolId).collection('dormSsoIdentities').doc(uid);
  await db.runTransaction(async (tx) => {
    tx.set(ref, identity);
  });
}
module.exports = { writeDormSsoIdentity };
