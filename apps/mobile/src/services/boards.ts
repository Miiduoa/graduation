/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  await deleteDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId)));
}

export async function isSubscribedToBoard(uid: string, schoolId: string, boardId: string): Promise<boolean> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, 'schools', schoolId, 'boardSubs'),
      where('userId', '==', uid),
      where('boardId', '==', boardId),
      limit(1),
    ),
  );
  return !snap.empty;
}

/** 取得使用者所有訂閱看板 ID（用於 Feed 的「我訂閱」過濾） */
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
    return snap.docs.map((d) => (d.data() as { boardId?: string }).boardId).filter((x): x is string => !!x);
  } catch {
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
