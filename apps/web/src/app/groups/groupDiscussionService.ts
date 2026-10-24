import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  updateDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';
import { readMemberGroup, type MemberGroup } from './groupService';

export type GroupDiscussionPost = {
  id: string;
  groupId: string;
  kind: 'post' | 'question' | 'announcement';
  title: string;
  body: string;
  authorId: string;
  authorName: string | null;
  schoolId: string;
  createdAt: unknown;
};

export type DiscussionPage = {
  posts: GroupDiscussionPost[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

export type CreateDiscussionInput = {
  title: string;
  body: string;
  kind?: 'post' | 'question' | 'announcement';
  /** 每次發布意圖的穩定 ID；重試必須重用，成功後換新意圖。 */
  postId: string;
};

type CurrentScope = () => boolean;
const PAGE_SIZE = 20;
const MANAGER_ROLES = new Set(['owner', 'admin', 'instructor', 'moderator']);

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/');
}

function assertCurrent(uid: string, current: CurrentScope = () => true) {
  if (!isFirebaseConfigured() || !uid || !current() || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('Account or connection changed');
  }
}

function canManage(role: string): boolean {
  return MANAGER_ROLES.has(role);
}

export function createPublicationIntentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapPost(
  groupId: string,
  entry: { id: string; data: () => DocumentData },
): GroupDiscussionPost | null {
  const data = entry.data();
  if (!validId(entry.id)) return null;
  const kind =
    data.kind === 'question' || data.kind === 'announcement' || data.kind === 'post'
      ? data.kind
      : 'post';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const authorId = typeof data.authorId === 'string' ? data.authorId : '';
  if (!title || !body || !validId(authorId)) return null;
  return {
    id: entry.id,
    groupId,
    kind,
    title,
    body,
    authorId,
    authorName: typeof data.authorName === 'string' ? data.authorName : null,
    schoolId: typeof data.schoolId === 'string' ? data.schoolId : '',
    createdAt: data.createdAt ?? null,
  };
}

function samePublication(
  data: DocumentData,
  input: { title: string; body: string; kind: string; uid: string; schoolId: string },
): boolean {
  return (
    data.authorId === input.uid &&
    data.schoolId === input.schoolId &&
    (data.kind ?? 'post') === input.kind &&
    typeof data.title === 'string' &&
    data.title.trim() === input.title &&
    typeof data.body === 'string' &&
    data.body.trim() === input.body
  );
}

export async function loadGroupDiscussionPage(
  uid: string,
  schoolId: string,
  groupId: string,
  current: CurrentScope = () => true,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null,
): Promise<{ group: MemberGroup; page: DiscussionPage }> {
  assertCurrent(uid, current);
  if (!validId(groupId)) throw new Error('Invalid group identifier');
  const group = await readMemberGroup(uid, schoolId, groupId);
  assertCurrent(uid, current);
  const postsRef = collection(getDb(), 'groups', groupId, 'posts');
  const pageQuery = cursor
    ? query(postsRef, orderBy('createdAt', 'desc'), startAfter(cursor), limit(PAGE_SIZE))
    : query(postsRef, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
  const snap = await getDocsFromServer(pageQuery);
  assertCurrent(uid, current);
  const posts = snap.docs
    .map((entry) => mapPost(groupId, entry))
    .filter((row): row is GroupDiscussionPost => row != null);
  return {
    group,
    page: {
      posts,
      cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]! : null,
      hasMore: snap.docs.length >= PAGE_SIZE,
    },
  };
}

function assertTxnScope(uid: string, schoolId: string, current: CurrentScope) {
  // Firestore may retry this callback; every attempt must re-check live scope.
  if (!isFirebaseConfigured() || !current() || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('Account or connection changed');
  }
  if (!validId(schoolId)) throw new Error('Invalid school identifier');
}

/**
 * 以穩定 postId 原子建立貼文（runTransaction）：
 * - 不存在 → create（規則：authorId == auth.uid）
 * - 已存在且同作者同內容 → 回傳既有，不寫入
 * - 已存在但內容／作者不同 → 拒絕，不覆寫 likes／編輯
 */
export async function createGroupDiscussionPost(
  uid: string,
  schoolId: string,
  groupId: string,
  input: CreateDiscussionInput,
  current: CurrentScope,
  authorName?: string | null,
): Promise<GroupDiscussionPost> {
  assertCurrent(uid, current);
  if (!validId(groupId) || !validId(input.postId)) throw new Error('Invalid group or post identifier');
  const group = await readMemberGroup(uid, schoolId, groupId);
  assertCurrent(uid, current);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 120) throw new Error('Invalid title');
  if (!body || body.length > 8000) throw new Error('Invalid body');
  const kind = input.kind ?? 'post';
  if (kind === 'announcement' && !canManage(group.role)) {
    throw new Error('Only group managers can post announcements');
  }

  const ref = doc(getDb(), 'groups', groupId, 'posts', input.postId);
  const memberRef = doc(getDb(), 'groups', groupId, 'members', uid);
  const author = authorName?.trim() || null;
  const payload = {
    kind,
    title,
    body,
    topic: '討論',
    createdAt: serverTimestamp(),
    authorId: uid,
    authorName: author,
    schoolId,
    likes: 0,
    likedBy: [] as string[],
    clientIntentId: input.postId,
  };

  const result = await runTransaction(getDb(), async (transaction) => {
    assertTxnScope(uid, schoolId, current);
    const [existing, member] = await Promise.all([
      transaction.get(ref),
      transaction.get(memberRef),
    ]);
    assertTxnScope(uid, schoolId, current);
    if (!member.exists() || member.data()?.status !== 'active') {
      throw new Error('Group membership is no longer active');
    }
    if (member.data()?.schoolId != null && member.data()?.schoolId !== schoolId) {
      throw new Error('Group does not match this account and school');
    }
    if (existing.exists()) {
      const data = existing.data()!;
      if (samePublication(data, { title, body, kind, uid, schoolId })) {
        const mapped = mapPost(groupId, existing);
        if (!mapped) throw new Error('Existing post could not be confirmed');
        return { status: 'existing' as const, post: mapped };
      }
      // 絕不 transaction.set 覆寫已變更貼文（保留 likes／既有編輯）。
      throw new Error('Post intent conflict');
    }
    transaction.set(ref, payload);
    return { status: 'created' as const };
  });

  assertCurrent(uid, current);
  if (getAuth()?.currentUser?.uid !== uid) throw new Error('Account or connection changed');
  if (result.status === 'existing') return result.post;
  return {
    id: input.postId,
    groupId,
    kind,
    title,
    body,
    authorId: uid,
    authorName: author,
    schoolId,
    createdAt: null,
  };
}

export async function updateGroupDiscussionPost(
  uid: string,
  schoolId: string,
  groupId: string,
  postId: string,
  input: { title: string; body: string },
  current: CurrentScope,
  existing?: GroupDiscussionPost,
): Promise<void> {
  assertCurrent(uid, current);
  if (!validId(postId)) throw new Error('Invalid post identifier');
  const group = await readMemberGroup(uid, schoolId, groupId);
  assertCurrent(uid, current);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 120 || !body || body.length > 8000) throw new Error('Invalid content');
  if (existing && existing.authorId !== uid && !canManage(group.role)) {
    throw new Error('Not allowed to edit this post');
  }
  await updateDoc(doc(getDb(), 'groups', groupId, 'posts', postId), { title, body });
  assertCurrent(uid, current);
}

export async function deleteGroupDiscussionPost(
  uid: string,
  schoolId: string,
  groupId: string,
  postId: string,
  current: CurrentScope,
  existing?: GroupDiscussionPost,
): Promise<void> {
  assertCurrent(uid, current);
  if (!validId(postId)) throw new Error('Invalid post identifier');
  const group = await readMemberGroup(uid, schoolId, groupId);
  assertCurrent(uid, current);
  if (existing && existing.authorId !== uid && !canManage(group.role)) {
    throw new Error('Not allowed to delete this post');
  }
  await deleteDoc(doc(getDb(), 'groups', groupId, 'posts', postId));
  assertCurrent(uid, current);
}

export function canEditPost(role: string, authorId: string, uid: string): boolean {
  return authorId === uid || canManage(role);
}
