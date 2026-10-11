'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
export async function sentRequestState(schoolId: string, fromUid: string, toUid: string): Promise<SentState> {
  const snap = await getDoc(doc(getDb(), 'friendships', friendshipId(schoolId, fromUid, toUid))).catch(() => null);
  if (!snap?.exists()) return { kind: 'none' };
  const data = snap.data() as FriendshipDoc;
  if (data.status === 'declined') {
    const declinedAtMs = millis(data.declinedAt);
    if (declinedAtMs && !canResendFriendRequest(declinedAtMs)) return { kind: 'declined', declinedAtMs };
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
    status: data.status === 'accepted' ? 'accepted' : data.status === 'blocked' ? 'blocked' : 'pending',
    incoming,
  };
}

async function listByStatus(schoolId: string, uid: string, status: string) {
  const col = collection(getDb(), 'friendships');
  const [sent, received] = await Promise.all([
    getDocs(query(col, where('schoolId', '==', schoolId), where('status', '==', status), where('fromUid', '==', uid))),
    getDocs(query(col, where('schoolId', '==', schoolId), where('status', '==', status), where('toUid', '==', uid))),
  ]);
  return [...sent.docs, ...received.docs].map((item) => toRow(item.id, item.data() as FriendshipDoc, uid));
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

function myHandleRef(uid: string) {
  return doc(getDb(), 'users', uid, 'settings', 'friendHandle');
}

export async function loadMyHandle(uid: string) {
  const [setting, profile] = await Promise.all([
    getDoc(myHandleRef(uid)).catch(() => null),
    getDoc(doc(getDb(), 'users', uid)).catch(() => null),
  ]);
  const handle = (setting?.data() as { handle?: string } | undefined)?.handle || '';
  const name = (profile?.data() as { displayName?: string } | undefined)?.displayName || '';
  return { handle, name };
}

export async function publishHandle(schoolId: string, uid: string, raw: string, name: string) {
  const handle = normalizeHandle(raw);
  if (!isValidHandle(handle)) throw new Error('invalid-handle');
  const previous = await loadMyHandle(uid);
  await setDoc(doc(getDb(), 'schools', schoolId, 'handles', handle), {
    uid,
    // 規則要求跟自己個人資料上的名字一樣
    name,
    handle,
    updatedAt: serverTimestamp(),
  });
  if (previous.handle && previous.handle !== handle) {
    await deleteDoc(doc(getDb(), 'schools', schoolId, 'handles', previous.handle)).catch(() => undefined);
  }
  await setDoc(myHandleRef(uid), { handle, updatedAt: serverTimestamp() });
  return handle;
}

export async function unpublishHandle(schoolId: string, uid: string) {
  const previous = await loadMyHandle(uid);
  if (previous.handle) {
    await deleteDoc(doc(getDb(), 'schools', schoolId, 'handles', previous.handle)).catch(() => undefined);
  }
  await deleteDoc(myHandleRef(uid));
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
  const payload = { schoolId, fromUid, toUid, fromName, status: 'pending', createdAt: serverTimestamp() };
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
  await updateDoc(doc(getDb(), 'friendships', id), { status: 'declined', declinedAt: serverTimestamp() });
}

export async function cancelFriendRequest(id: string) {
  await deleteDoc(doc(getDb(), 'friendships', id));
}
