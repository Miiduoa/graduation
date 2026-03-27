import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';

import { getDb } from '../../firebase';

export type ActiveUserGroup = {
  id: string;
  name: string;
};

export type PendingGroupAssignment = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  dueAt?: { seconds: number; nanoseconds?: number } | null;
  isLate?: boolean;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function toTimestampLike(value: unknown): { seconds: number; nanoseconds?: number } | null {
  if (
    value &&
    typeof value === 'object' &&
    'seconds' in value &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  ) {
    const timestamp = value as { seconds: number; nanoseconds?: number };
    return {
      seconds: timestamp.seconds,
      nanoseconds: timestamp.nanoseconds,
    };
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    const ms = (date as Date | null)?.getTime?.();
    if (typeof ms !== "number" || Number.isNaN(ms)) return null;
    return { seconds: Math.floor(ms / 1000) };
  }

  return null;
}

function getDueAtSeconds(value: PendingGroupAssignment['dueAt']): number {
  return value?.seconds ?? 0;
}

export async function listActiveUserGroups(uid: string, queryLimit = 10): Promise<ActiveUserGroup[]> {
  const db = getDb();
  const snapshot = await getDocs(
    query(collection(db, 'users', uid, 'groups'), where('status', '==', 'active'), limit(queryLimit))
  );

  return snapshot.docs.map((docSnap) => {
    const raw = toRecord(docSnap.data());
    return {
      id: docSnap.id,
      name: readString(raw.name, docSnap.id),
    };
  });
}

export async function listPendingAssignmentsForUserGroups(
  uid: string,
  options: {
    maxGroups?: number;
    assignmentsPerGroup?: number;
  } = {}
): Promise<PendingGroupAssignment[]> {
  const db = getDb();
  const groups = await listActiveUserGroups(uid, options.maxGroups ?? 10);
  const now = Timestamp.now();
  const groupAssignments = await Promise.all(
    groups.slice(0, options.maxGroups ?? 8).map(async (group) => {
      const assignmentsSnapshot = await getDocs(
        query(
          collection(db, 'groups', group.id, 'assignments'),
          where('dueAt', '>', now),
          orderBy('dueAt', 'asc'),
          limit(options.assignmentsPerGroup ?? 5)
        )
      ).catch(() => null);

      return (
        assignmentsSnapshot?.docs.map((docSnap) => {
          const raw = toRecord(docSnap.data());
          return {
            id: docSnap.id,
            groupId: group.id,
            groupName: group.name,
            title: readString(raw.title, '未命名作業'),
            dueAt: toTimestampLike(raw.dueAt),
            isLate: raw.isLate === true,
          };
        }) ?? []
      );
    })
  );

  return groupAssignments
    .flat()
    .sort((left, right) => getDueAtSeconds(left.dueAt) - getDueAtSeconds(right.dueAt));
}
