import {
  collection,
  deleteField,
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
import { getAuthInstance, getDb } from '../firebase';
import type { DataSource } from './source';
import type { LostFoundItem } from './types';
import { normalizeLostFoundDateInput } from './lostFoundDates';
import {
  LostFoundConflictError,
  LostFoundError,
  LostFoundScopeChangedError,
  LostFoundWriteUnconfirmedError,
  readRevision,
  revisionsEqual,
  type LostFoundViewItem,
  type LostFoundWriteFields,
  type LostFoundWriteOptions,
} from './lostFoundMeta';

function segment(value: string | undefined): string {
  if (!value?.trim() || value.includes('/')) throw new LostFoundError('失物招領資料範圍不正確。');
  return value.trim();
}

function currentUid(): string {
  const uid = getAuthInstance().currentUser?.uid;
  if (!uid) throw new LostFoundError('請先登入後再操作。');
  return uid;
}

function requireSignedIn() {
  if (!getAuthInstance().currentUser) throw permissionDeniedError();
}

function sameUser(uid: string) {
  if (getAuthInstance().currentUser?.uid !== uid) {
    throw new LostFoundScopeChangedError('帳號已切換，請重新操作。');
  }
}

async function assertScope(options: LostFoundWriteOptions | undefined, uid: string) {
  sameUser(uid);
  if (!options?.assertCurrentScope) return;
  const ok = await options.assertCurrentScope();
  if (!ok) throw new LostFoundScopeChangedError();
  sameUser(uid);
}

function optionalDateValue(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  return instantValue(value);
}

function instantValue(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new LostFoundError('物品日期資料不完整。');
    return date.toISOString();
  }
  if (value && typeof value === 'object') {
    const row = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof row.toDate === 'function') {
      const date = row.toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
    }
    const seconds = row.seconds ?? row._seconds;
    const nanoseconds = row.nanoseconds ?? row._nanoseconds ?? 0;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return new Date(seconds * 1000 + Math.floor(Number(nanoseconds) / 1e6)).toISOString();
    }
  }
  throw new LostFoundError('物品日期資料不完整。');
}

function dateFieldValue(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return normalizeLostFoundDateInput(value);
  }
  return instantValue(value);
}

function normalizeContact(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new LostFoundError('請確認聯絡方式格式。');
  const trimmed = value.trim();
  return trimmed || undefined;
}

function contactMatches(actual: string | undefined, expected: string | undefined) {
  return (actual ?? '') === (expected ?? '');
}

type NormalizedWrite = {
  patch: Record<string, unknown>;
  match: Record<string, string | undefined>;
};

function normalizeWritable(data: Partial<LostFoundWriteFields>): NormalizedWrite {
  const patch: Record<string, unknown> = {};
  const match: Record<string, string | undefined> = {};
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
      match.contactInfo = trimmed || undefined;
      // Empty contact intentionally clears the stored field.
      patch.contactInfo = trimmed ? trimmed : deleteField();
      continue;
    }
    if (!trimmed && ['title', 'description', 'category', 'location'].includes(key)) {
      throw new LostFoundError('請填寫物品的必填資訊。');
    }
    match[key] = trimmed;
    patch[key] = key === 'date' ? normalizeLostFoundDateInput(trimmed) : trimmed;
  }
  if ('type' in match && !['lost', 'found'].includes(String(match.type))) {
    throw new LostFoundError('請選擇遺失或拾獲。');
  }
  if ('date' in match && match.date) match.date = normalizeLostFoundDateInput(match.date);
  return { patch, match };
}

function requireCreateFields(match: Record<string, string | undefined>) {
  for (const key of ['type', 'title', 'description', 'category', 'location', 'date'] as const) {
    if (!match[key]) throw new LostFoundError('請填寫物品的必填資訊。');
  }
}

function matchesCreateIntent(
  item: LostFoundViewItem,
  match: Record<string, string | undefined>,
  uid: string,
  schoolId: string,
) {
  return (
    item.canonical &&
    item.userId === uid &&
    item.reporterId === uid &&
    item.schoolId === schoolId &&
    item.status === 'open' &&
    item.type === match.type &&
    item.title === match.title &&
    item.description === match.description &&
    item.category === match.category &&
    item.location === match.location &&
    item.date === match.date &&
    contactMatches(item.contactInfo, match.contactInfo)
  );
}

function matchesEditIntent(item: LostFoundViewItem, match: Record<string, string | undefined>) {
  for (const key of Object.keys(match) as (keyof LostFoundWriteFields)[]) {
    if (key === 'contactInfo') {
      if (!contactMatches(item.contactInfo, match.contactInfo)) return false;
      continue;
    }
    if ((item as Record<string, unknown>)[key] !== match[key]) return false;
  }
  return true;
}

function readItem(
  snapshot: DocumentSnapshot,
  schoolId: string,
  canonical: boolean,
): LostFoundViewItem | null {
  if (!snapshot.exists()) return null;
  const row = snapshot.data();
  if ((!canonical && row.schoolId !== schoolId) || (row.schoolId && row.schoolId !== schoolId)) {
    return null;
  }
  const userId = typeof row.userId === 'string' && row.userId ? row.userId : undefined;
  const reporterId = typeof row.reporterId === 'string' && row.reporterId ? row.reporterId : undefined;
  // Canonical docs must not carry conflicting owner metadata.
  if (canonical && userId && reporterId && userId !== reporterId) {
    throw new LostFoundError('物品發布者資料不完整。');
  }
  if (canonical && !userId) {
    throw new LostFoundError('物品發布者資料不完整。');
  }
  if (!canonical && userId && reporterId && userId !== reporterId) {
    throw new LostFoundError('物品發布者資料不完整。');
  }
  const owner = userId ?? reporterId;
  if (typeof owner !== 'string' || !owner) {
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
  const migrationReadOnly = !userId;
  return {
    id: snapshot.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    date: dateFieldValue(row.date),
    status: row.status,
    reporterId: owner,
    userId,
    createdAt: instantValue(row.createdAt),
    resolvedAt: optionalDateValue(row.resolvedAt),
    schoolId,
    contactInfo: normalizeContact(row.contactInfo),
    reporter: typeof row.reporter?.displayName === 'string' ? row.reporter : undefined,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
    imageUrls: Array.isArray(row.imageUrls)
      ? row.imageUrls.filter((url: unknown) => typeof url === 'string')
      : undefined,
    canonical,
    updatedAtRevision: readRevision(row.updatedAt),
    migrationReadOnly,
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

function isClosedStatus(status: string | undefined) {
  return status === 'resolved' || status === 'returned' || status === 'expired';
}

function isResolvedStatus(status: string | undefined) {
  return status === 'resolved' || status === 'returned';
}

/** Stable per-draft document id for create retries (never use addDoc). */
export function allocateLostFoundDocumentId(schoolId: string): string {
  const scoped = segment(schoolId);
  return doc(collection(getDb(), 'schools', scoped, 'lostFound')).id;
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
    requireSignedIn();
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
    requireSignedIn();
    const schoolId = segment(school);
    const record = await locate(id, schoolId);
    return readItem(record.snapshot, schoolId, record.canonical);
  },

  async createLostFoundItem(data, options) {
    const uid = currentUid();
    await assertScope(options, uid);
    const schoolId = segment(data.schoolId);
    if (data.reporterId !== uid) throw new LostFoundError('無法代其他帳號發布。');
    const documentId = segment(options?.documentId ?? allocateLostFoundDocumentId(schoolId));
    const { match } = normalizeWritable({
      type: data.type,
      title: data.title,
      description: data.description,
      category: data.category,
      location: data.location,
      date: data.date,
      contactInfo: data.contactInfo,
    });
    requireCreateFields(match);
    const ref = doc(getDb(), 'schools', schoolId, 'lostFound', documentId);

    let writeError: unknown;
    try {
      await runTransaction(getDb(), async (transaction) => {
        await assertScope(options, uid);
        const snapshot = await transaction.get(ref);
        await assertScope(options, uid);
        if (snapshot.exists()) {
          const existing = readItem(snapshot, schoolId, true);
          if (existing && matchesCreateIntent(existing, match, uid, schoolId)) return;
          throw new LostFoundConflictError(
            '這則刊登編號已有不同內容。請重新整理確認後，再決定是否另開一則。',
          );
        }
        const payload: Record<string, unknown> = {
          type: match.type,
          title: match.title,
          description: match.description,
          category: match.category,
          location: match.location,
          date: match.date,
          userId: uid,
          reporterId: uid,
          schoolId,
          status: 'open',
          createdAt: serverTimestamp(),
        };
        if (match.contactInfo) payload.contactInfo = match.contactInfo;
        transaction.set(ref, payload);
      });
    } catch (error) {
      writeError = error;
      if (
        error instanceof LostFoundConflictError ||
        error instanceof LostFoundScopeChangedError ||
        error instanceof LostFoundError
      ) {
        // Deterministic client/validation failures are not ambiguous receipts.
        if (!(error instanceof LostFoundWriteUnconfirmedError)) throw error;
      }
    }

    await assertScope(options, uid);
    let receipt: LostFoundViewItem | null;
    try {
      receipt = readItem(await getDocFromServer(ref), schoolId, true);
    } catch {
      throw new LostFoundWriteUnconfirmedError();
    }
    await assertScope(options, uid);
    if (receipt && matchesCreateIntent(receipt, match, uid, schoolId)) return receipt;
    if (writeError) throw new LostFoundWriteUnconfirmedError();
    throw new LostFoundWriteUnconfirmedError();
  },

  async updateLostFoundItem(id, data, school, options) {
    const uid = currentUid();
    await assertScope(options, uid);
    const schoolId = segment(school);
    const expectedRevision =
      options?.expectedRevision === undefined ? undefined : options.expectedRevision;
    const { patch, match } = normalizeWritable({
      type: data.type,
      title: data.title,
      description: data.description,
      category: data.category,
      location: data.location,
      date: data.date,
      contactInfo: data.contactInfo,
    });
    if (!Object.keys(match).length && data.status !== 'resolved') {
      throw new LostFoundError('沒有需要更新的內容。');
    }
    if (data.status != null && data.status !== 'resolved') {
      throw new LostFoundError('不支援這個物品狀態變更。');
    }
    const located = await locate(id, schoolId);
    await assertScope(options, uid);

    let writeError: unknown;
    try {
      await runTransaction(getDb(), async (transaction) => {
        await assertScope(options, uid);
        const snapshot = await transaction.get(located.snapshot.ref);
        await assertScope(options, uid);
        const existing = readItem(snapshot, schoolId, located.canonical);
        // Rules authorize userId; never infer ownership from reporterId-only legacy docs.
        if (!existing || snapshot.data()?.userId !== uid || existing.userId !== uid) {
          throw new LostFoundError('只有發布者可以更新這則資訊。', 'lost-found-forbidden');
        }
        if (data.status === 'resolved') {
          // Owner-authorized already-resolved/returned (e.g. Web resolve) is desired state.
          if (isResolvedStatus(existing.status)) return;
          if (
            expectedRevision !== undefined &&
            !revisionsEqual(existing.updatedAtRevision, expectedRevision)
          ) {
            // Stale resolve while row is still open but genuinely newer → conflict.
            throw new LostFoundConflictError('物品已由其他操作更新，請重新讀取後再結案。');
          }
          if (isClosedStatus(existing.status)) {
            throw new LostFoundError('這則刊登目前無法結案。');
          }
          transaction.update(snapshot.ref, {
            status: 'resolved',
            resolvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return;
        }
        // Closed statuses must not masquerade as editable same-state success.
        if (isClosedStatus(existing.status)) {
          throw new LostFoundError('已結案的物品無法再編輯。');
        }
        // Same-intent reconciliation after a lost commit receipt (content already matches).
        if (matchesEditIntent(existing, match)) {
          return;
        }
        if (
          expectedRevision !== undefined &&
          !revisionsEqual(existing.updatedAtRevision, expectedRevision)
        ) {
          throw new LostFoundConflictError('物品已由其他操作更新，請重新讀取後再編輯。');
        }
        transaction.update(snapshot.ref, { ...patch, updatedAt: serverTimestamp() });
      });
    } catch (error) {
      writeError = error;
      if (
        error instanceof LostFoundConflictError ||
        error instanceof LostFoundScopeChangedError ||
        (error instanceof LostFoundError && !(error instanceof LostFoundWriteUnconfirmedError))
      ) {
        throw error;
      }
      // Non-deterministic rejection after a possible commit: fall through to receipt read.
    }

    await assertScope(options, uid);
    let live: DocumentSnapshot;
    try {
      live = await getDocFromServer(located.snapshot.ref);
    } catch {
      throw new LostFoundWriteUnconfirmedError('資料可能已更新，但無法讀回確認。請重新整理。');
    }
    await assertScope(options, uid);
    const updated = readItem(live, schoolId, located.canonical);
    if (!updated || updated.userId !== uid) {
      throw new LostFoundWriteUnconfirmedError('資料可能已更新，但無法讀回確認。請重新整理。');
    }
    if (data.status === 'resolved') {
      if (isResolvedStatus(updated.status)) return updated;
      if (writeError) {
        throw new LostFoundWriteUnconfirmedError('結案可能已送出，但無法讀回確認。請重新整理。');
      }
      throw new LostFoundWriteUnconfirmedError('結案可能已送出，但無法讀回確認。請重新整理。');
    }
    if (isClosedStatus(updated.status)) {
      throw new LostFoundError('已結案的物品無法再編輯。');
    }
    if (matchesEditIntent(updated, match)) return updated;
    throw new LostFoundWriteUnconfirmedError('資料可能已更新，但無法讀回確認。請重新整理。');
  },

  async resolveLostFoundItem(id, schoolId, options) {
    await lostFoundSource.updateLostFoundItem(id, { status: 'resolved' }, schoolId, options);
  },
};
