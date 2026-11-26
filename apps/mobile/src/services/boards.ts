/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';

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
  /** 排序（小=置頂） */
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

export function boardCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'boards');
}

export async function listBoards(schoolId: string, max = 40): Promise<CampusBoard[]> {
  const db = getDb();
  const snap = await getDocs(query(boardCol(db, schoolId), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CampusBoard);
}

export async function getBoardById(schoolId: string, boardId: string): Promise<CampusBoard | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, 'schools', schoolId, 'boards', boardId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as object) } as CampusBoard;
}

export function boardSubscriptionId(uid: string, boardId: string) {
  return `${uid}_${boardId}`;
}

// A pending delete can remove a document from a query before Firestore
// acknowledges it, leaving no document metadata to inspect.
const subscriptionConfirmationStates = new Map<string, {
  pendingDeletes: number;
  activeReads: number;
  deleteRevision: number;
}>();

function getSubscriptionConfirmationState(path: string) {
  const state = subscriptionConfirmationStates.get(path) ?? {
    pendingDeletes: 0,
    activeReads: 0,
    deleteRevision: 0,
  };
  subscriptionConfirmationStates.set(path, state);
  return state;
}

function clearIdleSubscriptionConfirmationState(path: string) {
  const state = subscriptionConfirmationStates.get(path);
  if (state && state.pendingDeletes === 0 && state.activeReads === 0) {
    subscriptionConfirmationStates.delete(path);
  }
}

export async function subscribeToBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  await setDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId)), {
    userId: uid,
    schoolId,
    boardId,
    subscribedAt: serverTimestamp(),
  });
}

export async function unsubscribeFromBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  const subscription = doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId));
  const path = subscription.path;
  const state = getSubscriptionConfirmationState(path);
  state.pendingDeletes += 1;
  state.deleteRevision += 1;
  try {
    await deleteDoc(subscription);
  } finally {
    state.pendingDeletes -= 1;
    clearIdleSubscriptionConfirmationState(path);
  }
}

export async function isSubscribedToBoard(
  uid: string,
  schoolId: string,
  boardId: string,
  options: { fromServer?: boolean } = {},
): Promise<boolean> {
  const db = getDb();
  const subscriptionQuery = query(
    collection(db, 'schools', schoolId, 'boardSubs'),
    where('userId', '==', uid),
    where('boardId', '==', boardId),
    limit(1),
  );
  if (!options.fromServer) return !(await getDocs(subscriptionQuery)).empty;

  const path = doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId)).path;
  const state = getSubscriptionConfirmationState(path);
  const { pendingDeletes, deleteRevision } = state;
  state.activeReads += 1;
  // Failed-write reconciliation must hit the server. A cache miss would look
  // like "not subscribed" and overwrite the rollback after a failed unsubscribe.
  try {
    const snap = await getDocsFromServer(subscriptionQuery);
    const overlapsDelete = pendingDeletes > 0 || state.deleteRevision !== deleteRevision;
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites || (snap.empty && overlapsDelete)) {
      throw new Error('伺服器尚未確認此看板的訂閱狀態');
    }
    return !snap.empty;
  } finally {
    state.activeReads -= 1;
    clearIdleSubscriptionConfirmationState(path);
  }
}

/** 保留快照來源，供看板畫面調解訂閱寫入與清單刷新。 */
export async function readSubscribedBoardIds(uid: string, schoolId: string) {
  return querySubscribedBoardIds(getDb(), uid, schoolId);
}

async function querySubscribedBoardIds(db: Firestore, uid: string, schoolId: string) {
  const snap = await getDocs(
    query(
      collection(db, 'schools', schoolId, 'boardSubs'),
      where('userId', '==', uid),
      limit(100),
    ),
  );
  const ids: string[] = [];
  const serverConfirmedIds: string[] = [];
  for (const subscription of snap.docs) {
    const { boardId } = subscription.data() as { boardId?: string };
    if (!boardId) continue;
    ids.push(boardId);
    // A server snapshot can include local writes to other documents.
    if (!snap.metadata.fromCache && !subscription.metadata.hasPendingWrites) {
      serverConfirmedIds.push(boardId);
    }
  }
  return { ids, serverConfirmedIds };
}

/** 取得使用者所有訂閱看板 ID（用於 Feed 的「我訂閱」過濾） */
export async function listSubscribedBoardIds(
  uid: string,
  schoolId: string,
  options: { throwOnError?: boolean } = {},
): Promise<string[]> {
  const db = getDb();
  try {
    return (await querySubscribedBoardIds(db, uid, schoolId)).ids;
  } catch (error) {
    if (options.throwOnError) throw error;
    return [];
  }
}

/** 建立看板（建議由 admin / mod 才能呼叫；rules 應檢查 createdBy 與 mods 對應 role） */
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

/** 編輯看板基本欄位（rules / cover / defaultAnonymous） */
export async function updateBoard(
  schoolId: string,
  boardId: string,
  patch: Partial<Pick<CampusBoard, 'name' | 'rules' | 'coverImage' | 'defaultAnonymous' | 'type'>>,
): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, 'schools', schoolId, 'boards', boardId), patch);
}

/** 依類型分群；用於 BoardsScreen 的分區顯示 */
export function groupBoardsByType(boards: CampusBoard[]): Record<CampusBoardType, CampusBoard[]> {
  const buckets: Record<CampusBoardType, CampusBoard[]> = {
    department: [],
    course: [],
    topic: [],
    anon: [],
  };
  for (const b of boards) {
    const t = (b.type ?? 'topic') as CampusBoardType;
    if (!buckets[t]) continue;
    buckets[t].push(b);
  }
  for (const k of Object.keys(buckets) as CampusBoardType[]) {
    buckets[k].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  }
  return buckets;
}
