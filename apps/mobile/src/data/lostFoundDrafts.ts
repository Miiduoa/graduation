import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decodeRevision,
  encodeRevision,
  type LostFoundRevision,
  type LostFoundWriteFields,
} from './lostFoundMeta';
import { taiwanCalendarDay } from './lostFoundDates';

const DRAFT_PREFIX = 'campus-one:mobile-lost-found-draft:v1:';
const PENDING_PREFIX = 'campus-one:mobile-lost-found-pending:v1:';
const CREATE_INDEX_PREFIX = 'campus-one:mobile-lost-found-create-index:v1:';

export class LostFoundStorageError extends Error {
  constructor(message = '目前無法安全保存這份草稿，已保留畫面內容；請稍後再試。') {
    super(message);
    this.name = 'LostFoundStorageError';
  }
}

export type LostFoundDraftScope = {
  uid: string;
  schoolId: string;
  mode: 'create' | 'edit';
  /** Create: stable document id. Edit: item id. */
  itemKey: string;
};

export type LostFoundFormDraft = LostFoundWriteFields & {
  version: 1;
  documentId: string;
  expectedRevision?: LostFoundRevision | null;
};

export type LostFoundPendingAction = 'create' | 'edit' | 'resolve';

export type LostFoundPendingIntent = {
  version: 1;
  action: LostFoundPendingAction;
  documentId: string;
  expectedRevision?: LostFoundRevision | null;
  fields?: LostFoundWriteFields;
};

function assertScope(scope: LostFoundDraftScope) {
  const { uid, schoolId, mode, itemKey } = scope;
  if (!uid?.trim() || !schoolId?.trim() || !itemKey?.trim() || itemKey.includes('/')) {
    throw new LostFoundStorageError('草稿範圍不正確。');
  }
  if (mode !== 'create' && mode !== 'edit') {
    throw new LostFoundStorageError('草稿範圍不正確。');
  }
}

export function lostFoundDraftStorageKey(scope: LostFoundDraftScope) {
  assertScope(scope);
  return `${DRAFT_PREFIX}${encodeURIComponent(scope.uid)}:${encodeURIComponent(scope.schoolId)}:${scope.mode}:${encodeURIComponent(scope.itemKey)}`;
}

export function lostFoundPendingStorageKey(scope: LostFoundDraftScope) {
  assertScope(scope);
  return `${PENDING_PREFIX}${encodeURIComponent(scope.uid)}:${encodeURIComponent(scope.schoolId)}:${scope.mode}:${encodeURIComponent(scope.itemKey)}`;
}

function createIndexKey(uid: string, schoolId: string) {
  if (!uid?.trim() || !schoolId?.trim()) throw new LostFoundStorageError('草稿範圍不正確。');
  return `${CREATE_INDEX_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}`;
}

export function lostFoundCreateIndexKey(uid: string, schoolId: string) {
  return createIndexKey(uid, schoolId);
}

function isWriteFields(value: unknown): value is LostFoundWriteFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.type === 'lost' || row.type === 'found') &&
    typeof row.title === 'string' &&
    typeof row.description === 'string' &&
    typeof row.category === 'string' &&
    typeof row.location === 'string' &&
    typeof row.date === 'string' &&
    (row.contactInfo === undefined || typeof row.contactInfo === 'string')
  );
}

function parseRevisionField(value: unknown): LostFoundRevision | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return decodeRevision(value);
  if (
    typeof value === 'object' &&
    value &&
    typeof (value as LostFoundRevision).seconds === 'number' &&
    typeof (value as LostFoundRevision).nanoseconds === 'number'
  ) {
    return value as LostFoundRevision;
  }
  throw new LostFoundStorageError('草稿資料已損毀，畫面內容仍保留；請手動確認後再送出。');
}

function parseDraft(raw: string, scope: LostFoundDraftScope): LostFoundFormDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LostFoundStorageError('草稿資料已損毀，畫面內容仍保留；請手動確認後再送出。');
  }
  const row = parsed as LostFoundFormDraft & {
    uid?: string;
    schoolId?: string;
    expectedRevisionEncoded?: string | null;
  };
  if (
    !row ||
    row.version !== 1 ||
    typeof row.documentId !== 'string' ||
    !row.documentId ||
    row.documentId.includes('/') ||
    !isWriteFields(row)
  ) {
    throw new LostFoundStorageError('草稿資料已損毀，畫面內容仍保留；請手動確認後再送出。');
  }
  if (row.uid && row.uid !== scope.uid) {
    throw new LostFoundStorageError('草稿不屬於目前帳號。');
  }
  if (row.schoolId && row.schoolId !== scope.schoolId) {
    throw new LostFoundStorageError('草稿不屬於目前校園。');
  }
  const expectedRevision =
    row.expectedRevision !== undefined
      ? parseRevisionField(row.expectedRevision)
      : parseRevisionField(row.expectedRevisionEncoded);
  return {
    version: 1,
    documentId: row.documentId,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    date: row.date,
    contactInfo: row.contactInfo,
    expectedRevision,
  };
}

function parsePending(raw: string): LostFoundPendingIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LostFoundStorageError('待確認操作資料已損毀；請先重新讀取物品狀態。');
  }
  const row = parsed as LostFoundPendingIntent & { expectedRevisionEncoded?: string | null };
  if (
    !row ||
    row.version !== 1 ||
    !['create', 'edit', 'resolve'].includes(row.action) ||
    typeof row.documentId !== 'string' ||
    !row.documentId ||
    row.documentId.includes('/') ||
    (row.fields !== undefined && !isWriteFields(row.fields))
  ) {
    throw new LostFoundStorageError('待確認操作資料已損毀；請先重新讀取物品狀態。');
  }
  const expectedRevision =
    row.expectedRevision !== undefined
      ? parseRevisionField(row.expectedRevision)
      : parseRevisionField(row.expectedRevisionEncoded);
  return {
    version: 1,
    action: row.action,
    documentId: row.documentId,
    expectedRevision,
    fields: row.fields
      ? {
          type: row.fields.type,
          title: row.fields.title,
          description: row.fields.description,
          category: row.fields.category,
          location: row.fields.location,
          date: row.fields.date,
          contactInfo: row.fields.contactInfo,
        }
      : undefined,
  };
}

function serializeDraft(scope: LostFoundDraftScope, draft: LostFoundFormDraft) {
  return JSON.stringify({
    version: 1 as const,
    uid: scope.uid,
    schoolId: scope.schoolId,
    documentId: draft.documentId,
    type: draft.type,
    title: draft.title,
    description: draft.description,
    category: draft.category,
    location: draft.location,
    date: draft.date,
    contactInfo: draft.contactInfo,
    expectedRevision: draft.expectedRevision ?? null,
    expectedRevisionEncoded: encodeRevision(draft.expectedRevision ?? null),
  });
}

function serializePending(intent: LostFoundPendingIntent) {
  return JSON.stringify({
    version: 1 as const,
    action: intent.action,
    documentId: intent.documentId,
    expectedRevision: intent.expectedRevision ?? null,
    expectedRevisionEncoded: encodeRevision(intent.expectedRevision ?? null),
    fields: intent.fields
      ? {
          type: intent.fields.type,
          title: intent.fields.title,
          description: intent.fields.description,
          category: intent.fields.category,
          location: intent.fields.location,
          date: intent.fields.date,
          contactInfo: intent.fields.contactInfo,
        }
      : undefined,
  });
}

export async function saveLostFoundDraft(
  scope: LostFoundDraftScope,
  draft: LostFoundFormDraft,
): Promise<void> {
  const key = lostFoundDraftStorageKey(scope);
  try {
    const encoded = serializeDraft(scope, draft);
    await AsyncStorage.setItem(key, encoded);
    const verify = await AsyncStorage.getItem(key);
    if (verify === null) throw new LostFoundStorageError();
    // Accept our payload or a same-document superseding write (serialized queue / races).
    // Only fail on missing, corrupt, or different-document data.
    const parsed = parseDraft(verify, scope);
    if (parsed.documentId !== draft.documentId) throw new LostFoundStorageError();
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

type DraftQueue = {
  chain: Promise<void>;
  seq: number;
  latest: LostFoundFormDraft | null;
};

/** Per-storage-key serialization so concurrent keystroke saves cannot false-fail verify. */
const draftQueues = new Map<string, DraftQueue>();

function draftQueueFor(key: string): DraftQueue {
  let queue = draftQueues.get(key);
  if (!queue) {
    queue = { chain: Promise.resolve(), seq: 0, latest: null };
    draftQueues.set(key, queue);
  }
  return queue;
}

/** Test helper: drop in-memory draft queues between cases. */
export function resetLostFoundDraftQueues() {
  draftQueues.clear();
}

/**
 * Enqueue a draft write for this scope. Intermediate enqueues collapse to the latest
 * payload; only the newest write runs when its turn arrives. Optional isOwned gate
 * skips work after scope/unmount invalidation without rejecting the chain.
 */
export function enqueueLostFoundDraftSave(
  scope: LostFoundDraftScope,
  draft: LostFoundFormDraft,
  isOwned: () => boolean = () => true,
): Promise<void> {
  const key = lostFoundDraftStorageKey(scope);
  const queue = draftQueueFor(key);
  queue.seq += 1;
  const seq = queue.seq;
  queue.latest = draft;
  const run = queue.chain.then(async () => {
    if (!isOwned()) return;
    if (queue.seq !== seq) return;
    const payload = queue.latest;
    if (!payload) return;
    await saveLostFoundDraft(scope, payload);
  });
  queue.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Drain in-flight draft writes for a scope (awaits current chain). */
export async function drainLostFoundDraftSaves(scope: LostFoundDraftScope): Promise<void> {
  const key = lostFoundDraftStorageKey(scope);
  const queue = draftQueues.get(key);
  if (!queue) return;
  await queue.chain;
}

export async function loadLostFoundDraft(
  scope: LostFoundDraftScope,
): Promise<LostFoundFormDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(lostFoundDraftStorageKey(scope));
    return raw === null ? null : parseDraft(raw, scope);
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export async function clearLostFoundDraft(scope: LostFoundDraftScope): Promise<void> {
  try {
    await AsyncStorage.removeItem(lostFoundDraftStorageKey(scope));
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

/** Persist pending intent before a network write; never replace a different unresolved intent. */
export async function saveLostFoundPending(
  scope: LostFoundDraftScope,
  intent: LostFoundPendingIntent,
): Promise<void> {
  const key = lostFoundPendingStorageKey(scope);
  try {
    const encoded = serializePending(intent);
    const frozen = parsePending(encoded);
    const existing = await AsyncStorage.getItem(key);
    if (existing !== null && JSON.stringify(parsePending(existing)) !== JSON.stringify(frozen)) {
      throw new LostFoundStorageError('尚有未確認的操作，請先重試原本的送出。');
    }
    if (existing === null) await AsyncStorage.setItem(key, encoded);
    const verify = await AsyncStorage.getItem(key);
    if (verify === null || JSON.stringify(parsePending(verify)) !== JSON.stringify(frozen)) {
      throw new LostFoundStorageError();
    }
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export async function loadLostFoundPending(
  scope: LostFoundDraftScope,
): Promise<LostFoundPendingIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(lostFoundPendingStorageKey(scope));
    return raw === null ? null : parsePending(raw);
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export async function clearLostFoundPending(scope: LostFoundDraftScope): Promise<void> {
  try {
    await AsyncStorage.removeItem(lostFoundPendingStorageKey(scope));
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export async function rememberCreateDocumentId(
  uid: string,
  schoolId: string,
  documentId: string,
): Promise<void> {
  if (!documentId?.trim() || documentId.includes('/')) {
    throw new LostFoundStorageError('刊登編號不正確。');
  }
  try {
    await AsyncStorage.setItem(createIndexKey(uid, schoolId), documentId);
  } catch {
    throw new LostFoundStorageError();
  }
}

export async function loadCreateDocumentId(
  uid: string,
  schoolId: string,
): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(createIndexKey(uid, schoolId));
    if (!value?.trim() || value.includes('/')) return null;
    return value;
  } catch {
    throw new LostFoundStorageError();
  }
}

export async function forgetCreateDocumentId(uid: string, schoolId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(createIndexKey(uid, schoolId));
  } catch {
    throw new LostFoundStorageError();
  }
}

/**
 * Clear pending only when the stored intent still matches this document/action.
 * Never remove another intent's pointer after a scope switch.
 */
export async function clearLostFoundPendingIfMatches(
  scope: LostFoundDraftScope,
  expected: Pick<LostFoundPendingIntent, 'action' | 'documentId'>,
): Promise<void> {
  const existing = await loadLostFoundPending(scope);
  if (!existing) return;
  if (existing.action !== expected.action || existing.documentId !== expected.documentId) return;
  await clearLostFoundPending(scope);
}

/** Clear draft only when it still belongs to the owned document id. */
export async function clearLostFoundDraftIfMatches(
  scope: LostFoundDraftScope,
  documentId: string,
): Promise<void> {
  const existing = await loadLostFoundDraft(scope);
  // Require an exact match — never removeItem when missing/replaced mid-race.
  if (!existing || existing.documentId !== documentId) return;
  await clearLostFoundDraft(scope);
}

/** Drop create index only when it still points at the owned draft document. */
export async function forgetCreateDocumentIdIfMatches(
  uid: string,
  schoolId: string,
  documentId: string,
): Promise<void> {
  const current = await loadCreateDocumentId(uid, schoolId);
  if (current !== documentId) return;
  await forgetCreateDocumentId(uid, schoolId);
}

export function emptyLostFoundFields(type: 'lost' | 'found' = 'lost'): LostFoundWriteFields {
  return {
    type,
    title: '',
    description: '',
    category: 'other',
    location: '',
    date: taiwanCalendarDay(),
    contactInfo: '',
  };
}
