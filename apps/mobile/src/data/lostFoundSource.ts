import {
  addDoc,
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
import { getAuthInstance, getDb } from '../firebase';
import type { DataSource } from './source';
import type { LostFoundItem } from './types';

class LostFoundWriteUnconfirmedError extends Error {
  readonly code = 'lost-found-write-unconfirmed';
  constructor() {
    super('資料已送出，但無法讀回確認。請先返回列表重新整理，避免重複刊登。');
  }
}

function segment(value: string | undefined): string {
  if (!value?.trim() || value.includes('/')) throw new Error('失物招領資料範圍不正確。');
  return value;
}
function currentUid(): string {
  const uid = getAuthInstance().currentUser?.uid;
  if (!uid) throw new Error('請先登入後再操作。');
  return uid;
}
function sameUser(uid: string) {
  if (currentUid() !== uid) throw new Error('帳號已切換，請重新操作。');
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
    ...row,
    id: snapshot.id,
    reporterId: owner,
    schoolId,
    contactInfo: typeof row.contactInfo === 'string' ? row.contactInfo : undefined,
    reporter: typeof row.reporter?.displayName === 'string' ? row.reporter : undefined,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
    imageUrls: Array.isArray(row.imageUrls)
      ? row.imageUrls.filter((url: unknown) => typeof url === 'string')
      : undefined,
    date: dateValue(row.date),
    createdAt: dateValue(row.createdAt),
  } as LostFoundItem;
}
async function locate(id: string, schoolId: string) {
  const db = getDb();
  const canonical = await getDocFromServer(doc(db, 'schools', schoolId, 'lostFound', segment(id)));
  if (canonical.exists()) return { snapshot: canonical, canonical: true };
  return { snapshot: await getDocFromServer(doc(db, 'lostFoundItems', id)), canonical: false };
}
function editable(data: Partial<LostFoundItem>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    'type',
    'title',
    'description',
    'category',
    'location',
    'date',
    'contactInfo',
  ] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'string') throw new Error('請確認物品資料格式。');
      result[key] = data[key].trim();
    }
  }
  for (const key of ['title', 'description', 'category', 'location'] as const) {
    if (key in result && !result[key]) throw new Error('請填寫物品的必填資訊。');
  }
  if ('type' in result && !['lost', 'found'].includes(String(result.type)))
    throw new Error('請選擇遺失或拾獲。');
  if ('date' in result) result.date = dateValue(result.date);
  if ('status' in data) {
    if (data.status !== 'resolved') throw new Error('不支援這個物品狀態變更。');
    result.status = 'resolved';
    result.resolvedAt = serverTimestamp();
  }
  return result;
}

export const lostFoundSource: Pick<
  DataSource,
  | 'listLostFoundItems'
  | 'getLostFoundItem'
  | 'createLostFoundItem'
  | 'updateLostFoundItem'
  | 'resolveLostFoundItem'
> = {
  async listLostFoundItems(school, options) {
    const schoolId = segment(school);
    const db = getDb();
    const [schoolRows, legacyRows] = await Promise.all([
      getDocsFromServer(collection(db, 'schools', schoolId, 'lostFound')),
      getDocsFromServer(query(collection(db, 'lostFoundItems'), where('schoolId', '==', schoolId))),
    ]);
    const rows = new Map<string, LostFoundItem>();
    for (const [snapshot, canonical] of [
      [legacyRows, false],
      [schoolRows, true],
    ] as const) {
      for (const document of snapshot.docs) {
        const item = readItem(document, schoolId, canonical);
        if (item) rows.set(item.id, item);
      }
    }
    const sorted = [...rows.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return options?.limit ? sorted.slice(0, options.limit) : sorted;
  },
  async getLostFoundItem(id, school) {
    const schoolId = segment(school);
    const record = await locate(id, schoolId);
    return readItem(record.snapshot, schoolId, record.canonical);
  },
  async createLostFoundItem(data) {
    const uid = currentUid();
    const schoolId = segment(data.schoolId);
    if (data.reporterId !== uid) throw new Error('無法代其他帳號發布。');
    const fields = editable(data);
    for (const key of ['type', 'title', 'description', 'category', 'location', 'date']) {
      if (!fields[key]) throw new Error('請填寫物品的必填資訊。');
    }
    const reference = await addDoc(collection(getDb(), 'schools', schoolId, 'lostFound'), {
      ...fields,
      userId: uid,
      reporterId: uid,
      schoolId,
      status: 'open',
      createdAt: serverTimestamp(),
    });
    sameUser(uid);
    try {
      const item = readItem(await getDocFromServer(reference), schoolId, true);
      sameUser(uid);
      if (!item) throw new LostFoundWriteUnconfirmedError();
      return item;
    } catch {
      throw new LostFoundWriteUnconfirmedError();
    }
  },
  async updateLostFoundItem(id, data, school) {
    const uid = currentUid();
    const schoolId = segment(school);
    const located = await locate(id, schoolId);
    const fields = editable(data);
    sameUser(uid);
    await runTransaction(getDb(), async (transaction) => {
      sameUser(uid);
      const snapshot = await transaction.get(located.snapshot.ref);
      const existing = readItem(snapshot, schoolId, located.canonical);
      // Existing rules authorize userId; legacy records without it need migration, not an ownership guess.
      if (!existing || snapshot.data()?.userId !== uid || existing.reporterId !== uid)
        throw new Error('只有發布者可以更新這則資訊。');
      transaction.update(snapshot.ref, { ...fields, updatedAt: serverTimestamp() });
    });
    sameUser(uid);
    const updated = readItem(
      await getDocFromServer(located.snapshot.ref),
      schoolId,
      located.canonical,
    );
    sameUser(uid);
    if (!updated) throw new Error('無法確認更新結果，請重新整理。');
    return updated;
  },
  async resolveLostFoundItem(id, schoolId) {
    await lostFoundSource.updateLostFoundItem(id, { status: 'resolved' }, schoolId);
  },
};
