import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getAuth, getCloudFunctionUrl, getDb, isFirebaseConfigured } from '@/lib/firebase';
import { areFunctionsConfigured, FunctionsUnconfiguredError } from '@/lib/functionsUrl';
import { fetchSchoolDirectoryProfiles } from '@/lib/community/firestore';

export type OwnershipTransferMember = {
  uid: string;
  role: string;
  displayName: string;
};

export type OwnershipMemberPage = {
  members: OwnershipTransferMember[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

export type TransferGroupOwnershipInput = {
  groupId: string;
  targetUid: string;
  operationId: string;
  expectedCurrentOwnerUid: string;
};

export type TransferGroupOwnershipResult = {
  success: true;
  reused: boolean;
  groupId: string;
  schoolId: string;
  fromUid: string;
  toUid: string;
  actorNewRole: string;
  operationId: string;
};

export type GroupOwnershipOrigin = {
  generation: number;
  uid: string;
  schoolId: string;
  groupId: string;
  targetUid: string;
  operationId: string;
};

type CurrentScope = () => boolean;

const PAGE_SIZE = 20;

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/');
}

function assertCurrent(uid: string, current: CurrentScope = () => true) {
  if (!isFirebaseConfigured() || !uid || !current() || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('帳號或連線已變更，請重新確認後再試。');
  }
}

export function createGroupOwnershipOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `own-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createGroupOwnershipOrigin(input: {
  generation: number;
  uid: string;
  schoolId: string;
  groupId: string;
  targetUid: string;
  operationId?: string;
}): GroupOwnershipOrigin {
  return {
    generation: input.generation,
    uid: input.uid,
    schoolId: input.schoolId,
    groupId: input.groupId,
    targetUid: input.targetUid,
    operationId: input.operationId ?? createGroupOwnershipOperationId(),
  };
}

export function isGroupOwnershipOriginCurrent(
  origin: GroupOwnershipOrigin,
  live: {
    generation: number;
    uid: string | null | undefined;
    schoolId: string;
    groupId: string | null | undefined;
  },
): boolean {
  return (
    origin.generation === live.generation &&
    Boolean(origin.uid) &&
    origin.uid === live.uid &&
    origin.schoolId === live.schoolId &&
    origin.groupId === live.groupId
  );
}

/**
 * Authorized active group members eligible to receive ownership (same group, not current owner).
 * Paginates with documentId ordering; display names come from the school directory.
 */
export async function loadEligibleOwnershipMembers(
  uid: string,
  schoolId: string,
  groupId: string,
  options: {
    current?: CurrentScope;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
    excludeUid?: string;
  } = {},
): Promise<OwnershipMemberPage> {
  const current = options.current ?? (() => true);
  assertCurrent(uid, current);
  if (!validId(groupId) || !validId(schoolId)) {
    throw new Error('群組或學校識別資料無效。');
  }

  const db = getDb();
  const constraints = [
    where('status', '==', 'active'),
    orderBy('__name__'),
    ...(options.cursor ? [startAfter(options.cursor)] : []),
    limit(PAGE_SIZE),
  ];
  const snap = await getDocsFromServer(
    query(collection(db, 'groups', groupId, 'members'), ...constraints),
  );
  assertCurrent(uid, current);

  const raw = snap.docs
    .map((entry) => {
      const data = entry.data();
      const role = typeof data.role === 'string' ? data.role : 'member';
      return { uid: entry.id, role, snap: entry };
    })
    .filter((row) => row.role !== 'owner' && row.uid !== (options.excludeUid ?? uid));

  const profiles = await fetchSchoolDirectoryProfiles(
    schoolId,
    raw.map((row) => row.uid),
  );
  assertCurrent(uid, current);
  const names = new Map(profiles.map((profile) => [profile.uid, profile.displayName || profile.uid.slice(0, 8)]));

  return {
    members: raw.map((row) => ({
      uid: row.uid,
      role: row.role,
      displayName: names.get(row.uid) || row.uid.slice(0, 8),
    })),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

export async function transferGroupOwnership(
  uid: string,
  input: TransferGroupOwnershipInput,
  current: CurrentScope = () => true,
): Promise<TransferGroupOwnershipResult> {
  assertCurrent(uid, current);
  if (uid !== input.expectedCurrentOwnerUid) {
    throw new Error('目前登入身分與轉讓發起者不符，請重新確認後再試。');
  }
  if (
    !validId(input.groupId) ||
    !validId(input.targetUid) ||
    !validId(input.operationId) ||
    !validId(input.expectedCurrentOwnerUid)
  ) {
    throw new Error('轉讓參數不完整，請重新選擇接收對象。');
  }

  if (!areFunctionsConfigured()) {
    throw new FunctionsUnconfiguredError('群組擁有權轉讓尚未啟用');
  }

  const auth = getAuth()!;
  const user = auth.currentUser!;
  const token = await user.getIdToken();
  assertCurrent(uid, current);
  if (getAuth()?.currentUser !== user) throw new Error('登入工作階段已變更。');

  const endpoint = getCloudFunctionUrl('transferGroupOwnership');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: input }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json();
    assertCurrent(uid, current);
    if (getAuth()?.currentUser !== user || !response.ok || payload.error) {
      const message =
        typeof payload?.error?.message === 'string' && payload.error.message.trim()
          ? payload.error.message
          : '未能確認轉讓結果，請更新列表後再決定是否重試。';
      throw new Error(message);
    }
    const result = payload.result ?? payload.data;
    if (!result || typeof result !== 'object' || result.success !== true) {
      throw new Error('未能確認轉讓結果，請更新列表後再決定是否重試。');
    }
    return result as TransferGroupOwnershipResult;
  } finally {
    clearTimeout(timeout);
  }
}

export async function confirmActorNoLongerOwner(
  uid: string,
  schoolId: string,
  groupId: string,
  current: CurrentScope = () => true,
): Promise<string> {
  assertCurrent(uid, current);
  const snap = await getDocFromServer(doc(getDb(), 'groups', groupId, 'members', uid));
  assertCurrent(uid, current);
  if (!snap.exists()) throw new Error('無法確認你的成員狀態，請更新列表。');
  const data = snap.data();
  if (data.status !== 'active') throw new Error('你的成員狀態已變更，請更新列表。');
  if (data.schoolId != null && data.schoolId !== schoolId) {
    throw new Error('群組學校資料不符，請更新列表。');
  }
  const role = typeof data.role === 'string' ? data.role : 'member';
  if (role === 'owner') {
    throw new Error('轉讓結果尚未反映為一般成員，請更新列表後再試。');
  }
  return role;
}

export function transferGroupOwnershipErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  if (/尚未啟用/.test(message)) {
    return message;
  }
  if (/登入|帳號|工作階段/.test(message)) {
    return '請先登入學校帳號後再轉讓擁有權。';
  }
  if (/權限|資格|訪客|校/.test(message)) {
    return message;
  }
  if (message && !/INTERNAL|HTTP|fetch/i.test(message)) return message;
  return '轉讓失敗，請確認連線後重試。';
}
