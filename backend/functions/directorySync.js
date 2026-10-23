'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { buildSchoolDirectoryProfile } = require('./authz');

function getSchoolDirectoryRef(db, schoolId, uid) {
  return db.collection('schools').doc(schoolId).collection('directory').doc(uid);
}

async function loadSchoolMembershipDocs(db, uid) {
  if (!uid) return [];
  const schoolsSnap = await db.collection('schools').get();
  const memberships = [];
  for (const schoolDoc of schoolsSnap.docs) {
    const memberSnap = await db
      .collection('schools')
      .doc(schoolDoc.id)
      .collection('members')
      .doc(uid)
      .get();
    memberships.push({
      schoolId: schoolDoc.id,
      exists: memberSnap.exists,
      membership: memberSnap.exists ? memberSnap.data() || {} : null,
    });
  }
  return memberships;
}

async function syncSchoolDirectoryEntry(
  db,
  { schoolId, uid, userData = null, membership = null, getActiveSchoolMembership },
) {
  if (!schoolId || !uid) return;

  const [resolvedUserData, resolvedMembership] = await Promise.all([
    userData
      ? Promise.resolve(userData)
      : db
          .collection('users')
          .doc(uid)
          .get()
          .then((docSnap) => (docSnap.exists ? docSnap.data() : null)),
    membership
      ? Promise.resolve(membership)
      : getActiveSchoolMembership
        ? getActiveSchoolMembership(schoolId, uid)
        : db
            .collection('schools')
            .doc(schoolId)
            .collection('members')
            .doc(uid)
            .get()
            .then((snap) => {
              if (!snap.exists) return null;
              const data = snap.data() || {};
              if (data.status && data.status !== 'active') return null;
              return data;
            }),
  ]);

  const directoryRef = getSchoolDirectoryRef(db, schoolId, uid);
  if (!resolvedUserData || !resolvedMembership) {
    await directoryRef.delete().catch(() => null);
    return;
  }

  const profile = buildSchoolDirectoryProfile({
    uid,
    userData: resolvedUserData,
    membership: resolvedMembership,
  });

  await directoryRef.set(
    {
      ...profile,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system-sync',
    },
    { merge: true },
  );
}

async function syncDirectoryEntriesForUser(db, uid, userData = null, helpers = {}) {
  if (!uid) return;

  const memberships = await loadSchoolMembershipDocs(db, uid);
  for (const item of memberships) {
    if (!item.exists || (item.membership?.status && item.membership.status !== 'active')) {
      await getSchoolDirectoryRef(db, item.schoolId, uid)
        .delete()
        .catch(() => null);
      continue;
    }
    await syncSchoolDirectoryEntry(db, {
      schoolId: item.schoolId,
      uid,
      userData,
      membership: item.membership,
      getActiveSchoolMembership: helpers.getActiveSchoolMembership,
    });
  }
}

module.exports = {
  getSchoolDirectoryRef,
  loadSchoolMembershipDocs,
  syncDirectoryEntriesForUser,
  syncSchoolDirectoryEntry,
};
