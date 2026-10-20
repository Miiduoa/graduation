'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Transaction,
} from 'firebase/firestore';
import { canResendFriendRequest } from '@campus/shared';
import { getDb } from '@/lib/firebase';

export type FriendRow = {
  id: string;
  uid: string;
  name: string;
  status: 'pending' | 'accepted' | 'blocked';
  incoming: boolean;
};

type FriendshipDoc = {
  schoolId: string;
  fromUid: string;
  toUid: string;
  fromName?: string;
  toName?: string;
  status: string;
  declinedAt?: { toMillis?: () => number } | null;
};

function millis(value: FriendshipDoc['declinedAt']) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : 0;
}

export type SentState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'accepted' }
  | { kind: 'blocked' }
  | { kind: 'declined'; declinedAtMs: number };

/** 我送給對方的邀請現在是什麼狀態（只看我送出的那份）。 */
export async function sentRequestState(
  schoolId: string,
  fromUid: string,
  toUid: string,
): Promise<SentState> {
  const snap = await getDoc(
    doc(getDb(), 'friendships', friendshipId(schoolId, fromUid, toUid)),
  ).catch(() => null);
  if (!snap?.exists()) return { kind: 'none' };
  const data = snap.data() as FriendshipDoc;
  if (data.status === 'declined') {
    const declinedAtMs = millis(data.declinedAt);
    if (declinedAtMs && !canResendFriendRequest(declinedAtMs))
      return { kind: 'declined', declinedAtMs };
    return { kind: 'none' };
  }
  if (data.status === 'accepted') return { kind: 'accepted' };
  if (data.status === 'blocked') return { kind: 'blocked' };
  return { kind: 'pending' };
}

/** 找人代號：小寫英數、底線、點、連字號，3 到 32 字。 */
export function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function isValidHandle(value: string) {
  return /^[a-z0-9_.-]{3,32}$/.test(value);
}

export function friendshipId(schoolId: string, fromUid: string, toUid: string) {
  return `req_${schoolId}_${fromUid}_${toUid}`;
}

function toRow(id: string, data: FriendshipDoc, me: string): FriendRow {
  const incoming = data.toUid === me;
  return {
    id,
    uid: incoming ? data.fromUid : data.toUid,
    name: (incoming ? data.fromName : data.toName) || '同學',
    status:
      data.status === 'accepted' ? 'accepted' : data.status === 'blocked' ? 'blocked' : 'pending',
    incoming,
  };
}

async function listByStatus(schoolId: string, uid: string, status: string) {
  const col = collection(getDb(), 'friendships');
  const [sent, received] = await Promise.all([
    getDocs(
      query(
        col,
        where('schoolId', '==', schoolId),
        where('status', '==', status),
        where('fromUid', '==', uid),
      ),
    ),
    getDocs(
      query(
        col,
        where('schoolId', '==', schoolId),
        where('status', '==', status),
        where('toUid', '==', uid),
      ),
    ),
  ]);
  return [...sent.docs, ...received.docs].map((item) =>
    toRow(item.id, item.data() as FriendshipDoc, uid),
  );
}

export async function listAcceptedFriends(schoolId: string, uid: string): Promise<FriendRow[]> {
  return listByStatus(schoolId, uid, 'accepted');
}

export async function listPendingRequests(schoolId: string, uid: string): Promise<FriendRow[]> {
  return listByStatus(schoolId, uid, 'pending');
}

/** 用完整的找人代號查一位同學。規則不允許列出整份名單。 */
export async function findByHandle(schoolId: string, raw: string) {
  const handle = normalizeHandle(raw);
  if (!isValidHandle(handle)) return null;
  const snap = await getDoc(doc(getDb(), 'schools', schoolId, 'handles', handle));
  if (!snap.exists()) return null;
  const data = snap.data() as { uid: string; name: string };
  return { uid: data.uid, name: data.name || '同學', handle };
}

function myHandleRef(schoolId: string, uid: string) {
  return doc(getDb(), 'users', uid, 'settings', `friendHandle:${schoolId}`);
}

async function ownedHandle(transaction: Transaction, schoolId: string, uid: string) {
  const setting = await transaction.get(myHandleRef(schoolId, uid));
  // Older clients kept a single pointer for every school. Only adopt it after
  // checking ownership in this school; keep it for other schools to recover.
  const source = setting.exists()
    ? setting
    : await transaction.get(doc(getDb(), 'users', uid, 'settings', 'friendHandle'));
  const handle: unknown = source.data()?.handle;
  if (!handle) return '';
  if (typeof handle !== 'string' || !isValidHandle(handle)) throw new Error('invalid-saved-handle');
  const published = await transaction.get(doc(getDb(), 'schools', schoolId, 'handles', handle));
  return published.exists() && published.data().uid === uid ? handle : '';
}

export async function loadMyHandle(schoolId: string, uid: string) {
  return runTransaction(getDb(), async (transaction) => {
    const handle = await ownedHandle(transaction, schoolId, uid);
    const profile = await transaction.get(doc(getDb(), 'users', uid));
    const name = String(profile.data()?.displayName ?? '');
    return { handle, name };
  });
}

export async function publishHandle(schoolId: string, uid: string, raw: string) {
  const handle = normalizeHandle(raw);
  if (!isValidHandle(handle)) throw new Error('invalid-handle');
  await runTransaction(getDb(), async (transaction) => {
    const previous = await ownedHandle(transaction, schoolId, uid);
    const target = doc(getDb(), 'schools', schoolId, 'handles', handle);
    const existing = await transaction.get(target);
    const profile = await transaction.get(doc(getDb(), 'users', uid));
    if (existing.exists() && existing.data().uid !== uid) throw new Error('handle-taken');
    // Reading the pointer inside the transaction serializes changes from other
    // tabs, so a retry removes the latest old alias instead of leaving it public.
    transaction.set(target, {
      uid,
      name: String(profile.data()?.displayName ?? ''),
      handle,
      updatedAt: serverTimestamp(),
    });
    if (previous && previous !== handle)
      transaction.delete(doc(getDb(), 'schools', schoolId, 'handles', previous));
    transaction.set(myHandleRef(schoolId, uid), { handle, updatedAt: serverTimestamp() });
  });
  return handle;
}

export async function unpublishHandle(schoolId: string, uid: string) {
  await runTransaction(getDb(), async (transaction) => {
    const previous = await ownedHandle(transaction, schoolId, uid);
    if (previous) transaction.delete(doc(getDb(), 'schools', schoolId, 'handles', previous));
    // An explicit empty pointer prevents a legacy alias being adopted again.
    transaction.set(myHandleRef(schoolId, uid), { handle: '', updatedAt: serverTimestamp() });
  });
}

export async function sendFriendRequest(
  schoolId: string,
  fromUid: string,
  toUid: string,
  fromName = '',
  toName = '',
) {
  if (fromUid === toUid) throw new Error('不能加自己');
  const ref = doc(getDb(), 'friendships', friendshipId(schoolId, fromUid, toUid));
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) {
    const status = (existing.data() as FriendshipDoc).status;
    if (status === 'pending' || status === 'accepted') return status;
    if (status === 'declined') {
      // 婉拒滿七天才能重送；舊邀請先拿掉再送
      const declinedAtMs = millis((existing.data() as FriendshipDoc).declinedAt);
      if (declinedAtMs && !canResendFriendRequest(declinedAtMs)) throw new Error('declined-wait');
      await deleteDoc(ref);
    } else throw new Error('blocked');
  }
  // 名字只能用雙方個人資料上的名字；對方改過名就先留空，等對方接受時補上
  const payload = {
    schoolId,
    fromUid,
    toUid,
    fromName,
    status: 'pending',
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, { ...payload, toName });
  } catch (error) {
    if (!toName) throw error;
    await setDoc(ref, { ...payload, toName: '' });
  }
  return 'sent';
}

export async function acceptFriendRequest(id: string, myName = '') {
  await updateDoc(doc(getDb(), 'friendships', id), {
    status: 'accepted',
    toName: myName,
    acceptedAt: serverTimestamp(),
  });
}

export async function declineFriendRequest(id: string) {
  await updateDoc(doc(getDb(), 'friendships', id), {
    status: 'declined',
    declinedAt: serverTimestamp(),
  });
}

export async function cancelFriendRequest(id: string) {
  await deleteDoc(doc(getDb(), 'friendships', id));
}
