import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from './httpsError';

export type CallableRequest = {
  auth?: { uid?: string; token?: Record<string, unknown> } | null;
  data?: unknown;
};

type DocSnap = {
  id: string;
  ref: DocRef;
  exists: boolean;
  data: () => Record<string, unknown>;
};

type QuerySnap = {
  docs: DocSnap[];
  size: number;
  empty: boolean;
};

type DocRef = {
  id: string;
  collection: (name: string) => CollectionRef;
};

type QueryRef = {
  where: (field: string, op: string, value: unknown) => QueryRef;
  limit: (count: number) => QueryRef;
};

type CollectionRef = QueryRef & {
  doc: (id?: string) => DocRef;
};

export type GroupFirestore = {
  collection: (name: string) => CollectionRef;
  runTransaction: <T>(fn: (transaction: any) => Promise<T>) => Promise<T>;
};

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `Invalid ${name}`);
  }
  return value.trim();
}

function user(request: CallableRequest): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return request.auth.uid;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HttpsError('failed-precondition', 'Group member count requires repair');
  }
  return value as number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function generateGroupJoinCode(length = 8): string {
  return randomBytes(length)
    .toString('base64url')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, length);
}

function mirror(
  groupId: string,
  group: Record<string, unknown>,
  membership: Record<string, unknown>,
  status: string,
) {
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

class JoinCodeTakenError extends Error {
  constructor() {
    super('join-code-taken');
    this.name = 'JoinCodeTakenError';
  }
}

export function createGroupInviteHandlers({ db }: { db: GroupFirestore }) {
  async function createGroup(request: CallableRequest) {
    const uid = user(request);
    const payload = asRecord(request.data);
    const { name, description, type, schoolId, isPrivate, isPublished } = payload;

    if (!name || !type || !schoolId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const schoolIdValue = String(schoolId);
    if (schoolIdValue.includes('/') || !schoolIdValue.trim()) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const joinCode = generateGroupJoinCode(8);
      try {
        return await db.runTransaction(async (transaction) => {
          const schoolMemberRef = db
            .collection('schools')
            .doc(schoolIdValue)
            .collection('members')
            .doc(uid);
          const existingCodes = (await transaction.get(
            db.collection('groups').where('joinCode', '==', joinCode).limit(1),
          )) as QuerySnap;
          const schoolMember = (await transaction.get(schoolMemberRef)) as DocSnap;
          if (!schoolMember.exists) {
            throw new HttpsError(
              'permission-denied',
              'User is not an active member of this school',
            );
          }
          const membership = schoolMember.data() || {};
          if (membership.status && membership.status !== 'active') {
            throw new HttpsError(
              'permission-denied',
              'User is not an active member of this school',
            );
          }
          if (!existingCodes.empty) {
            throw new JoinCodeTakenError();
          }

          const groupRef = db.collection('groups').doc();
          const memberRef = groupRef.collection('members').doc(uid);
          const mirrorRef = db.collection('users').doc(uid).collection('groups').doc(groupRef.id);
          const joinedAt = FieldValue.serverTimestamp();
          transaction.set(groupRef, {
            name,
            description: description || '',
            type,
            schoolId: schoolIdValue,
            isPrivate: !!isPrivate,
            isPublished: Boolean(isPublished),
            verification: { status: 'unverified' },
            joinCode,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            memberCount: 1,
          });
          transaction.set(memberRef, {
            uid,
            role: 'owner',
            status: 'active',
            joinedAt,
          });
          transaction.set(mirrorRef, {
            groupId: groupRef.id,
            schoolId: schoolIdValue,
            type,
            name,
            joinCode,
            status: 'active',
            role: 'owner',
            joinedAt,
          });
          return {
            success: true,
            groupId: groupRef.id,
            joinCode,
          };
        });
      } catch (error) {
        if (error instanceof JoinCodeTakenError) continue;
        throw error;
      }
    }

    throw new HttpsError('resource-exhausted', 'Failed to allocate a unique join code');
  }

  async function joinGroupByCode(request: CallableRequest) {
    const uid = user(request);
    const payload = asRecord(request.data);
    const schoolId = id(payload.schoolId, 'schoolId');
    const joinCode = id(payload.joinCode, 'joinCode').toUpperCase();
    return db.runTransaction(async (transaction) => {
      const groups = (await transaction.get(
        db.collection('groups').where('joinCode', '==', joinCode).limit(2),
      )) as QuerySnap;
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

  async function leaveGroup(request: CallableRequest) {
    const uid = user(request);
    const payload = asRecord(request.data);
    const groupId = id(payload.groupId, 'groupId');
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

  return { createGroup, joinGroupByCode, leaveGroup };
}
