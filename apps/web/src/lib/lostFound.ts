import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { permissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';

export type LostFoundItem = {
  id: string;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  date: string;
  status: 'open' | 'resolved' | 'expired' | 'claimed' | 'returned' | 'active';
  reporterId: string;
  createdAt: string;
  schoolId: string;
  contactInfo?: string;
  imageUrl?: string;
};

export const LOST_FOUND_CATEGORIES: { id: string; label: string }[] = [
  { id: 'electronics', label: '電子產品' },
  { id: 'cards', label: '證件／卡片' },
  { id: 'documents', label: '文件' },
  { id: 'wallet', label: '錢包' },
  { id: 'clothing', label: '衣物' },
  { id: 'accessories', label: '配件' },
  { id: 'books', label: '書籍' },
  { id: 'keys', label: '鑰匙' },
  { id: 'other', label: '其他' },
];

export const categoryLabel = (category: string) =>
  LOST_FOUND_CATEGORIES.find((row) => row.id === category)?.label ?? '未分類';

export const statusLabel = (status: LostFoundItem['status']) =>
  ({
    open: '尋找中',
    active: '尋找中',
    claimed: '待交接',
    resolved: '已結案',
    returned: '已結案',
    expired: '已過期',
  })[status];

function segment(value: string | undefined): string {
  if (!value?.trim() || value.includes('/')) throw new Error('失物招領資料範圍不正確。');
  return value;
}

function requireSignedIn() {
  if (!getAuth()?.currentUser) throw permissionDeniedError();
}

function dateValue(value: unknown): string {
  const date =
    typeof value === 'string' ? new Date(value) : (value as { toDate?: () => Date })?.toDate?.();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new Error('物品日期資料不完整。');
  return date.toISOString();
}

function readItem(
  snapshot: DocumentSnapshot,
  schoolId: string,
  canonical: boolean,
): LostFoundItem | null {
  if (!snapshot.exists()) return null;
  const row = snapshot.data();
  if ((!canonical && row.schoolId !== schoolId) || (row.schoolId && row.schoolId !== schoolId))
    return null;
  const owner = row.userId ?? row.reporterId;
  if (
    typeof owner !== 'string' ||
    !owner ||
    (row.userId && row.reporterId && row.userId !== row.reporterId)
  ) {
    throw new Error('物品發布者資料不完整。');
  }
  if (
    !['lost', 'found'].includes(row.type) ||
    !['open', 'active', 'claimed', 'resolved', 'returned', 'expired'].includes(row.status) ||
    ['title', 'description', 'category', 'location'].some(
      (field) => typeof row[field] !== 'string' || !row[field].trim(),
    )
  ) {
    throw new Error('物品資料不完整，請稍後再試。');
  }
  return {
    id: snapshot.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    date: dateValue(row.date),
    status: row.status,
    reporterId: owner,
    createdAt: dateValue(row.createdAt),
    schoolId,
    contactInfo: typeof row.contactInfo === 'string' ? row.contactInfo : undefined,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
  };
}

export async function listLostFoundItems(schoolId: string, limitCount = 100): Promise<LostFoundItem[]> {
  if (!isFirebaseConfigured()) throw new Error('失物招領服務尚未連線，請稍後再試。');
  requireSignedIn();
  const scoped = segment(schoolId);
  const db = getDb();
  const [schoolRows, legacyRows] = await Promise.all([
    getDocsFromServer(collection(db, 'schools', scoped, 'lostFound')),
    getDocsFromServer(query(collection(db, 'lostFoundItems'), where('schoolId', '==', scoped))),
  ]);
  const rows = new Map<string, LostFoundItem>();
  for (const [snapshot, canonical] of [
    [legacyRows, false],
    [schoolRows, true],
  ] as const) {
    for (const document of snapshot.docs) {
      const item = readItem(document, scoped, canonical);
      if (item) rows.set(item.id, item);
    }
  }
  return [...rows.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limitCount);
}

export async function getLostFoundItem(id: string, schoolId: string): Promise<LostFoundItem | null> {
  if (!isFirebaseConfigured()) throw new Error('失物招領服務尚未連線，請稍後再試。');
  requireSignedIn();
  const scoped = segment(schoolId);
  const itemId = segment(id);
  const db = getDb();
  const canonical = await getDocFromServer(doc(db, 'schools', scoped, 'lostFound', itemId));
  if (canonical.exists()) return readItem(canonical, scoped, true);
  return readItem(await getDocFromServer(doc(db, 'lostFoundItems', itemId)), scoped, false);
}
