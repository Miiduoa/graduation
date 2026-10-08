const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `Invalid ${name}`);
  }
  return value.trim();
}
function user(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return request.auth.uid;
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError('failed-precondition', 'Group member count requires repair');
  }
  return value;
}
function mirror(groupId, group, membership, status) {
  return {
    groupId,
    schoolId: group.schoolId,
    name: typeof group.name === 'string' ? group.name : null,
    type: typeof group.type === 'string' ? group.type : null,
    joinCode: typeof group.joinCode === 'string' ? group.joinCode : null,
    role: membership.role || 'member',
    status,
    joinedAt: membership.joinedAt || null,
  };
}

function createGroupMembershipHandlers({ db }) {
  async function joinGroupByCode(request) {
    const uid = user(request);
    const schoolId = id(request.data?.schoolId, 'schoolId');
    const joinCode = id(request.data?.joinCode, 'joinCode').toUpperCase();
    return db.runTransaction(async (transaction) => {
      const groups = await transaction.get(
        db.collection('groups').where('joinCode', '==', joinCode).limit(2),
      );
      if (groups.empty) throw new HttpsError('not-found', 'Invalid join code');
      if (groups.size !== 1) throw new HttpsError('failed-precondition', 'Join code is ambiguous');
      const groupDoc = groups.docs[0];
      const group = groupDoc.data();
      if (group.schoolId !== schoolId)
        throw new HttpsError('permission-denied', 'Join code belongs to a different school');
      const groupId = groupDoc.id;
      const memberRef = groupDoc.ref.collection('members').doc(uid);
      const mirrorRef = db.collection('users').doc(uid).collection('groups').doc(groupId);
      const [schoolMember, memberDoc] = await transaction.getAll(
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
        memberRef,
      );
      if (!schoolMember.exists || schoolMember.data().status !== 'active')
        throw new HttpsError('permission-denied', 'Active school membership required');
      const previous = memberDoc.exists ? memberDoc.data() : {};
      const reused = previous.status === 'active';
      const membership = reused
        ? previous
        : {
            uid,
            role: 'member',
            status: 'active',
            joinedAt: FieldValue.serverTimestamp(),
          };
      if (!reused) {
        transaction.set(memberRef, membership);
        transaction.update(groupDoc.ref, { memberCount: count(group.memberCount) + 1 });
      }
      // Replaying an active join also repairs a missing/stale user index, without changing role/count.
      transaction.set(mirrorRef, mirror(groupId, group, membership, 'active'));
      return {
        success: true,
        ownerUid: uid,
        groupId,
        groupName: group.name || null,
        status: 'active',
        reused,
      };
    });
  }

  async function leaveGroup(request) {
    const uid = user(request);
    const groupId = id(request.data?.groupId, 'groupId');
    return db.runTransaction(async (transaction) => {
      const groupRef = db.collection('groups').doc(groupId);
      const memberRef = groupRef.collection('members').doc(uid);
      const mirrorRef = db.collection('users').doc(uid).collection('groups').doc(groupId);
      const [groupDoc, memberDoc, mirrorDoc] = await transaction.getAll(
        groupRef,
        memberRef,
        mirrorRef,
      );
      const membership = memberDoc.exists ? memberDoc.data() : {};
      if (membership.status !== 'active') {
        if (mirrorDoc.exists && mirrorDoc.data().status !== 'left') {
          transaction.update(mirrorRef, { status: 'left', leftAt: FieldValue.serverTimestamp() });
        }
        return { success: true, ownerUid: uid, groupId, status: 'left', reused: true };
      }
      if (membership.role === 'owner')
        throw new HttpsError(
          'failed-precondition',
          'Owner cannot leave the group. Transfer ownership first.',
        );
      if (!groupDoc.exists)
        throw new HttpsError('failed-precondition', 'Group record requires repair');
      const group = groupDoc.data();
      if (!group.schoolId) throw new HttpsError('failed-precondition', 'Group school is missing');
      const leftAt = FieldValue.serverTimestamp();
      transaction.update(memberRef, { status: 'left', leftAt });
      transaction.update(groupRef, { memberCount: Math.max(0, count(group.memberCount) - 1) });
      transaction.set(mirrorRef, { ...mirror(groupId, group, membership, 'left'), leftAt });
      return { success: true, ownerUid: uid, groupId, status: 'left', reused: false };
    });
  }
  return { joinGroupByCode, leaveGroup };
}
module.exports = { createGroupMembershipHandlers };
