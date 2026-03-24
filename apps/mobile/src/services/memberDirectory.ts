import { doc, getDoc, type Firestore } from 'firebase/firestore';

import { getDb } from '../firebase';

export type SchoolDirectoryProfile = {
  uid: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  roleLabel?: string | null;
  isDiscoverable?: boolean;
};

export async function fetchSchoolDirectoryProfiles(
  schoolId: string,
  uids: string[],
  db: Firestore = getDb(),
): Promise<SchoolDirectoryProfile[]> {
  const uniqueUids = Array.from(
    new Set(
      uids
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  );

  if (!schoolId || uniqueUids.length === 0) {
    return [];
  }

  const rows = await Promise.all(
    uniqueUids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'schools', schoolId, 'directory', uid));
        if (!snap.exists()) {
          return {
            uid,
            displayName: uid.slice(0, 8),
            avatarUrl: null,
            department: null,
            roleLabel: null,
            isDiscoverable: false,
          } satisfies SchoolDirectoryProfile;
        }

        const data = snap.data() as Record<string, unknown>;
        return {
          uid,
          displayName: typeof data.displayName === 'string' ? data.displayName : uid.slice(0, 8),
          avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
          department: typeof data.department === 'string' ? data.department : null,
          roleLabel: typeof data.roleLabel === 'string' ? data.roleLabel : null,
          isDiscoverable: data.isDiscoverable === true,
        } satisfies SchoolDirectoryProfile;
      } catch {
        return {
          uid,
          displayName: uid.slice(0, 8),
          avatarUrl: null,
          department: null,
          roleLabel: null,
          isDiscoverable: false,
        } satisfies SchoolDirectoryProfile;
      }
    }),
  );

  return rows;
}

export async function fetchSchoolDirectoryProfileMap(
  schoolId: string,
  uids: string[],
  db: Firestore = getDb(),
): Promise<Record<string, SchoolDirectoryProfile>> {
  const profiles = await fetchSchoolDirectoryProfiles(schoolId, uids, db);
  return Object.fromEntries(profiles.map((profile) => [profile.uid, profile]));
}
