// Input must come directly from the verified school SSO adapter, never users/{uid}.
async function writeDormSsoIdentity({ db, uid, schoolId, userInfo }) {
  const value = userInfo.studentId || userInfo.student_id || userInfo.employee_id;
  const studentId = typeof value === 'string' ? value.trim() : '';
  const name = userInfo.name || userInfo.displayName;
  // No client rule grants access to this collection. Replace stale claims on refresh.
  const identity = {
    studentId: /^[a-zA-Z0-9_-]{1,50}$/.test(studentId) ? studentId : null,
    displayName: typeof name === 'string' ? name.trim().slice(0, 160) : '',
  };
  const ref = db.collection('schools').doc(schoolId).collection('dormSsoIdentities').doc(uid);
  await db.runTransaction(async (tx) => {
    const account = await tx.get(db.collection('users').doc(uid));
    if (account.data()?.status === 'deleted' || account.data()?.accountDeletionInProgress) return;
    tx.set(ref, identity);
  });
}
module.exports = { writeDormSsoIdentity };

// Resolve only backend-owned, verified SSO links when an enabled dorm feature needs them.
async function resolveDormSsoIdentity({ db, schoolId, studentId }) {
  // The legacy PU login uses a deterministic UID and a server-written membership,
  // rather than ssoLinks. Never resolve from the client-editable users profile.
  if (schoolId === 'pu') {
    const uid = `pu-${studentId.toLowerCase()}`;
    const member = await db.collection('schools').doc('pu').collection('members').doc(uid).get();
    const data = member.data();
    if (data?.studentId === studentId && data.lastLoginAt && data.status === 'active') {
      await writeDormSsoIdentity({
        db,
        schoolId,
        uid,
        userInfo: { studentId, name: data.displayName },
      });
    }
  }
  const links = await db.collection('ssoLinks').where('studentId', '==', studentId).get();
  for (const doc of links.docs) {
    const link = doc.data();
    if (link.schoolId !== schoolId || !link.firebaseUid) continue;
    const current = await db
      .collection('schools')
      .doc(schoolId)
      .collection('dormSsoIdentities')
      .doc(link.firebaseUid)
      .get();
    if (current.exists) continue; // Fresh verified callback claims take precedence over legacy links.
    await writeDormSsoIdentity({
      db,
      schoolId,
      uid: link.firebaseUid,
      userInfo: { studentId: link.studentId, name: link.name },
    });
  }
}
module.exports.resolveDormSsoIdentity = resolveDormSsoIdentity;

// Explicit trusted dorm identity refresh helper; never called from the login callback.
async function refreshDormSsoIdentity(args) {
  const school = await args.db.collection('schools').doc(args.schoolId).get();
  if (school.data()?.dormWorkflowEnabled !== true) return;
  await writeDormSsoIdentity(args);
}
module.exports.refreshDormSsoIdentity = refreshDormSsoIdentity;
