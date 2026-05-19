/**
 * 校園社群 — Firestore service (Web)
 *
 * 對應 mobile 端 services/{feed,threads,boards,stories,aliasService,checkins,
 *   reportSystem,memberDirectory,campusCourseReviews}.ts 的 schema。
 *
 * 為了維持 web 端的可讀性，集中在一個檔案；輸出按模組分群註解。
 *
 * Schema 已由 mobile 確定，rules 已部署到對應 Firestore：
 *   schools/{sid}/campusPosts/{postId}
 *   schools/{sid}/campusPosts/{postId}/replies/{replyId}
 *   schools/{sid}/boards/{boardId}
 *   schools/{sid}/boardSubs/{uid_boardId}
 *   schools/{sid}/lbsPresence/{sessionId}
 *   schools/{sid}/directory/{uid}
 *   schools/{sid}/courseReviews/{reviewId}
 *   campusStories/{storyId}（top-level，跨校查詢用 schoolId 過濾）
 *   campusReports/{autoId}
 *   users/{uid}/campusBoardAliases/{boardId}
 */
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

// ═══════════════════════════════════════════════════════════════
// CampusPost (feed)
// ═══════════════════════════════════════════════════════════════
export type CampusPostDoc = {
  id: string;
  schoolId: string;
  boardId: string;
  anonymous: boolean;
  aliasSnapshot?: string;
  authorUid?: string | null;
  title: string;
  content: string;
  tags?: string[];
  kind?: 'standard' | 'thread';
  mediaUrls?: string[];
  mentions?: string[];
  likes?: number;
  likedBy?: string[];
  commentCount?: number;
  pinned?: boolean;
  createdAt?: Timestamp | Date | unknown;
  updatedAt?: Timestamp | Date | unknown;
};

function postsCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'campusPosts');
}

export async function fetchRecentCampusPosts(
  schoolId: string,
  boardId?: string,
  lim = 30,
): Promise<CampusPostDoc[]> {
  const db = getDb();
  try {
    const filters = boardId ? [where('boardId', '==', boardId)] : [];
    const qb = query(postsCol(db, schoolId), ...filters, orderBy('createdAt', 'desc'), limit(lim));
    const snap = await getDocs(qb);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusPostDoc, 'id'>) }));
  } catch {
    const snap = await getDocs(query(postsCol(db, schoolId), limit(Math.min(lim, 25))));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusPostDoc, 'id'>) }));
  }
}

export function rankFeedPosts(posts: CampusPostDoc[], topN = 40): CampusPostDoc[] {
  const now = Date.now();
  const score = (p: CampusPostDoc) => {
    const ms = tsToMillis(p.createdAt);
    const ageHr = ms ? Math.max(1, (now - ms) / 3600000) : 24;
    const likes =
      typeof p.likes === 'number' ? p.likes : Array.isArray(p.likedBy) ? p.likedBy.length : 0;
    const replies = typeof p.commentCount === 'number' ? p.commentCount : 0;
    return (likes + replies * 2 + (p.pinned ? 80 : 0)) / Math.pow(ageHr + 2, 1.35);
  };
  return [...posts].sort((a, b) => score(b) - score(a)).slice(0, topN);
}

export async function toggleCampusPostLike(schoolId: string, postId: string, userId: string) {
  const db = getDb();
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists()) throw new Error('貼文不存在');
    const d = snap.data() as Record<string, unknown>;
    const likedArr = Array.isArray(d.likedBy) ? (d.likedBy as string[]) : [];
    const liked = likedArr.includes(userId);
    if (liked) {
      tx.update(postRef, {
        likedBy: arrayRemove(userId),
        likes: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(postRef, {
        likedBy: arrayUnion(userId),
        likes: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function createCampusPost(input: {
  schoolId: string;
  boardId: string;
  title: string;
  content: string;
  anonymous: boolean;
  aliasSnapshot?: string;
  authorUid?: string;
  tags?: string[];
  mentions?: string[];
  mediaUrls?: string[];
  kind?: 'standard' | 'thread';
}): Promise<string> {
  const db = getDb();
  const ref = postsCol(db, input.schoolId);
  const base: Record<string, unknown> = {
    schoolId: input.schoolId,
    boardId: input.boardId,
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    kind: input.kind ?? 'standard',
    likes: 0,
    likedBy: [],
    commentCount: 0,
    pinned: false,
    mentions: input.mentions ?? [],
    mediaUrls: input.mediaUrls ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.anonymous) {
    base.anonymous = true;
    base.aliasSnapshot = (input.aliasSnapshot ?? '匿名使用者').trim() || '匿名使用者';
    const docRef = await addDoc(ref, base);
    return docRef.id;
  }
  base.anonymous = false;
  base.authorUid = input.authorUid;
  const docRef = await addDoc(ref, base);
  return docRef.id;
}

export async function updateCampusPost(
  schoolId: string,
  postId: string,
  patch: { title?: string; content?: string; tags?: string[]; mediaUrls?: string[] },
) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.title === 'string') data.title = patch.title;
  if (typeof patch.content === 'string') data.content = patch.content;
  if (Array.isArray(patch.tags)) data.tags = patch.tags;
  if (Array.isArray(patch.mediaUrls)) data.mediaUrls = patch.mediaUrls;
  await updateDoc(ref, data);
}

export async function deleteCampusPost(schoolId: string, postId: string) {
  const db = getDb();
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const repliesCol = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  const replySnap = await getDocs(query(repliesCol, limit(400)));
  let batch = writeBatch(db);
  let count = 0;
  for (const r of replySnap.docs) {
    batch.delete(r.ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  batch.delete(postRef);
  await batch.commit();
}

export async function getCampusPostById(
  schoolId: string,
  postId: string,
): Promise<CampusPostDoc | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, 'schools', schoolId, 'campusPosts', postId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CampusPostDoc, 'id'>) };
}

// ═══════════════════════════════════════════════════════════════
// Replies (threaded)
// ═══════════════════════════════════════════════════════════════
export type CampusReply = {
  id: string;
  content: string;
  anonymous?: boolean;
  aliasSnapshot?: string;
  authorUid?: string | null;
  parentReplyId?: string | null;
  depth?: number;
  deleted?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export async function addCampusReply(
  schoolId: string,
  postId: string,
  payload: {
    anonymous: boolean;
    aliasSnapshot?: string;
    authorUid?: string;
    content: string;
    parentReplyId?: string | null;
    depth?: number;
  },
) {
  const db = getDb();
  const replies = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const row: Record<string, unknown> = {
    content: payload.content,
    anonymous: payload.anonymous,
    parentReplyId: payload.parentReplyId ?? null,
    depth: typeof payload.depth === 'number' ? payload.depth : 0,
    createdAt: serverTimestamp(),
  };
  if (payload.anonymous) row.aliasSnapshot = payload.aliasSnapshot ?? '';
  else row.authorUid = payload.authorUid;

  const replyRef = doc(replies);
  const batch = writeBatch(db);
  batch.set(replyRef, row);
  batch.update(postRef, { commentCount: increment(1), updatedAt: serverTimestamp() });
  return batch.commit();
}

export async function listCampusReplies(
  schoolId: string,
  postId: string,
): Promise<CampusReply[]> {
  const db = getDb();
  const replies = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  try {
    const snap = await getDocs(query(replies, orderBy('createdAt', 'asc'), limit(120)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusReply, 'id'>) }));
  } catch {
    const snap = await getDocs(query(replies, limit(120)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusReply, 'id'>) }));
  }
}

export async function softDeleteCampusReply(schoolId: string, postId: string, replyId: string) {
  const db = getDb();
  const replyRef = doc(db, 'schools', schoolId, 'campusPosts', postId, 'replies', replyId);
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const batch = writeBatch(db);
  batch.update(replyRef, {
    deleted: true,
    content: '（此留言已被作者刪除）',
    updatedAt: serverTimestamp(),
  });
  batch.update(postRef, { commentCount: increment(-1), updatedAt: serverTimestamp() });
  await batch.commit();
}

export type ThreadedReply = CampusReply & { threadDepth: number };

/** 重建討論串（同 mobile/utils/campusReplyThread.flattenCampusRepliesThread） */
export function flattenCampusRepliesThread(rows: CampusReply[]): ThreadedReply[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const childrenMap = new Map<string | null, CampusReply[]>();
  for (const r of rows) {
    const k = r.parentReplyId ?? null;
    const arr = childrenMap.get(k) ?? [];
    arr.push(r);
    childrenMap.set(k, arr);
  }
  for (const arr of childrenMap.values()) {
    arr.sort((a, b) => (tsToMillis(a.createdAt) ?? 0) - (tsToMillis(b.createdAt) ?? 0));
  }
  const out: ThreadedReply[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const kids = childrenMap.get(parentId) ?? [];
    for (const k of kids) {
      out.push({ ...k, threadDepth: depth });
      visit(k.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Boards
// ═══════════════════════════════════════════════════════════════
export type CampusBoardType = 'department' | 'course' | 'topic' | 'anon';

export type CampusBoard = {
  id: string;
  name: string;
  slug?: string;
  type?: CampusBoardType;
  defaultAnonymous?: boolean;
  mods?: string[];
  rules?: string;
  coverImage?: string | null;
  subscriberCount?: number;
  schoolId?: string;
  order?: number;
  createdBy?: string;
  createdAt?: unknown;
};

export const CAMPUS_BOARD_TYPE_LABEL: Record<CampusBoardType, string> = {
  department: '系所',
  course: '課程',
  topic: '主題',
  anon: '匿名',
};

function boardCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'boards');
}

export async function listBoards(schoolId: string, max = 80): Promise<CampusBoard[]> {
  const db = getDb();
  const snap = await getDocs(query(boardCol(db, schoolId), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CampusBoard);
}

export async function getBoardById(
  schoolId: string,
  boardId: string,
): Promise<CampusBoard | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, 'schools', schoolId, 'boards', boardId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as object) } as CampusBoard;
}

const boardSubId = (uid: string, boardId: string) => `${uid}_${boardId}`;

export async function subscribeToBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  await setDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubId(uid, boardId)), {
    userId: uid,
    schoolId,
    boardId,
    subscribedAt: serverTimestamp(),
  });
}

export async function unsubscribeFromBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubId(uid, boardId)));
}

export async function listSubscribedBoardIds(uid: string, schoolId: string): Promise<string[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'schools', schoolId, 'boardSubs'),
        where('userId', '==', uid),
        limit(100),
      ),
    );
    return snap.docs
      .map((d) => (d.data() as { boardId?: string }).boardId)
      .filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

export async function createBoard(input: {
  schoolId: string;
  name: string;
  type: CampusBoardType;
  slug?: string;
  rules?: string;
  defaultAnonymous?: boolean;
  coverImage?: string | null;
  createdBy: string;
}): Promise<string> {
  const db = getDb();
  const col = boardCol(db, input.schoolId);
  const slug = (input.slug ?? input.name)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32);
  const ref = await addDoc(col, {
    name: input.name.trim(),
    slug,
    type: input.type,
    rules: input.rules ?? '',
    defaultAnonymous: input.defaultAnonymous ?? input.type === 'anon',
    coverImage: input.coverImage ?? null,
    subscriberCount: 0,
    mods: [input.createdBy],
    createdBy: input.createdBy,
    schoolId: input.schoolId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function groupBoardsByType(
  boards: CampusBoard[],
): Record<CampusBoardType, CampusBoard[]> {
  const buckets: Record<CampusBoardType, CampusBoard[]> = {
    department: [],
    course: [],
    topic: [],
    anon: [],
  };
  for (const b of boards) {
    const t = (b.type ?? 'topic') as CampusBoardType;
    buckets[t]?.push(b);
  }
  for (const k of Object.keys(buckets) as CampusBoardType[]) {
    buckets[k].sort(
      (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name),
    );
  }
  return buckets;
}

// ═══════════════════════════════════════════════════════════════
// Stories
// ═══════════════════════════════════════════════════════════════
export type StoryKind = 'image' | 'video' | 'text';

export type CampusStoryDoc = {
  id: string;
  schoolId: string;
  authorUid: string;
  kind: StoryKind;
  text?: string;
  mediaUrl?: string | null;
  bgColor?: string;
  poiId?: string | null;
  poiName?: string | null;
  createdAt?: unknown;
  expiresAt?: number;
  viewCount?: number;
};

function storiesCol(db: Firestore) {
  return collection(db, 'campusStories');
}

export async function publishStory(payload: {
  schoolId: string;
  authorUid: string;
  kind: StoryKind;
  text?: string;
  mediaUrl?: string | null;
  bgColor?: string;
  poiId?: string | null;
  poiName?: string | null;
  expiresAtMs: number;
}): Promise<string> {
  const db = getDb();
  const ref = await addDoc(storiesCol(db), {
    schoolId: payload.schoolId,
    authorUid: payload.authorUid,
    kind: payload.kind,
    text: payload.text ?? '',
    mediaUrl: payload.mediaUrl ?? null,
    bgColor: payload.bgColor ?? '#0f172a',
    poiId: payload.poiId ?? null,
    poiName: payload.poiName ?? null,
    createdAt: serverTimestamp(),
    expiresAt: payload.expiresAtMs,
    viewCount: 0,
  });
  return ref.id;
}

export async function listActiveStoriesForSchool(
  schoolId: string,
  lim = 80,
): Promise<CampusStoryDoc[]> {
  const db = getDb();
  const now = Date.now();
  try {
    const snap = await getDocs(
      query(
        storiesCol(db),
        where('schoolId', '==', schoolId),
        orderBy('createdAt', 'desc'),
        limit(lim),
      ),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CampusStoryDoc, 'id'>) }))
      .filter((s) => (typeof s.expiresAt === 'number' ? s.expiresAt > now : true));
  } catch {
    try {
      const snap = await getDocs(
        query(storiesCol(db), where('schoolId', '==', schoolId), limit(lim)),
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CampusStoryDoc, 'id'>) }))
        .filter((s) => (typeof s.expiresAt === 'number' ? s.expiresAt > now : true));
    } catch {
      return [];
    }
  }
}

export async function markStoryViewed(storyId: string, viewerUid: string) {
  const db = getDb();
  const viewRef = doc(db, 'campusStories', storyId, 'storyViews', viewerUid);
  const exists = await getDoc(viewRef);
  if (exists.exists()) return;
  await setDoc(viewRef, { viewerUid, viewedAt: serverTimestamp() });
  try {
    await updateDoc(doc(db, 'campusStories', storyId), { viewCount: increment(1) });
  } catch {
    /* ignore */
  }
}

export type StoryAuthorGroup = {
  authorUid: string;
  stories: CampusStoryDoc[];
  latestAt: number;
  isMine?: boolean;
};

export function groupStoriesByAuthor(
  stories: CampusStoryDoc[],
  viewerUid?: string,
): StoryAuthorGroup[] {
  const map = new Map<string, StoryAuthorGroup>();
  for (const s of stories) {
    const t = tsToMillis(s.createdAt);
    const prev = map.get(s.authorUid);
    if (prev) {
      prev.stories.push(s);
      if (t && t > prev.latestAt) prev.latestAt = t;
    } else {
      map.set(s.authorUid, {
        authorUid: s.authorUid,
        stories: [s],
        latestAt: t ?? 0,
        isMine: viewerUid != null && viewerUid === s.authorUid,
      });
    }
  }
  for (const grp of map.values()) {
    grp.stories.sort(
      (a, b) => (tsToMillis(a.createdAt) ?? 0) - (tsToMillis(b.createdAt) ?? 0),
    );
  }
  return [...map.values()].sort((a, b) => {
    if (a.isMine && !b.isMine) return -1;
    if (!a.isMine && b.isMine) return 1;
    return b.latestAt - a.latestAt;
  });
}

// ═══════════════════════════════════════════════════════════════
// Alias / Member Directory / Checkins / Report
// ═══════════════════════════════════════════════════════════════
const ANIMALS = [
  '河馬', '企鵝', '貓頭鷹', '水豚', '狐狸', '兔子', '刺蝟', '浣熊', '柴犬', '鸚鵡',
  '海豚', '無尾熊', '熊貓', '紅鶴', '海龜', '倉鼠', '松鼠', '蜜蜂', '蝴蝶',
];

function stableNum(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 100;
}
function pickAnimal(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) >>> 0;
  return ANIMALS[h % ANIMALS.length];
}

export async function getOrCreateBoardAlias(
  uid: string,
  schoolId: string,
  boardId: string,
): Promise<string> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'campusBoardAliases', boardId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data() as { alias?: string };
    if (d?.alias) return d.alias;
  }
  const seed = `${uid}|${schoolId}|${boardId}`;
  const alias = `匿名${pickAnimal(seed)} #${stableNum(seed)}`;
  await setDoc(
    ref,
    {
      alias,
      animal: pickAnimal(seed),
      num: stableNum(seed),
      boardId,
      schoolId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return alias;
}

export type SchoolDirectoryProfile = {
  uid: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
};

export async function fetchSchoolDirectoryProfiles(
  schoolId: string,
  uids: string[],
): Promise<SchoolDirectoryProfile[]> {
  const db = getDb();
  const unique = [...new Set(uids.filter((u): u is string => !!u))];
  if (!schoolId || unique.length === 0) return [];
  const rows = await Promise.all(
    unique.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'schools', schoolId, 'directory', uid));
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        return {
          uid,
          displayName:
            typeof data.displayName === 'string' ? data.displayName : uid.slice(0, 8),
          avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
          department: typeof data.department === 'string' ? data.department : null,
        };
      } catch {
        return { uid, displayName: uid.slice(0, 8), avatarUrl: null, department: null };
      }
    }),
  );
  return rows;
}

export async function heartbeatCheckIn(
  uid: string,
  schoolId: string,
  poiId: string,
  ttlMs = 15 * 60 * 1000,
) {
  const db = getDb();
  const sessionId = `${uid}_${poiId}_${Date.now().toString(36)}`;
  await setDoc(doc(db, 'schools', schoolId, 'lbsPresence', sessionId), {
    uid,
    schoolId,
    poiId,
    startedAt: serverTimestamp(),
    expiresAt: Date.now() + ttlMs,
  });
  return sessionId;
}

export async function clearPresence(schoolId: string, sessionId: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'schools', schoolId, 'lbsPresence', sessionId));
}

export async function peersAtPoi(schoolId: string, poiId: string): Promise<{ uid: string }[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'schools', schoolId, 'lbsPresence'),
        where('poiId', '==', poiId),
        limit(80),
      ),
    );
    const seen = new Set<string>();
    const now = Date.now();
    for (const d of snap.docs) {
      const x = d.data() as { uid?: string; expiresAt?: number };
      if (x.uid && (!x.expiresAt || x.expiresAt > now)) seen.add(x.uid);
    }
    return [...seen].map((uid) => ({ uid }));
  } catch {
    return [];
  }
}

export async function submitCampusReport(payload: {
  schoolId: string;
  reporterUid: string;
  targetType: 'post' | 'reply' | 'user' | 'message' | 'story';
  targetId: string;
  reason: string;
  detail?: string;
}) {
  const db = getDb();
  return addDoc(collection(db, 'campusReports'), {
    ...payload,
    createdAt: serverTimestamp(),
    status: 'open',
  });
}

// ═══════════════════════════════════════════════════════════════
// Course Reviews
// ═══════════════════════════════════════════════════════════════
export type CourseReviewSentiment = 'positive' | 'neutral' | 'negative';
export type CourseReviewDoc = {
  id: string;
  courseCode: string;
  courseName: string;
  rating: number;
  difficulty: number;
  workload: number;
  usefulness: number;
  comment: string;
  sentiment: CourseReviewSentiment;
  sentimentScore: number;
  tags: string[];
  authorUid?: string | null;
  anonymous: boolean;
  aliasSnapshot?: string | null;
  helpful?: number;
  helpfulBy?: string[];
  createdAt?: unknown;
};

function reviewsCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'courseReviews');
}

export function analyzeReviewSentiment(comment: string) {
  const text = comment.toLowerCase();
  const positives = ['推', '讚', '不錯', '好', '收穫', '實用', '清楚', '有趣', 'good'];
  const negatives = ['雷', '爛', '糟', '無聊', '不推', '混', '太難', '當掉', 'bad'];
  let score = 0;
  for (const k of positives) if (text.includes(k)) score += 1;
  for (const k of negatives) if (text.includes(k)) score -= 1;
  if (score > 0)
    return { sentiment: 'positive' as const, score: Math.min(1, score / 3) };
  if (score < 0)
    return { sentiment: 'negative' as const, score: Math.max(-1, score / 3) };
  return { sentiment: 'neutral' as const, score: 0 };
}

export async function submitCourseReview(input: {
  schoolId: string;
  courseCode: string;
  courseName: string;
  rating: number;
  difficulty: number;
  workload: number;
  usefulness: number;
  comment: string;
  tags?: string[];
  anonymous?: boolean;
  authorUid?: string | null;
  aliasSnapshot?: string;
}): Promise<string> {
  const db = getDb();
  const ref = reviewsCol(db, input.schoolId);
  const { sentiment, score } = analyzeReviewSentiment(input.comment);
  const docRef = await addDoc(ref, {
    courseCode: input.courseCode,
    courseName: input.courseName,
    rating: clamp(input.rating, 0, 5),
    difficulty: clamp(input.difficulty, 0, 5),
    workload: clamp(input.workload, 0, 5),
    usefulness: clamp(input.usefulness, 0, 5),
    comment: input.comment.trim(),
    sentiment,
    sentimentScore: score,
    tags: dedupe((input.tags ?? []).map((t) => t.trim()).filter(Boolean)).slice(0, 6),
    anonymous: input.anonymous ?? true,
    authorUid: input.anonymous ? null : (input.authorUid ?? null),
    aliasSnapshot: input.anonymous ? (input.aliasSnapshot ?? '匿名同學') : null,
    helpful: 0,
    helpfulBy: [],
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function listCourseReviews(
  schoolId: string,
  opts?: { courseCode?: string; courseName?: string; lim?: number },
): Promise<CourseReviewDoc[]> {
  const db = getDb();
  const max = opts?.lim ?? 80;
  try {
    const filters: any[] = [];
    if (opts?.courseCode) filters.push(where('courseCode', '==', opts.courseCode));
    if (opts?.courseName && !opts.courseCode)
      filters.push(where('courseName', '==', opts.courseName));
    const snap = await getDocs(
      query(reviewsCol(db, schoolId), ...filters, orderBy('createdAt', 'desc'), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseReviewDoc, 'id'>) }));
  } catch {
    const snap = await getDocs(query(reviewsCol(db, schoolId), limit(Math.min(max, 50))));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseReviewDoc, 'id'>) }));
  }
}

export type CourseReviewAggregate = {
  totalCount: number;
  avgRating: number;
  avgDifficulty: number;
  avgWorkload: number;
  avgUsefulness: number;
  sentiment: { positive: number; neutral: number; negative: number };
  topTags: { tag: string; count: number }[];
};

export function aggregateReviews(rows: CourseReviewDoc[]): CourseReviewAggregate {
  if (rows.length === 0) {
    return {
      totalCount: 0,
      avgRating: 0,
      avgDifficulty: 0,
      avgWorkload: 0,
      avgUsefulness: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      topTags: [],
    };
  }
  const sum = rows.reduce(
    (acc, r) => {
      acc.rating += r.rating;
      acc.difficulty += r.difficulty;
      acc.workload += r.workload;
      acc.usefulness += r.usefulness;
      acc.sentiment[r.sentiment] = (acc.sentiment[r.sentiment] ?? 0) + 1;
      for (const t of r.tags ?? []) acc.tagCounts.set(t, (acc.tagCounts.get(t) ?? 0) + 1);
      return acc;
    },
    {
      rating: 0,
      difficulty: 0,
      workload: 0,
      usefulness: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 } as Record<
        CourseReviewSentiment,
        number
      >,
      tagCounts: new Map<string, number>(),
    },
  );
  const n = rows.length;
  return {
    totalCount: n,
    avgRating: round1(sum.rating / n),
    avgDifficulty: round1(sum.difficulty / n),
    avgWorkload: round1(sum.workload / n),
    avgUsefulness: round1(sum.usefulness / n),
    sentiment: sum.sentiment,
    topTags: [...sum.tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

export async function toggleReviewHelpful(schoolId: string, reviewId: string, uid: string) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'courseReviews', reviewId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('評價不存在');
    const data = snap.data() as Record<string, unknown>;
    const arr = Array.isArray(data.helpfulBy) ? (data.helpfulBy as string[]) : [];
    if (arr.includes(uid)) {
      tx.update(ref, { helpfulBy: arrayRemove(uid), helpful: increment(-1) });
    } else {
      tx.update(ref, { helpfulBy: arrayUnion(uid), helpful: increment(1) });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// helpers
// ═══════════════════════════════════════════════════════════════
function tsToMillis(t: unknown): number | undefined {
  if (t != null && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  return undefined;
}
function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
