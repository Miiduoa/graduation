const { randomUUID } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  isClosedAccount,
  nextBindingGeneration,
  campusStoryStampFields,
  loadExistingSchoolMemberships,
  clearHaltFields,
  storyMediaStampClearUpdate,
} = require('./campusStoryAccessBinding');

const displayRoles = new Set([
  'student',
  'teacher',
  'professor',
  'staff',
  'employee',
  'department_head',
  'principal',
  'alumni',
]);

function schoolLoginRoles(membership, displayRole) {
  const memberRole = ['admin', 'editor'].includes(membership?.role) ? membership.role : 'member';
  const safeDisplayRole = displayRoles.has(displayRole) ? displayRole : 'student';
  return {
    memberRole,
    role:
      memberRole === 'admin'
        ? 'admin'
        : memberRole === 'editor' && safeDisplayRole === 'student'
          ? 'staff'
          : safeDisplayRole,
  };
}

/** Authentication refreshes identity details; only the school membership grants administration. */
function createSchoolLoginProfileWriter({ db }) {
  return async ({ uid, schoolId, profile, membershipFields = {}, ssoLinkRef = null }) => {
    const userRef = db.collection('users').doc(uid);
    const memberRef = db.collection('schools').doc(schoolId).collection('members').doc(uid);
    const preview = await userRef.get();
    const extras = await loadExistingSchoolMemberships(db, uid, {
      ...(preview.exists ? preview.data() || {} : {}),
      schoolId,
      primarySchoolId: schoolId,
    });
    const extraRefs = extras
      .filter((item) => item.schoolId !== schoolId)
      .map((item) => db.collection('schools').doc(item.schoolId).collection('members').doc(uid));
    return db.runTransaction(async (tx) => {
      const [userDoc, memberDoc, ...extraSnaps] = await tx.getAll(userRef, memberRef, ...extraRefs);
      const account = userDoc.exists ? userDoc.data() : {};
      if (isClosedAccount(account)) {
        throw new HttpsError('failed-precondition', '帳號正在刪除或已停用。', {
          reason: 'account-deletion',
        });
      }
      const bindingGeneration = nextBindingGeneration(account, randomUUID);
      const membership = memberDoc.exists ? memberDoc.data() : null;
      if (membership?.status && membership.status !== 'active') {
        throw new HttpsError('permission-denied', '這間學校的成員資格已停用，請聯絡校方。');
      }
      const resolved = schoolLoginRoles(membership, profile.role);
      tx.set(
        userRef,
        {
          ...profile,
          role: resolved.role,
          primaryRole: resolved.role,
          schoolId,
          primarySchoolId: schoolId,
          lastLoginAt: FieldValue.serverTimestamp(),
          bindingGeneration,
          schoolIds: FieldValue.arrayUnion(schoolId),
          ...clearHaltFields(FieldValue),
          ...(userDoc.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      tx.set(
        memberRef,
        {
          ...membershipFields,
          status: 'active',
          role: resolved.memberRole,
          lastLoginAt: FieldValue.serverTimestamp(),
          ...campusStoryStampFields(schoolId, bindingGeneration),
          ...(memberDoc.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      extraRefs.forEach((ref, index) => {
        const snap = extraSnaps[index];
        if (!snap?.exists) return;
        const data = snap.data() || {};
        if (data.profileBoundSchoolId == null && data.profileBoundGeneration == null) return;
        tx.update(ref, storyMediaStampClearUpdate(FieldValue));
      });
      if (ssoLinkRef) tx.set(ssoLinkRef, { role: resolved.role }, { merge: true });
      return resolved;
    });
  };
}

module.exports = { createSchoolLoginProfileWriter, schoolLoginRoles };
