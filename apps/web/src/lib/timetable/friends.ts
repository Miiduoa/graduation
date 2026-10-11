'use client';

import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

export type FriendRow = {
  id: string;
  uid: string;
  name: string;
  username?: string;
  status: 'pending' | 'accepted' | 'blocked';
  incoming: boolean;
};

function opponent(fromUid: string, toUid: string, me: string) {
  return fromUid === me ? toUid : fromUid;
}

async function profileName(uid: string) {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  const data = snap.data() as { displayName?: string; username?: string } | undefined;
  return { name: data?.displayName || '同學', username: data?.username };
}

export async function listAcceptedFriends(schoolId: string, uid: string): Promise<FriendRow[]> {
  const col = collection(getDb(), 'friendships');
  const [a, b] = await Promise.all([
    getDocs(query(col, where('schoolId', '==', schoolId), where('status', '==', 'accepted'), where('fromUid', '==', uid))),
    getDocs(query(col, where('schoolId', '==', schoolId), where('status', '==', 'accepted'), where('toUid', '==', uid))),
  ]);
  const rows = [...a.docs, ...b.docs];
  const out: FriendRow[] = [];
  for (const item of rows) {
    const data = item.data();
    const other = opponent(data.fromUid, data.toUid, uid);
    const profile = await profileName(other);
    out.push({
      id: item.id,
      uid: other,
      name: profile.name,
      username: profile.username,
      status: 'accepted',
      incoming: false,
    });
  }
  return out;
}

export async function searchPeople(schoolId: string, needle: string) {
  const term = needle.trim();
  if (term.length < 2) return [];
  const snap = await getDocs(query(collection(getDb(), 'schools', schoolId, 'members'), where('status', '==', 'active')));
  const out: Array<{ uid: string; name: string; username?: string }> = [];
  for (const item of snap.docs.slice(0, 80)) {
    const profile = await profileName(item.id);
    const hay = `${profile.name} ${profile.username || ''} ${item.id}`.toLowerCase();
    if (hay.includes(term.toLowerCase()) || (profile.username && `@${profile.username}`.includes(term))) {
      out.push({ uid: item.id, ...profile });
    }
  }
  return out.slice(0, 20);
}

export async function sendFriendRequest(schoolId: string, fromUid: string, toUid: string) {
  if (fromUid === toUid) throw new Error('不能加自己');
  const id = `req_${schoolId}_${fromUid}_${toUid}`;
  await setDoc(doc(getDb(), 'friendships', id), {
    schoolId,
    fromUid,
    toUid,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function acceptFriendRequest(id: string) {
  await updateDoc(doc(getDb(), 'friendships', id), { status: 'accepted', acceptedAt: serverTimestamp() });
}
