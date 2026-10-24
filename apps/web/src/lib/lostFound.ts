import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
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
  /** Canonical owner field from Firestore. Absent on unmigrated reporterId-only docs. */
  userId?: string;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
  schoolId: string;
  contactInfo?: string;
  imageUrl?: string;
  /** True when the document lives under schools/{schoolId}/lostFound. */
  canonical: boolean;
};

export type LostFoundWriteFields = {
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  date: string;
  /**
   * Omitted = leave unchanged on patch.
   * Empty string = explicit clear (must be written and confirmed).
   */
  contactInfo?: string;
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

export const typeLabel = (type: LostFoundItem['type']) => (type === 'lost' ? '遺失' : '拾獲');

/** Matches actual rules: any signed-in user can read contactInfo; not school-gated. */
export const CONTACT_VISIBILITY_NOTE =
  '聯絡方式會顯示給所有已登入使用者（不限本校）；請勿填寫不必要的個資。';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Taiwan calendar day for date inputs / defaults (not UTC ISO slice). */
export function todayTaipeiCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Convert a stored timestamp or date-only string to a Taipei YYYY-MM-DD input value. */
export function toTaipeiCalendarDateInput(value: string): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Display calendar date only — never invent a clock time. */
export function formatLostFoundCalendarDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split('-');
    return `${year}/${month}/${day}`;
  }
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export class LostFoundError extends Error {
  readonly code: string;
  constructor(message: string, code = 'lost-found') {
    super(message);
    this.name = 'LostFoundError';
    this.code = code;
  }
}

export class LostFoundWriteUnconfirmedError extends LostFoundError {
  constructor(
    message = '資料已送出，但無法讀回確認。請先返回列表重新整理，再以同一則草稿重試，避免重複刊登。',
  ) {
    super(message, 'lost-found-write-unconfirmed');
    this.name = 'LostFoundWriteUnconfirmedError';
  }
}

export class LostFoundConflictError extends LostFoundError {
  constructor(message: string) {
    super(message, 'lost-found-conflict');
    this.name = 'LostFoundConflictError';
  }
}

function segment(value: string | undefined): string {
  if (!value?.trim() || value.includes('/')) throw new LostFoundError('失物招領資料範圍不正確。');
  return value.trim();
}

function requireConfigured() {
  if (!isFirebaseConfigured()) throw new LostFoundError('失物招領服務尚未連線，請稍後再試。');
}

function currentUid(): string {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) throw new LostFoundError('請先登入後再操作。');
  return uid;
}

function requireSignedIn() {
  if (!getAuth()?.currentUser) throw permissionDeniedError();
}

function sameUser(uid: string) {
  if (getAuth()?.currentUser?.uid !== uid) {
    throw new LostFoundError('帳號已切換，請重新操作。', 'lost-found-account-switched');
  }
}

function optionalDateValue(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  return dateValue(value);
}

function dateValue(value: unknown): string {
  const date =
    typeof value === 'string' ? new Date(value) : (value as { toDate?: () => Date })?.toDate?.();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new LostFoundError('物品日期資料不完整。');
  }
  return date.toISOString();
}

function normalizeContact(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new LostFoundError('請確認聯絡方式格式。');
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Build a Firestore patch/create payload.
 * `contactInfo: undefined` is omitted (no change).
 * `contactInfo: ''` (or whitespace-only) is kept as '' for an intentional clear.
 */
function normalizeWritable(data: Partial<LostFoundWriteFields>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of [
    'type',
    'title',
    'description',
    'category',
    'location',
    'date',
    'contactInfo',
  ] as const) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'string') throw new LostFoundError('請確認物品資料格式。');
    const trimmed = data[key].trim();
    if (key === 'contactInfo') {
      result.contactInfo = trimmed;
      continue;
    }
    result[key] = trimmed;
  }
  for (const key of ['title', 'description', 'category', 'location'] as const) {
    if (key in result && !result[key]) throw new LostFoundError('請填寫物品的必填資訊。');
  }
  if ('type' in result && !['lost', 'found'].includes(result.type)) {
    throw new LostFoundError('請選擇遺失或拾獲。');
  }
  if ('category' in result && !LOST_FOUND_CATEGORIES.some((row) => row.id === result.category)) {
    throw new LostFoundError('請選擇有效的物品分類。');
  }
  if ('date' in result) result.date = dateValue(result.date);
  if ('title' in result && result.title.length > 80) {
    throw new LostFoundError('標題請勿超過 80 字。');
  }
  if ('description' in result && result.description.length > 2000) {
    throw new LostFoundError('說明請勿超過 2,000 字。');
  }
  if ('location' in result && result.location.length > 120) {
    throw new LostFoundError('地點請勿超過 120 字。');
  }
  if ('contactInfo' in result && result.contactInfo.length > 200) {
    throw new LostFoundError('聯絡方式請勿超過 200 字。');
  }
  return result;
}

function requireCreateFields(fields: Record<string, string>) {
  for (const key of ['type', 'title', 'description', 'category', 'location', 'date'] as const) {
    if (!fields[key]) throw new LostFoundError('請填寫物品的必填資訊。');
  }
}

function contactMatches(actual: string | undefined, expected: string | undefined) {
  return (actual ?? '') === (expected ?? '');
}

function matchesCreateIntent(
  item: LostFoundItem,
  fields: Record<string, string>,
  uid: string,
  schoolId: string,
) {
  return (
    item.canonical &&
    item.userId === uid &&
    item.reporterId === uid &&
    item.schoolId === schoolId &&
    item.status === 'open' &&
    item.type === fields.type &&
    item.title === fields.title &&
    item.description === fields.description &&
    item.category === fields.category &&
    item.location === fields.location &&
    item.date === fields.date &&
    contactMatches(item.contactInfo, fields.contactInfo)
  );
}

function matchesEditIntent(item: LostFoundItem, fields: Record<string, string>) {
  for (const key of Object.keys(fields) as (keyof LostFoundWriteFields)[]) {
    if (key === 'contactInfo') {
      if (!contactMatches(item.contactInfo, fields.contactInfo)) return false;
      continue;
    }
    if (item[key] !== fields[key]) return false;
  }
  return true;
}

function isResolvedStatus(status: LostFoundItem['status']) {
  return status === 'resolved' || status === 'returned';
}

function readItem(
  snapshot: DocumentSnapshot,
  schoolId: string,
  canonical: boolean,
): LostFoundItem | null {
  if (!snapshot.exists()) return null;
  const row = snapshot.data();
  if ((!canonical && row.schoolId !== schoolId) || (row.schoolId && row.schoolId !== schoolId)) {
    return null;
  }
  const owner = row.userId ?? row.reporterId;
  if (
    typeof owner !== 'string' ||
    !owner ||
    (row.userId && row.reporterId && row.userId !== row.reporterId)
  ) {
    throw new LostFoundError('物品發布者資料不完整。');
  }
  if (
    !['lost', 'found'].includes(row.type) ||
    !['open', 'active', 'claimed', 'resolved', 'returned', 'expired'].includes(row.status) ||
    ['title', 'description', 'category', 'location'].some(
      (field) => typeof row[field] !== 'string' || !row[field].trim(),
    )
  ) {
    throw new LostFoundError('物品資料不完整，請稍後再試。');
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
    userId: typeof row.userId === 'string' && row.userId ? row.userId : undefined,
    createdAt: dateValue(row.createdAt),
    updatedAt: optionalDateValue(row.updatedAt),
    resolvedAt: optionalDateValue(row.resolvedAt),
    schoolId,
    contactInfo: normalizeContact(row.contactInfo),
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
    canonical,
  };
}

async function locate(id: string, schoolId: string) {
  const db = getDb();
  const itemId = segment(id);
  const scoped = segment(schoolId);
  const canonical = await getDocFromServer(doc(db, 'schools', scoped, 'lostFound', itemId));
  if (canonical.exists()) return { snapshot: canonical, canonical: true as const };
  return {
    snapshot: await getDocFromServer(doc(db, 'lostFoundItems', itemId)),
    canonical: false as const,
  };
}

/** Only documents with an authorized userId may be edited or resolved. */
export function canManageLostFoundItem(
  item: Pick<LostFoundItem, 'userId'>,
  uid: string | null | undefined,
): boolean {
  return Boolean(uid && item.userId && item.userId === uid);
}

export function isOpenLostFoundStatus(status: LostFoundItem['status']) {
  return status === 'open' || status === 'active' || status === 'claimed';
}

/**
 * Load the complete school-scoped collection (canonical + legacy).
 * Callers filter/paginate in UI; do not silently truncate here.
 */
export async function listLostFoundItems(schoolId: string): Promise<LostFoundItem[]> {
  requireConfigured();
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
  return [...rows.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function getLostFoundItem(
  id: string,
  schoolId: string,
): Promise<LostFoundItem | null> {
  requireConfigured();
  requireSignedIn();
  const scoped = segment(schoolId);
  const located = await locate(id, scoped);
  return readItem(located.snapshot, scoped, located.canonical);
}

/** Stable per-draft document id for create retries (never use addDoc). */
export function newLostFoundItemId(schoolId: string): string {
  requireConfigured();
  const scoped = segment(schoolId);
  return doc(collection(getDb(), 'schools', scoped, 'lostFound')).id;
}

export async function createLostFoundItem(
  schoolId: string,
  documentId: string,
  input: LostFoundWriteFields,
): Promise<LostFoundItem> {
  requireConfigured();
  const uid = currentUid();
  const scoped = segment(schoolId);
  const itemId = segment(documentId);
  const fields = normalizeWritable(input);
  requireCreateFields(fields);
  const ref = doc(getDb(), 'schools', scoped, 'lostFound', itemId);

  await runTransaction(getDb(), async (transaction) => {
    sameUser(uid);
    const snapshot = await transaction.get(ref);
    sameUser(uid);
    if (snapshot.exists()) {
      const existing = readItem(snapshot, scoped, true);
      if (existing && matchesCreateIntent(existing, fields, uid, scoped)) return;
      throw new LostFoundConflictError(
        '這則刊登編號已有不同內容。請重新整理確認後，再決定是否另開一則。',
      );
    }
    const payload: Record<string, unknown> = {
      type: fields.type,
      title: fields.title,
      description: fields.description,
      category: fields.category,
      location: fields.location,
      date: fields.date,
      userId: uid,
      reporterId: uid,
      schoolId: scoped,
      status: 'open',
      createdAt: serverTimestamp(),
    };
    if (fields.contactInfo) payload.contactInfo = fields.contactInfo;
    transaction.set(ref, payload);
  });

  sameUser(uid);
  let receipt: LostFoundItem | null;
  try {
    receipt = readItem(await getDocFromServer(ref), scoped, true);
  } catch {
    throw new LostFoundWriteUnconfirmedError();
  }
  sameUser(uid);
  if (!receipt || !matchesCreateIntent(receipt, fields, uid, scoped)) {
    throw new LostFoundWriteUnconfirmedError();
  }
  return receipt;
}

export async function updateLostFoundItem(
  id: string,
  schoolId: string,
  expectedUpdatedAt: string | null | undefined,
  input: Partial<LostFoundWriteFields>,
): Promise<LostFoundItem> {
  requireConfigured();
  const uid = currentUid();
  const scoped = segment(schoolId);
  const fields = normalizeWritable(input);
  if (!Object.keys(fields).length) throw new LostFoundError('沒有需要更新的內容。');
  const located = await locate(id, scoped);
  sameUser(uid);

  await runTransaction(getDb(), async (transaction) => {
    sameUser(uid);
    const snapshot = await transaction.get(located.snapshot.ref);
    sameUser(uid);
    const existing = readItem(snapshot, scoped, located.canonical);
    // Rules authorize userId only; never infer ownership from reporterId-only legacy docs.
    if (!existing || snapshot.data()?.userId !== uid || existing.userId !== uid) {
      throw new LostFoundError('只有發布者可以更新這則資訊。', 'lost-found-forbidden');
    }
    const revisionMatches = (existing.updatedAt ?? null) === (expectedUpdatedAt ?? null);
    const alreadyApplied =
      matchesEditIntent(existing, fields) && !isResolvedStatus(existing.status);
    if (!revisionMatches) {
      // Receipt may have failed after commit: same intent with advanced updatedAt is success.
      if (alreadyApplied) return;
      throw new LostFoundConflictError('物品已由其他操作更新，請重新讀取後再編輯。');
    }
    if (alreadyApplied) return;
    if (isResolvedStatus(existing.status)) {
      throw new LostFoundError('已結案的物品無法再編輯。');
    }
    transaction.update(snapshot.ref, { ...fields, updatedAt: serverTimestamp() });
  });

  sameUser(uid);
  let updated: LostFoundItem | null;
  try {
    updated = readItem(await getDocFromServer(located.snapshot.ref), scoped, located.canonical);
  } catch {
    throw new LostFoundWriteUnconfirmedError('資料可能已更新，但無法讀回確認。請重新整理。');
  }
  sameUser(uid);
  if (!updated || updated.userId !== uid || !matchesEditIntent(updated, fields)) {
    throw new LostFoundWriteUnconfirmedError('資料可能已更新，但無法讀回確認。請重新整理。');
  }
  return updated;
}

export async function resolveLostFoundItem(
  id: string,
  schoolId: string,
  expectedUpdatedAt: string | null | undefined,
): Promise<LostFoundItem> {
  requireConfigured();
  const uid = currentUid();
  const scoped = segment(schoolId);
  const located = await locate(id, scoped);
  sameUser(uid);

  await runTransaction(getDb(), async (transaction) => {
    sameUser(uid);
    const snapshot = await transaction.get(located.snapshot.ref);
    sameUser(uid);
    const existing = readItem(snapshot, scoped, located.canonical);
    if (!existing || snapshot.data()?.userId !== uid || existing.userId !== uid) {
      throw new LostFoundError('只有發布者可以結案這則資訊。', 'lost-found-forbidden');
    }
    const revisionMatches = (existing.updatedAt ?? null) === (expectedUpdatedAt ?? null);
    if (!revisionMatches) {
      // Same resolve intent already applied despite advanced timestamp.
      if (isResolvedStatus(existing.status)) return;
      throw new LostFoundConflictError('物品已由其他操作更新，請重新讀取後再結案。');
    }
    if (isResolvedStatus(existing.status)) return;
    transaction.update(snapshot.ref, {
      status: 'resolved',
      resolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  sameUser(uid);
  let receipt: LostFoundItem | null;
  try {
    receipt = readItem(await getDocFromServer(located.snapshot.ref), scoped, located.canonical);
  } catch {
    throw new LostFoundWriteUnconfirmedError('結案可能已送出，但無法讀回確認。請重新整理。');
  }
  sameUser(uid);
  if (!receipt || receipt.userId !== uid || !isResolvedStatus(receipt.status)) {
    throw new LostFoundWriteUnconfirmedError('結案可能已送出，但無法讀回確認。請重新整理。');
  }
  return receipt;
}
