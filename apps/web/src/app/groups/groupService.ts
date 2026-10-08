import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';

export type MemberGroup = {
  id: string;
  schoolId: string;
  name: string;
  description: string;
  type: 'course' | 'club' | 'study' | 'other';
  role: string;
  memberCount: number | null;
};
type CurrentScope = () => boolean;

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/');
}
function assertCurrent(uid: string, current: CurrentScope = () => true) {
  if (!isFirebaseConfigured() || !uid || !current() || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('Account or connection changed');
  }
}
function verifyMirror(data: Record<string, unknown>, id: string, schoolId: string, status: string) {
  if (
    data.schoolId !== schoolId ||
    data.status !== status ||
    (data.groupId != null && data.groupId !== id)
  ) {
    throw new Error('Membership could not be confirmed');
  }
}
async function readMemberGroup(uid: string, schoolId: string, id: string): Promise<MemberGroup> {
  assertCurrent(uid);
  if (!validId(id)) throw new Error('Invalid group identifier');
  const db = getDb();
  const [group, member] = await Promise.all([
    getDocFromServer(doc(db, 'groups', id)),
    getDocFromServer(doc(db, 'groups', id, 'members', uid)),
  ]);
  assertCurrent(uid);
  if (!group.exists() || !member.exists() || member.data().status !== 'active') {
    throw new Error('Group membership is no longer active');
  }
  const data = group.data();
  const membership = member.data();
  if (
    data.schoolId !== schoolId ||
    (membership.uid != null && membership.uid !== uid) ||
    (membership.userId != null && membership.userId !== uid)
  ) {
    throw new Error('Group does not match this account and school');
  }
  return {
    id,
    schoolId,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : '未命名群組',
    description: typeof data.description === 'string' ? data.description : '',
    type: ['course', 'club', 'study'].includes(data.type) ? data.type : 'other',
    role: typeof membership.role === 'string' ? membership.role : 'member',
    memberCount:
      Number.isInteger(data.memberCount) && data.memberCount >= 0 ? data.memberCount : null,
  };
}

export async function loadMyGroups(uid: string, schoolId: string): Promise<MemberGroup[]> {
  assertCurrent(uid);
  const memberships = await getDocsFromServer(collection(getDb(), 'users', uid, 'groups'));
  assertCurrent(uid);
  const active = memberships.docs.filter(
    (entry) => entry.data().schoolId === schoolId && entry.data().status === 'active',
  );
  const groups = await Promise.all(
    active.map((entry) => {
      // The server writes the Firestore group ID into both the document ID and groupId.
      verifyMirror(entry.data(), entry.id, schoolId, 'active');
      return readMemberGroup(uid, schoolId, entry.id);
    }),
  );
  assertCurrent(uid);
  return groups.sort((left, right) => left.name.localeCompare(right.name, 'zh-TW'));
}

async function callForUser(
  name: 'joinGroupByCode' | 'leaveGroup',
  input: Record<string, string>,
  uid: string,
  current: CurrentScope,
): Promise<Record<string, unknown>> {
  assertCurrent(uid, current);
  const auth = getAuth()!;
  const user = auth.currentUser!;
  const token = await user.getIdToken();
  assertCurrent(uid, current);
  if (getAuth()?.currentUser !== user) throw new Error('Login session changed');
  const projectId = auth.app.options.projectId;
  if (!projectId) throw new Error('Service unavailable');
  const region = process.env.NEXT_PUBLIC_CLOUD_FUNCTION_REGION || 'asia-east1';
  const emulator =
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === '1' ||
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || 'localhost';
  const port = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT || '5001';
  const endpoint = emulator
    ? `http://${host}:${port}/${projectId}/${region}/${name}`
    : `https://${region}-${projectId}.cloudfunctions.net/${name}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    // Pin the initiating user's token; the Functions SDK can read a newer account lazily.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: input }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json();
    assertCurrent(uid, current);
    if (getAuth()?.currentUser !== user || !response.ok || payload.error)
      throw new Error('Operation was not confirmed');
    const result = payload.result ?? payload.data;
    if (!result || typeof result !== 'object' || result.success !== true)
      throw new Error('Operation was not confirmed');
    return result as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function joinByCode(
  uid: string,
  schoolId: string,
  code: string,
  current: CurrentScope,
): Promise<MemberGroup> {
  const joinCode = code.trim().toUpperCase();
  if (!joinCode || joinCode.length > 64) throw new Error('Invalid invitation code');
  const result = await callForUser('joinGroupByCode', { schoolId, joinCode }, uid, current);
  if (!validId(result.groupId)) throw new Error('Missing group identifier');
  assertCurrent(uid, current);
  const mirror = await getDocFromServer(doc(getDb(), 'users', uid, 'groups', result.groupId));
  assertCurrent(uid, current);
  if (!mirror.exists()) throw new Error('Membership could not be confirmed');
  verifyMirror(mirror.data(), result.groupId, schoolId, 'active');
  const group = await readMemberGroup(uid, schoolId, result.groupId);
  assertCurrent(uid, current);
  return group;
}

export async function leaveMemberGroup(
  uid: string,
  schoolId: string,
  groupId: string,
  current: CurrentScope,
): Promise<void> {
  assertCurrent(uid, current);
  const group = await readMemberGroup(uid, schoolId, groupId);
  assertCurrent(uid, current);
  if (group.role === 'owner') throw new Error('Ownership must be transferred first');
  await callForUser('leaveGroup', { groupId }, uid, current);
  assertCurrent(uid, current);
  // After leaving, group/member reads are denied. This server-owned user mirror remains readable.
  const mirror = await getDocFromServer(doc(getDb(), 'users', uid, 'groups', groupId));
  assertCurrent(uid, current);
  if (!mirror.exists()) throw new Error('Leaving could not be confirmed');
  verifyMirror(mirror.data(), groupId, schoolId, 'left');
}
