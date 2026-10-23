import {
  doc,
  getDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
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

function searchableProfile(
  uid: string,
  data: Record<string, unknown>,
): SchoolDirectoryProfile | null {
  if (data.isDiscoverable !== true) return null;
  return {
    uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : uid.slice(0, 8),
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
    department: typeof data.department === 'string' ? data.department : null,
    roleLabel: typeof data.roleLabel === 'string' ? data.roleLabel : null,
    isDiscoverable: true,
  };
}

/** 搜尋本人允許被找到的同校成員；查詢失敗交由畫面提供重試。 */
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
    // 作者姓名的顯示備援不代表帳號存在，找人必須確認實際的通訊錄資料。
    const snap = await getDoc(doc(db, 'schools', schoolId, 'directory', q));
    if (!snap.exists()) return [];
    const profile = searchableProfile(snap.id, snap.data() as Record<string, unknown>);
    return profile ? [profile] : [];
  }

  const dir = collection(db, 'schools', schoolId, 'directory');
  const qy = query(
    dir,
    where('isDiscoverable', '==', true),
    orderBy('displayName'),
    startAt(q),
    endAt(`${q}\uf8ff`),
    limit(Math.min(Math.max(maxResults, 4), 40)),
  );
  const snap = await getDocs(qy);
  return snap.docs
    .map((entry) => searchableProfile(entry.id, entry.data() as Record<string, unknown>))
    .filter((profile): profile is SchoolDirectoryProfile => profile !== null);
}
