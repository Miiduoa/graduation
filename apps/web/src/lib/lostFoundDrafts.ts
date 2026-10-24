import {
  todayTaipeiCalendarDate,
  type LostFoundWriteFields,
} from './lostFound';

const DRAFT_PREFIX = 'campus-one:lost-found-draft:v1:';
const PENDING_PREFIX = 'campus-one:lost-found-pending:v1:';
const CREATE_IDS_PREFIX = 'campus-one:lost-found-create-ids:v1:';

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
  expectedUpdatedAt?: string | null;
};

export type LostFoundPendingAction = 'create' | 'edit' | 'resolve';

export type LostFoundPendingIntent = {
  version: 1;
  action: LostFoundPendingAction;
  documentId: string;
  expectedUpdatedAt?: string | null;
  fields?: LostFoundWriteFields;
};

export type RecoverableCreateSession = {
  documentId: string;
  pending: LostFoundPendingIntent | null;
  draft: LostFoundFormDraft | null;
  fields: LostFoundWriteFields;
  /**
   * Unreadable pending/draft bytes remain under this scoped document id.
   * Never treat as absent — callers must block new mutation until reconciled.
   */
  corrupt?: boolean;
  corruptionMessage?: string;
};

function assertBrowserStorage(): Storage {
  try {
    const storage = window.localStorage;
    const probe = `${DRAFT_PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    throw new LostFoundStorageError();
  }
}

export function lostFoundDraftStorageKey(scope: LostFoundDraftScope) {
  const { uid, schoolId, mode, itemKey } = scope;
  if (!uid || !schoolId || !itemKey || (mode !== 'create' && mode !== 'edit')) {
    throw new LostFoundStorageError('草稿範圍不正確。');
  }
  return `${DRAFT_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}:${mode}:${encodeURIComponent(itemKey)}`;
}

export function lostFoundPendingStorageKey(scope: LostFoundDraftScope) {
  const { uid, schoolId, mode, itemKey } = scope;
  if (!uid || !schoolId || !itemKey || (mode !== 'create' && mode !== 'edit')) {
    throw new LostFoundStorageError('待確認操作範圍不正確。');
  }
  return `${PENDING_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}:${mode}:${encodeURIComponent(itemKey)}`;
}

function createIdsStorageKey(uid: string, schoolId: string) {
  if (!uid || !schoolId) throw new LostFoundStorageError('草稿範圍不正確。');
  return `${CREATE_IDS_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}`;
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

function parseDraft(raw: string, scope: LostFoundDraftScope): LostFoundFormDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LostFoundStorageError('草稿資料已損毀，畫面內容仍保留；請手動確認後再送出。');
  }
  const row = parsed as LostFoundFormDraft & { uid?: string; schoolId?: string };
  if (
    !row ||
    row.version !== 1 ||
    typeof row.documentId !== 'string' ||
    !row.documentId ||
    !isWriteFields(row) ||
    (row.expectedUpdatedAt !== undefined &&
      row.expectedUpdatedAt !== null &&
      typeof row.expectedUpdatedAt !== 'string')
  ) {
    throw new LostFoundStorageError('草稿資料已損毀，畫面內容仍保留；請手動確認後再送出。');
  }
  if (row.uid && row.uid !== scope.uid) {
    throw new LostFoundStorageError('草稿不屬於目前帳號。');
  }
  if (row.schoolId && row.schoolId !== scope.schoolId) {
    throw new LostFoundStorageError('草稿不屬於目前校園。');
  }
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
    expectedUpdatedAt: row.expectedUpdatedAt,
  };
}

function parsePending(raw: string): LostFoundPendingIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LostFoundStorageError('待確認操作資料已損毀；請先重新讀取物品狀態。');
  }
  const row = parsed as LostFoundPendingIntent;
  if (
    !row ||
    row.version !== 1 ||
    !['create', 'edit', 'resolve'].includes(row.action) ||
    typeof row.documentId !== 'string' ||
    !row.documentId ||
    (row.fields !== undefined && !isWriteFields(row.fields)) ||
    (row.expectedUpdatedAt !== undefined &&
      row.expectedUpdatedAt !== null &&
      typeof row.expectedUpdatedAt !== 'string')
  ) {
    throw new LostFoundStorageError('待確認操作資料已損毀；請先重新讀取物品狀態。');
  }
  return {
    version: 1,
    action: row.action,
    documentId: row.documentId,
    expectedUpdatedAt: row.expectedUpdatedAt,
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

function fieldsFromSource(source: LostFoundWriteFields): LostFoundWriteFields {
  return {
    type: source.type,
    title: source.title,
    description: source.description,
    category: source.category,
    location: source.location,
    date: source.date,
    contactInfo: source.contactInfo ?? '',
  };
}

export function saveLostFoundDraft(scope: LostFoundDraftScope, draft: LostFoundFormDraft): void {
  const storage = assertBrowserStorage();
  const key = lostFoundDraftStorageKey(scope);
  const record = {
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
    expectedUpdatedAt: draft.expectedUpdatedAt,
  };
  try {
    const encoded = JSON.stringify(record);
    storage.setItem(key, encoded);
    const verify = storage.getItem(key);
    if (
      verify === null ||
      JSON.stringify(parseDraft(verify, scope)) !== JSON.stringify(parseDraft(encoded, scope))
    ) {
      throw new LostFoundStorageError();
    }
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export function loadLostFoundDraft(scope: LostFoundDraftScope): LostFoundFormDraft | null {
  try {
    const storage = assertBrowserStorage();
    const raw = storage.getItem(lostFoundDraftStorageKey(scope));
    return raw === null ? null : parseDraft(raw, scope);
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export function clearLostFoundDraft(scope: LostFoundDraftScope): void {
  try {
    assertBrowserStorage().removeItem(lostFoundDraftStorageKey(scope));
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

/** Persist pending intent before a network write; never replace a different unresolved intent. */
export function saveLostFoundPending(
  scope: LostFoundDraftScope,
  intent: LostFoundPendingIntent,
): void {
  const storage = assertBrowserStorage();
  const key = lostFoundPendingStorageKey(scope);
  const record: LostFoundPendingIntent = {
    version: 1,
    action: intent.action,
    documentId: intent.documentId,
    expectedUpdatedAt: intent.expectedUpdatedAt,
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
  };
  try {
    const encoded = JSON.stringify(record);
    const frozen = parsePending(encoded);
    const existing = storage.getItem(key);
    if (
      existing !== null &&
      JSON.stringify(parsePending(existing)) !== JSON.stringify(frozen)
    ) {
      throw new LostFoundStorageError('尚有未確認的操作，請先重試原本的送出。');
    }
    if (existing === null) storage.setItem(key, encoded);
    const verify = storage.getItem(key);
    if (verify === null || JSON.stringify(parsePending(verify)) !== JSON.stringify(frozen)) {
      throw new LostFoundStorageError();
    }
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export function loadLostFoundPending(scope: LostFoundDraftScope): LostFoundPendingIntent | null {
  try {
    const storage = assertBrowserStorage();
    const raw = storage.getItem(lostFoundPendingStorageKey(scope));
    return raw === null ? null : parsePending(raw);
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

export function clearLostFoundPending(scope: LostFoundDraftScope): void {
  try {
    assertBrowserStorage().removeItem(lostFoundPendingStorageKey(scope));
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

function readTrackedCreateIds(uid: string, schoolId: string): string[] {
  try {
    const storage = assertBrowserStorage();
    const raw = storage.getItem(createIdsStorageKey(uid, schoolId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === 'string' && Boolean(value) && !value.includes('/'),
    );
  } catch {
    return [];
  }
}

/** Register a create document id in the multi-id index (does not replace siblings). */
export function rememberCreateDocumentId(uid: string, schoolId: string, documentId: string): void {
  if (!documentId?.trim() || documentId.includes('/')) {
    throw new LostFoundStorageError('刊登編號不正確。');
  }
  const storage = assertBrowserStorage();
  const key = createIdsStorageKey(uid, schoolId);
  const ids = readTrackedCreateIds(uid, schoolId);
  if (!ids.includes(documentId)) ids.push(documentId);
  storage.setItem(key, JSON.stringify(ids));
  const verify = storage.getItem(key);
  if (verify === null) throw new LostFoundStorageError();
  const verified = JSON.parse(verify) as unknown;
  if (!Array.isArray(verified) || !verified.includes(documentId)) {
    throw new LostFoundStorageError();
  }
}

/** Remove only the owned document id from the index; leave sibling unresolved ids intact. */
export function forgetCreateDocumentId(uid: string, schoolId: string, documentId: string): void {
  try {
    const storage = assertBrowserStorage();
    const key = createIdsStorageKey(uid, schoolId);
    const next = readTrackedCreateIds(uid, schoolId).filter((id) => id !== documentId);
    if (next.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(next));
  } catch (error) {
    if (error instanceof LostFoundStorageError) throw error;
    throw new LostFoundStorageError();
  }
}

function collectCreateDocumentIds(uid: string, schoolId: string): string[] {
  const storage = assertBrowserStorage();
  const ids = new Set(readTrackedCreateIds(uid, schoolId));
  const draftPrefix = `${DRAFT_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}:create:`;
  const pendingPrefix = `${PENDING_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(schoolId)}:create:`;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(draftPrefix)) {
      ids.add(decodeURIComponent(key.slice(draftPrefix.length)));
    } else if (key.startsWith(pendingPrefix)) {
      ids.add(decodeURIComponent(key.slice(pendingPrefix.length)));
    }
  }
  return [...ids].filter((id) => id && !id.includes('/'));
}

/**
 * Recover ALL scoped create drafts/pending intents for uid+school,
 * independent of any single "latest draft" pointer.
 * Corrupt / pending unresolved creates are listed first.
 * Unreadable records keep their document id and raw storage keys.
 */
export function listRecoverableCreateSessions(
  uid: string,
  schoolId: string,
): RecoverableCreateSession[] {
  const sessions: RecoverableCreateSession[] = [];
  for (const documentId of collectCreateDocumentIds(uid, schoolId)) {
    const scope: LostFoundDraftScope = { uid, schoolId, mode: 'create', itemKey: documentId };
    let pending: LostFoundPendingIntent | null = null;
    let draft: LostFoundFormDraft | null = null;
    let pendingCorrupt = false;
    let draftCorrupt = false;
    let corruptionMessage = '';

    try {
      pending = loadLostFoundPending(scope);
    } catch (error) {
      pendingCorrupt = true;
      corruptionMessage =
        error instanceof LostFoundStorageError
          ? error.message
          : '待確認操作資料已損毀；請先查詢此則刊登狀態。';
    }

    try {
      draft = loadLostFoundDraft(scope);
    } catch (error) {
      draftCorrupt = true;
      if (!corruptionMessage) {
        corruptionMessage =
          error instanceof LostFoundStorageError
            ? error.message
            : '草稿資料已損毀；請先查詢此則刊登狀態。';
      }
    }

    // Readable pending still drives recovery even if the sibling draft blob is damaged.
    if (pending && !pendingCorrupt) {
      sessions.push({
        documentId,
        pending,
        draft: draftCorrupt ? null : draft,
        fields: pending.fields
          ? fieldsFromSource(pending.fields)
          : draft && !draftCorrupt
            ? fieldsFromSource(draft)
            : emptyLostFoundFields(),
      });
      continue;
    }

    if (pendingCorrupt || draftCorrupt) {
      sessions.push({
        documentId,
        pending: null,
        draft: null,
        fields: emptyLostFoundFields(),
        corrupt: true,
        corruptionMessage:
          corruptionMessage ||
          '本機待確認或草稿資料已損毀，尚未對帳前請勿另開新刊登。',
      });
      continue;
    }

    if (!pending && !draft) continue;
    const source = pending?.fields ?? draft;
    sessions.push({
      documentId,
      pending,
      draft,
      fields: source ? fieldsFromSource(source) : emptyLostFoundFields(),
    });
  }
  return sessions.sort((a, b) => {
    const rank = (row: RecoverableCreateSession) =>
      row.corrupt ? 2 : row.pending ? 1 : 0;
    const delta = rank(b) - rank(a);
    if (delta !== 0) return delta;
    return a.documentId.localeCompare(b.documentId);
  });
}

/**
 * Explicit cleanup of damaged create local metadata for one scoped document id.
 * Call only after the user confirms adopt-server or rebuild-same-id; never auto-delete.
 */
export function clearDamagedCreateLocalMetadata(scope: LostFoundDraftScope): void {
  clearLostFoundPending(scope);
  clearLostFoundDraft(scope);
}

export function emptyLostFoundFields(): LostFoundWriteFields {
  return {
    type: 'lost',
    title: '',
    description: '',
    category: 'other',
    location: '',
    date: todayTaipeiCalendarDate(),
    contactInfo: '',
  };
}

export function fieldsEqual(a: LostFoundWriteFields, b: LostFoundWriteFields): boolean {
  return (
    a.type === b.type &&
    a.title === b.title &&
    a.description === b.description &&
    a.category === b.category &&
    a.location === b.location &&
    a.date === b.date &&
    (a.contactInfo ?? '') === (b.contactInfo ?? '')
  );
}
