'use client';

import { sha256 } from 'js-sha256';
import { createPlanProtection, type PlanProtectionEvent } from './assistantPlanProtection';
import { REVISION_DRAFT_TTL_MS, type RevisionDraftScope, type RevisionDraftSource } from './assistantPlanRevisionDraft';

export type PrecisePlanEdit = {
  index: number;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
};
export type PrecisePlanDraftContent = { selectedIndex: number; edits: PrecisePlanEdit[] };
export type PrecisePlanDraft = PrecisePlanDraftContent & {
  version: 1;
  id: string;
  scopeKey: string;
  source: RevisionDraftSource;
  savedAt: number;
};
export type PrecisePlanDraftReadResult = {
  draft: PrecisePlanDraft | null;
  status: 'empty' | 'ready' | 'expired' | 'invalid' | 'unavailable';
  message?: string;
};
export type PrecisePlanDraftSaveResult = { ok: boolean; draft: PrecisePlanDraft | null; message?: string };
export type PrecisePlanDraftClearResult = { ok: boolean; cleared: boolean; message?: string };
export type PrecisePlanDraftSourceMatch = 'exact' | 'fresh' | 'ambiguous' | 'mismatch';
export type PrecisePlanDraftSaveOptions = { expected?: PrecisePlanDraft | null; savedAt?: number };
export type PrecisePlanDraftClearMatch = { sourceKey?: string; id?: string; snapshot?: PrecisePlanDraft | null };

const PREFIX = 'campus.assistant-time-draft.v1:';
export const PRECISE_PLAN_DRAFT_TTL_MS = REVISION_DRAFT_TTL_MS;
export const PRECISE_PLAN_DRAFT_MAX_BYTES = 16 * 1024;
const MAX_EDITS = 16;
const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
const EDIT_FIELDS = ['index', 'date', 'endDate', 'startTime', 'endTime'] as const;
const DRAFT_FIELDS = ['version', 'id', 'scopeKey', 'source', 'selectedIndex', 'edits', 'savedAt'];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INVALID = '日期與時間草稿內容無法核對，請重新編輯。';
const INACTIVE = '帳號、登入狀態或校園已切換，這次草稿儲存已停止。';
const STORAGE = '瀏覽器無法存取日期與時間草稿；目前輸入仍需由此頁保留，重新載入後可能遺失。';
const READ = '瀏覽器無法讀取日期與時間草稿，請保留目前頁面並稍後再試。';
const SAVE = '日期與時間草稿尚未確認儲存，請保留目前頁面並確認瀏覽器儲存空間。';
const REMOVE = '日期與時間草稿尚未確認清除，請保留目前頁面並稍後再試。';
const CHANGED = '日期與時間草稿已有更新，這次沒有覆蓋或清除較新的內容。';

function invalid(): never { throw new Error(INVALID); }
function dataObject(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw), value: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    value[key] = descriptor.value;
  }
  return value;
}
function dataArray(raw: unknown, limit: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > limit) return invalid();
  if (Reflect.ownKeys(raw).some(key => key !== 'length' &&
    (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= raw.length))) return invalid();
  return Array.from({ length: raw.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
    return descriptor.value;
  });
}
function scopeHash(scope: RevisionDraftScope): string {
  const value = dataObject(scope, ['accountId', 'schoolId', 'context']);
  if (typeof value.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.accountId) ||
    typeof value.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.schoolId) || value.schoolId === 'personal' ||
    typeof value.context !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.context)) return invalid();
  return sha256(JSON.stringify([value.accountId, value.schoolId, value.context]));
}
function sourceValue(source: unknown): RevisionDraftSource {
  const value = dataObject(source, ['key', 'events']);
  if (typeof value.key !== 'string' || !HASH.test(value.key)) return invalid();
  return { key: value.key, events: createPlanProtection(dataArray(value.events, MAX_EDITS), []).originalEvents };
}
function timedIndex(raw: unknown, source: RevisionDraftSource): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 ||
    raw >= source.events.length || source.events[raw].allDay !== false) return invalid();
  return raw;
}
function contentValue(content: unknown, source: RevisionDraftSource): PrecisePlanDraftContent {
  const value = dataObject(content, ['selectedIndex', 'edits']);
  const selectedIndex = timedIndex(value.selectedIndex, source), seen = new Set<number>();
  const edits = dataArray(value.edits, MAX_EDITS).map(raw => {
    const row = dataObject(raw, EDIT_FIELDS), index = timedIndex(row.index, source);
    if (seen.has(index)) return invalid();
    seen.add(index);
    for (const field of ['date', 'endDate', 'startTime', 'endTime'] as const) {
      if (typeof row[field] !== 'string' || row[field].length > (field.endsWith('Time') ? 5 : 10)) return invalid();
    }
    // Unfinished editor input is data, not a proposed event or execution authority.
    return { index, date: row.date as string, endDate: row.endDate as string,
      startTime: row.startTime as string, endTime: row.endTime as string };
  });
  return { selectedIndex, edits };
}
function rawContent(events: PlanProtectionEvent[]): string {
  return JSON.stringify(events.map(event => FIELDS.map(field =>
    Object.hasOwn(event, field) ? [true, event[field]] : [false])));
}
function validTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) return invalid();
  return now;
}
function draftValue(raw: unknown, expectedScope: string): PrecisePlanDraft {
  const value = dataObject(raw, DRAFT_FIELDS);
  if (value.version !== 1 || typeof value.id !== 'string' || !UUID.test(value.id) ||
    value.scopeKey !== expectedScope || typeof value.savedAt !== 'number') return invalid();
  const source = sourceValue(value.source);
  const content = contentValue({ selectedIndex: value.selectedIndex, edits: value.edits }, source);
  return { version: 1, id: value.id, scopeKey: expectedScope, source, ...content, savedAt: validTime(value.savedAt) };
}
function snapshotKey(draft: PrecisePlanDraft): string {
  return JSON.stringify([draft.version, draft.id, draft.scopeKey, draft.source.key,
    rawContent(draft.source.events), draft.selectedIndex, draft.edits, draft.savedAt]);
}
function tooLarge(raw: string): boolean {
  return raw.length > PRECISE_PLAN_DRAFT_MAX_BYTES || new TextEncoder().encode(raw).byteLength > PRECISE_PLAN_DRAFT_MAX_BYTES;
}
function storedValue(raw: string, hash: string): PrecisePlanDraft {
  if (tooLarge(raw)) return invalid();
  return draftValue(JSON.parse(raw), hash);
}
function storageValue(): Storage {
  try {
    if (typeof window === 'undefined') throw new Error();
    return window.sessionStorage;
  } catch { throw new Error(STORAGE); }
}
function readRaw(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); }
  catch { throw new Error(READ); }
}
function requireActive(active: () => boolean): void {
  if (typeof active !== 'function' || active() !== true) throw new Error(INACTIVE);
}
function requireUnchanged(storage: Storage, key: string, expected: string | null): void {
  if (readRaw(storage, key) !== expected) throw new Error(CHANGED);
}
function requireSnapshot(raw: string | null, hash: string, expected: PrecisePlanDraft | null): void {
  if (expected === null) {
    if (raw !== null) throw new Error(CHANGED);
  } else if (raw === null || snapshotKey(storedValue(raw, hash)) !== snapshotKey(expected)) {
    throw new Error(CHANGED);
  }
}
function removeRaw(storage: Storage, key: string, raw: string, active: () => boolean): void {
  requireUnchanged(storage, key, raw);
  requireActive(active);
  try { storage.removeItem(key); }
  catch { throw new Error(REMOVE); }
  requireActive(active);
  if (readRaw(storage, key) !== null) throw new Error(REMOVE);
  requireActive(active);
}
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && [INVALID, INACTIVE, STORAGE, READ, SAVE, REMOVE, CHANGED].includes(error.message)
    ? error.message : fallback;
}

/** Only exact ordered raw content can be rebound; duplicate edited rows need their original source. */
export function precisePlanDraftSourceMatch(
  draft: PrecisePlanDraft, source: RevisionDraftSource,
): PrecisePlanDraftSourceMatch {
  try {
    const value = dataObject(draft, DRAFT_FIELDS);
    if (typeof value.scopeKey !== 'string' || !HASH.test(value.scopeKey)) return 'mismatch';
    const saved = draftValue(value, value.scopeKey), current = sourceValue(source);
    if (rawContent(saved.source.events) !== rawContent(current.events)) return 'mismatch';
    if (saved.source.key === current.key) return 'exact';
    const counts = new Map<string, number>();
    for (const event of current.events) {
      const raw = rawContent([event]);
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
    return saved.edits.some(edit => counts.get(rawContent([current.events[edit.index]])) !== 1) ? 'ambiguous' : 'fresh';
  } catch { return 'mismatch'; }
}

/** Read only the hashed account/school/context scope. Reading never renews the lifetime. */
export function readPrecisePlanDraft(scope: RevisionDraftScope, now = Date.now()): PrecisePlanDraftReadResult {
  let hash: string;
  try { hash = scopeHash(scope); validTime(now); }
  catch { return { draft: null, status: 'invalid', message: INVALID }; }
  let storage: Storage, raw: string | null;
  const key = PREFIX + hash;
  try { storage = storageValue(); raw = readRaw(storage, key); }
  catch (error) { return { draft: null, status: 'unavailable', message: errorMessage(error, READ) }; }
  if (raw === null) return { draft: null, status: 'empty' };
  let status: 'invalid' | 'expired' = 'invalid';
  try {
    const draft = storedValue(raw, hash);
    if (draft.savedAt > now) return invalid();
    if (now - draft.savedAt < PRECISE_PLAN_DRAFT_TTL_MS) return { draft, status: 'ready' };
    status = 'expired';
  } catch { /* Invalid stored input is never exposed. */ }
  let message = status === 'expired' ? '日期與時間草稿已超過 30 分鐘，請重新編輯。' : INVALID;
  try { removeRaw(storage, key, raw, () => true); }
  catch (error) { message += ' ' + errorMessage(error, REMOVE); }
  return { draft: null, status, message };
}

/**
 * Stores unfinished input only. Hook callers supply the complete previously reviewed snapshot.
 * Rebinding a recovered draft supplies its original savedAt; only a new edit renews the lifetime.
 */
export function savePrecisePlanDraft(
  scope: RevisionDraftScope, source: RevisionDraftSource, content: PrecisePlanDraftContent,
  active: () => boolean, now = Date.now(), options?: PrecisePlanDraftSaveOptions,
): PrecisePlanDraftSaveResult {
  try {
    const hash = scopeHash(scope), selected = sourceValue(source), edited = contentValue(content, selected);
    const condition = options === undefined ? {} : dataObject(options, ['expected', 'savedAt']);
    validTime(now);
    const savedAt = condition.savedAt === undefined ? now : validTime(condition.savedAt as number);
    if (savedAt > now || now - savedAt >= PRECISE_PLAN_DRAFT_TTL_MS) return invalid();
    const expected = condition.expected === undefined || condition.expected === null
      ? condition.expected : draftValue(condition.expected, hash);
    requireActive(active);
    const storage = storageValue(), key = PREFIX + hash, previous = readRaw(storage, key);
    requireActive(active);
    if (expected !== undefined) requireSnapshot(previous, hash, expected);
    if (edited.edits.length === 0) {
      if (previous === null) return { ok: true, draft: null };
      if (storedValue(previous, hash).source.key !== selected.key) return { ok: true, draft: null };
      removeRaw(storage, key, previous, active);
      return { ok: true, draft: null };
    }
    const id = crypto.randomUUID();
    if (!UUID.test(id)) return invalid();
    const draft: PrecisePlanDraft = { version: 1, id, scopeKey: hash, source: selected, ...edited, savedAt };
    const encoded = JSON.stringify(draft);
    if (tooLarge(encoded)) return invalid();
    requireUnchanged(storage, key, previous);
    requireActive(active);
    try { storage.setItem(key, encoded); }
    catch { throw new Error(SAVE); }
    requireActive(active);
    if (readRaw(storage, key) !== encoded) throw new Error(SAVE);
    requireActive(active);
    return { ok: true, draft };
  } catch (error) { return { ok: false, draft: null, message: errorMessage(error, SAVE) }; }
}

/** A different source is a safe no-op; the same source requires the complete reviewed snapshot. */
export function clearPrecisePlanDraft(
  scope: RevisionDraftScope, active: () => boolean, match?: PrecisePlanDraftClearMatch,
): PrecisePlanDraftClearResult {
  try {
    const hash = scopeHash(scope);
    const condition = match === undefined ? {} : dataObject(match, ['sourceKey', 'id', 'snapshot']);
    if ((condition.sourceKey !== undefined && (typeof condition.sourceKey !== 'string' || !HASH.test(condition.sourceKey))) ||
      (condition.id !== undefined && (typeof condition.id !== 'string' || !UUID.test(condition.id)))) return invalid();
    const snapshot = condition.snapshot === undefined || condition.snapshot === null
      ? condition.snapshot : draftValue(condition.snapshot, hash);
    requireActive(active);
    const storage = storageValue(), key = PREFIX + hash, raw = readRaw(storage, key);
    requireActive(active);
    if (raw !== null && (condition.sourceKey !== undefined || condition.id !== undefined || snapshot !== undefined)) {
      const existing = storedValue(raw, hash);
      if (condition.sourceKey !== undefined && condition.sourceKey !== existing.source.key) return { ok: true, cleared: false };
      if (condition.id !== undefined && condition.id !== existing.id) throw new Error(CHANGED);
    }
    if (snapshot !== undefined) requireSnapshot(raw, hash, snapshot);
    if (raw === null) return { ok: true, cleared: false };
    removeRaw(storage, key, raw, active);
    return { ok: true, cleared: true };
  } catch (error) { return { ok: false, cleared: false, message: errorMessage(error, REMOVE) }; }
}
