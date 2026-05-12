import {
  doc,
  getDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  endAt,
  type Firestore,
} from 'firebase/firestore';

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
    new Set(uids.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)),
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

/** Firestore 字首搜尋：依 displayName。亦支援貼上完整 Firebase UID（精準查一人）。 */
export async function searchSchoolDirectoryByDisplayNamePrefix(
  schoolId: string,
  prefix: string,
  maxResults = 24,
  db: Firestore = getDb(),
): Promise<SchoolDirectoryProfile[]> {
  const q = typeof prefix === 'string' ? prefix.trim() : '';
  if (!schoolId || !q) return [];

  const uidLike = /^[a-zA-Z0-9_-]{18,}$/.test(q);
  if (uidLike) {
    const [p] = await fetchSchoolDirectoryProfiles(schoolId, [q], db);
    return p ? [p] : [];
  }

  try {
    const dir = collection(db, 'schools', schoolId, 'directory');
    const qy = query(
      dir,
      orderBy('displayName'),
      startAt(q),
      endAt(`${q}\uf8ff`),
      limit(Math.min(Math.max(maxResults, 4), 40)),
    );
    const snap = await getDocs(qy);
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const uid = d.id;
      return {
        uid,
        displayName: typeof data.displayName === 'string' ? data.displayName : uid.slice(0, 8),
        avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
        department: typeof data.department === 'string' ? data.department : null,
        roleLabel: typeof data.roleLabel === 'string' ? data.roleLabel : null,
        isDiscoverable: data.isDiscoverable === true,
      } satisfies SchoolDirectoryProfile;
    });
  } catch {
    return [];
  }
}
