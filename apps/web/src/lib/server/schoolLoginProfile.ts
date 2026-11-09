import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getSchoolLoginConfig } from './schoolLoginConfig';

const DISPLAY_ROLES = new Set([
  'student',
  'teacher',
  'professor',
  'staff',
  'employee',
  'department_head',
  'principal',
  'alumni',
]);

type DocSnapshot = {
  exists: boolean;
  data: () => Record<string, unknown>;
};

type ProfileDocRef = {
  path?: string;
  get?: () => Promise<DocSnapshot>;
  set?: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown> | unknown;
};

type ProfileTransaction = {
  get: (ref: ProfileDocRef) => Promise<DocSnapshot>;
  set: (ref: ProfileDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
  update: (ref: ProfileDocRef, data: Record<string, unknown>) => void;
};

function extraSchoolIdsFromProfile(account: Record<string, unknown>, loginSchoolId: string) {
  const ids: string[] = [];
  const values = [account.schoolId, account.primarySchoolId];
  if (Array.isArray(account.schoolIds)) values.push(...account.schoolIds);
  for (const value of values) {
    if (typeof value === 'string' && value && value !== loginSchoolId && !ids.includes(value)) {
      ids.push(value);
    }
  }
  return ids;
}

export type SchoolLoginFirestore = {
  doc: (path: string) => ProfileDocRef;
  runTransaction: <T>(fn: (transaction: ProfileTransaction) => Promise<T>) => Promise<T>;
};

export type SchoolLoginProfileInput = {
  email: string;
  displayName: string;
  studentId?: string;
  department?: string;
  role: string;
};

export function schoolLoginRoles(
  membership: Record<string, unknown> | null,
  displayRole: string,
): { memberRole: string; role: string } {
  const memberRole = ['admin', 'editor'].includes(String(membership?.role || ''))
    ? String(membership?.role)
    : 'member';
  const safeDisplayRole = DISPLAY_ROLES.has(displayRole) ? displayRole : 'student';
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

export async function writeSchoolLoginProfile({
  db,
  uid,
  profile,
  membershipFields = {},
  courseOfferingIds = [],
  schoolId,
}: {
  db: SchoolLoginFirestore;
  uid: string;
  profile: SchoolLoginProfileInput;
  membershipFields?: Record<string, unknown>;
  courseOfferingIds?: string[];
  schoolId?: string;
}): Promise<{ role: string; memberRole: string; isNewUser: boolean }> {
  const school = getSchoolLoginConfig(schoolId);
  if (!school || school.status !== 'open' || !school.membershipSchoolId) {
    throw new Error('school-login-unavailable');
  }
  const membershipSchoolId = school.membershipSchoolId;
  const userRef = db.doc('users/' + uid);
  const memberRef = db.doc('schools/' + membershipSchoolId + '/members/' + uid);
  const offeringRefs = courseOfferingIds
    .filter((id) => id && !id.includes('/'))
    .map((id) => ({
      id,
      ref: db.doc('schools/' + membershipSchoolId + '/courseTeachers/' + id),
    }));
  const preview =
    typeof userRef.get === 'function' ? await userRef.get() : { exists: false, data: () => ({}) };
  const extraRefs = extraSchoolIdsFromProfile(
    preview.exists ? preview.data() : {},
    membershipSchoolId,
  ).map((id) => db.doc('schools/' + id + '/members/' + uid));

  return db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const memberDoc = await tx.get(memberRef);
    const extraSnaps: DocSnapshot[] = [];
    for (const ref of extraRefs) extraSnaps.push(await tx.get(ref));
    const offeringDocs = [];
    for (const offering of offeringRefs) {
      offeringDocs.push({ ...offering, snap: await tx.get(offering.ref) });
    }

    const account = userDoc.exists ? userDoc.data() : {};
    if (
      account.accountDeletionInProgress === true ||
      ['deleted', 'disabled', 'suspended', 'inactive'].includes(String(account.status || ''))
    ) {
      throw new Error('account-deletion');
    }
    const bindingGeneration =
      typeof account.bindingGeneration === 'string' && account.bindingGeneration
        ? account.bindingGeneration
        : randomUUID();
    const membership = memberDoc.exists ? memberDoc.data() : null;
    if (membership?.status && membership.status !== 'active') {
      throw new Error('membership-disabled');
    }
    const resolved = schoolLoginRoles(membership, profile.role);
    const isNewUser = !userDoc.exists;

    tx.set(
      userRef,
      {
        email: profile.email,
        displayName: profile.displayName,
        ...(profile.studentId ? { studentId: profile.studentId } : {}),
        department: profile.department || '',
        role: resolved.role,
        primaryRole: resolved.role,
        schoolId: membershipSchoolId,
        primarySchoolId: membershipSchoolId,
        lastLoginAt: FieldValue.serverTimestamp(),
        bindingGeneration,
        schoolIds: FieldValue.arrayUnion(membershipSchoolId),
        campusStoryBindingHaltKind: FieldValue.delete(),
        campusStoryBindingHaltAt: FieldValue.delete(),
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
        profileBoundSchoolId: membershipSchoolId,
        profileBoundGeneration: bindingGeneration,
        ...(memberDoc.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    extraRefs.forEach((ref, index) => {
      const snap = extraSnaps[index];
      if (!snap?.exists) return;
      const data = snap.data() || {};
      if (data.profileBoundSchoolId == null && data.profileBoundGeneration == null) return;
      tx.update(ref, {
        profileBoundSchoolId: FieldValue.delete(),
        profileBoundGeneration: FieldValue.delete(),
      });
    });

    for (const offering of offeringDocs) {
      const current = offering.snap.exists ? offering.snap.data() : {};
      const existing = Array.isArray(current.teacherUids) ? current.teacherUids.map(String) : [];
      const teacherUids = existing.includes(uid) ? existing : [...existing, uid];
      tx.set(offering.ref, { teacherUids }, { merge: true });
    }

    return { ...resolved, isNewUser };
  });
}
