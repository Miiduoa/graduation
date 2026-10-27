import { FieldValue } from 'firebase-admin/firestore';
import { PROVIDENCE_SCHOOL_ID } from './puIdentity';

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
};

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
}: {
  db: SchoolLoginFirestore;
  uid: string;
  profile: SchoolLoginProfileInput;
  membershipFields?: Record<string, unknown>;
  courseOfferingIds?: string[];
}): Promise<{ role: string; memberRole: string; isNewUser: boolean }> {
  const userRef = db.doc('users/' + uid);
  const memberRef = db.doc('schools/' + PROVIDENCE_SCHOOL_ID + '/members/' + uid);
  const offeringRefs = courseOfferingIds
    .filter((id) => id && !id.includes('/'))
    .map((id) => ({
      id,
      ref: db.doc('schools/' + PROVIDENCE_SCHOOL_ID + '/courseTeachers/' + id),
    }));

  return db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const memberDoc = await tx.get(memberRef);
    const offeringDocs = [];
    for (const offering of offeringRefs) {
      offeringDocs.push({ ...offering, snap: await tx.get(offering.ref) });
    }

    const account = userDoc.exists ? userDoc.data() : {};
    if (account.accountDeletionInProgress === true || account.status === 'deleted') {
      throw new Error('account-deletion');
    }
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
        schoolId: PROVIDENCE_SCHOOL_ID,
        primarySchoolId: PROVIDENCE_SCHOOL_ID,
        lastLoginAt: FieldValue.serverTimestamp(),
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
        ...(memberDoc.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    for (const offering of offeringDocs) {
      const current = offering.snap.exists ? offering.snap.data() : {};
      const existing = Array.isArray(current.teacherUids) ? current.teacherUids.map(String) : [];
      const teacherUids = existing.includes(uid) ? existing : [...existing, uid];
      tx.set(offering.ref, { teacherUids }, { merge: true });
    }

    return { ...resolved, isNewUser };
  });
}
