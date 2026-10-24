const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');

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

  /**
   * Privileged ownership transfer. Client role writes cannot set role=owner (rules).
   * Idempotent via operationId + expectedCurrentOwnerUid; concurrent competing transfers
   * resolve safely inside a single transaction.
   */
  async function transferGroupOwnership(request) {
    const uid = user(request);
    const groupId = id(request.data?.groupId, 'groupId');
    const targetUid = id(request.data?.targetUid, 'targetUid');
    const operationId = id(request.data?.operationId, 'operationId');
    const expectedCurrentOwnerUid = id(
      request.data?.expectedCurrentOwnerUid,
      'expectedCurrentOwnerUid',
    );

    if (uid !== expectedCurrentOwnerUid) {
      throw new HttpsError(
        'permission-denied',
        'Only the current owner named in this transfer may complete it',
      );
    }
    if (uid === targetUid) {
      throw new HttpsError('invalid-argument', 'Cannot transfer ownership to yourself');
    }

    const result = await db.runTransaction(async (transaction) => {
      const groupRef = db.collection('groups').doc(groupId);
      const actorMemberRef = groupRef.collection('members').doc(uid);
      const targetMemberRef = groupRef.collection('members').doc(targetUid);
      const actorMirrorRef = db.collection('users').doc(uid).collection('groups').doc(groupId);
      const targetMirrorRef = db
        .collection('users')
        .doc(targetUid)
        .collection('groups')
        .doc(groupId);
      const operationRef = groupRef.collection('ownershipTransfers').doc(operationId);
      const actorUserRef = db.collection('users').doc(uid);
      const targetUserRef = db.collection('users').doc(targetUid);

      const [groupDoc, actorMemberDoc, targetMemberDoc, operationDoc, actorUserDoc, targetUserDoc] =
        await transaction.getAll(
          groupRef,
          actorMemberRef,
          targetMemberRef,
          operationRef,
          actorUserRef,
          targetUserRef,
        );
      // Touch mirrors so concurrent membership edits participate in the same transaction.
      await transaction.getAll(actorMirrorRef, targetMirrorRef);
      // Active owners only, limit 2: exactly one → proceed; two → fail closed (multi-owner
      // or would-be truncation). Never query role=owner then filter status after a larger limit.
      const ownerQuery = await transaction.get(
        groupRef
          .collection('members')
          .where('role', '==', 'owner')
          .where('status', '==', 'active')
          .limit(2),
      );

      if (!groupDoc.exists) {
        throw new HttpsError('not-found', 'Group was not found');
      }
      const group = groupDoc.data() || {};
      if (typeof group.schoolId !== 'string' || !group.schoolId.trim()) {
        throw new HttpsError('failed-precondition', '群組學校資料不完整，請稍後再試或聯絡管理員。');
      }
      const schoolId = group.schoolId;
      const auditRef = db
        .collection('schools')
        .doc(schoolId)
        .collection('adminLogs')
        .doc(
          `ownership-${createHash('sha256')
            .update(JSON.stringify([groupId, operationId]))
            .digest('hex')}`,
        );

      const [actorSchoolDoc, targetSchoolDoc] = await transaction.getAll(
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
        db.collection('schools').doc(schoolId).collection('members').doc(targetUid),
      );

      if (operationDoc.exists) {
        const prior = operationDoc.data() || {};
        if (
          prior.status === 'completed' &&
          prior.fromUid === uid &&
          prior.toUid === targetUid &&
          prior.schoolId === schoolId &&
          prior.expectedCurrentOwnerUid === expectedCurrentOwnerUid
        ) {
          // Authorized original actor may recover the immutable receipt (even after leave /
          // later handoff). Require current eligible account + active school seat first.
          // Never rewrite memberships or audit; never derive actorNewRole from live state.
          assertEligibleAccount(actorUserDoc, '目前帳號');
          assertActiveSchoolSeat(actorSchoolDoc, '目前帳號');
          if (typeof prior.actorNewRole !== 'string' || !prior.actorNewRole) {
            throw new HttpsError('failed-precondition', '轉讓紀錄不完整，請更新成員列表後再試。');
          }
          return {
            success: true,
            reused: true,
            groupId,
            schoolId,
            fromUid: prior.fromUid,
            toUid: prior.toUid,
            actorNewRole: prior.actorNewRole,
            operationId,
          };
        }
        throw new HttpsError('already-exists', '此操作代碼已用於其他轉讓，請用新的操作代碼重試。');
      }

      assertEligibleAccount(actorUserDoc, '目前帳號');
      assertEligibleAccount(targetUserDoc, '接收對象');
      assertActiveSchoolSeat(actorSchoolDoc, '目前帳號');
      assertActiveSchoolSeat(targetSchoolDoc, '接收對象');

      const actorMember = actorMemberDoc.exists ? actorMemberDoc.data() : {};
      const targetMember = targetMemberDoc.exists ? targetMemberDoc.data() : {};

      if (actorMember.status !== 'active' || actorMember.role !== 'owner') {
        throw new HttpsError('failed-precondition', '只有目前有效的群組擁有者可以轉讓擁有權。');
      }
      if (targetMember.status !== 'active') {
        throw new HttpsError('failed-precondition', '接收對象必須是此群組中仍有效的成員。');
      }
      if (targetMember.role === 'owner') {
        throw new HttpsError('failed-precondition', '接收對象已是擁有者。');
      }

      const activeOwners = ownerQuery.docs || [];
      if (activeOwners.length !== 1 || activeOwners[0].id !== uid) {
        throw new HttpsError(
          'failed-precondition',
          '群組擁有者狀態不一致，無法安全轉讓。請稍後再試或聯絡管理員。',
        );
      }

      const actorNewRole = 'member';
      const completedAt = FieldValue.serverTimestamp();
      const actorMembership = {
        ...actorMember,
        uid,
        role: actorNewRole,
        status: 'active',
        updatedAt: completedAt,
      };
      const targetMembership = {
        ...targetMember,
        uid: targetUid,
        role: 'owner',
        status: 'active',
        updatedAt: completedAt,
      };

      transaction.set(actorMemberRef, actorMembership);
      transaction.set(targetMemberRef, targetMembership);
      transaction.set(
        actorMirrorRef,
        mirror(groupId, group, { ...actorMembership, joinedAt: actorMember.joinedAt }, 'active'),
      );
      transaction.set(
        targetMirrorRef,
        mirror(groupId, group, { ...targetMembership, joinedAt: targetMember.joinedAt }, 'active'),
      );
      transaction.set(operationRef, {
        status: 'completed',
        fromUid: uid,
        toUid: targetUid,
        schoolId,
        expectedCurrentOwnerUid,
        actorNewRole,
        completedAt,
        auditLogId: auditRef.id,
        // Private audit receipt; readable only via Admin SDK / privileged tooling.
        scope: 'group-private',
      });
      // One immutable school-private success event per operation, same commit timestamp.
      transaction.create(auditRef, {
        action: 'transfer_group_ownership',
        details: `group=${groupId};from=${uid};to=${targetUid};operation=${operationId};reused=false`,
        actorUid: uid,
        createdAt: completedAt,
        scope: 'school-private',
      });

      return {
        success: true,
        reused: false,
        groupId,
        schoolId,
        fromUid: uid,
        toUid: targetUid,
        actorNewRole,
        operationId,
      };
    });

    return result;
  }

  return { joinGroupByCode, leaveGroup, transferGroupOwnership };
}

function assertEligibleAccount(userDoc, label) {
  const data = userDoc.exists ? userDoc.data() || {} : {};
  if (data.accountDeletionInProgress === true || data.status === 'deleted') {
    throw new HttpsError('failed-precondition', `${label}正在刪除或已停用，無法完成轉讓。`);
  }
  if (data.role === 'guest' || data.accountKind === 'guest') {
    throw new HttpsError('permission-denied', `${label}為訪客身分，無法持有或接收群組擁有權。`);
  }
}

function assertActiveSchoolSeat(schoolMemberDoc, label) {
  if (!schoolMemberDoc.exists || schoolMemberDoc.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', `${label}必須為此校有效成員。`);
  }
}

module.exports = { createGroupMembershipHandlers };
