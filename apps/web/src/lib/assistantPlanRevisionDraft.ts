'use client';

import { sha256 } from 'js-sha256';
import { createPlanProtection, type PlanProtectionEvent } from './assistantPlanProtection';

export type RevisionDraftScope = { accountId: string; schoolId: string; context: string };
export type RevisionDraftSource = { key: string; events: PlanProtectionEvent[] };
export type RevisionDraftContent = { instruction: string; protectedIndices: number[] };
export type RevisionDraft = RevisionDraftContent & {
  version: 1;
  id: string;
  scopeKey: string;
  source: RevisionDraftSource;
  savedAt: number;
};
export type RevisionDraftReadResult = {
  draft: RevisionDraft | null;
  status: 'empty' | 'ready' | 'expired' | 'invalid' | 'unavailable';
  message?: string;
};
export type RevisionDraftSaveResult = { ok: boolean; draft: RevisionDraft | null; message?: string };
export type RevisionDraftClearResult = { ok: boolean; cleared: boolean; message?: string };

const PREFIX = 'campus.assistant-plan-draft.v1:';
const MAX_BYTES = 16 * 1024;
export const REVISION_DRAFT_TTL_MS = 30 * 60 * 1000;
const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
const DRAFT_FIELDS = ['version', 'id', 'scopeKey', 'source', 'instruction', 'protectedIndices', 'savedAt'];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INVALID = '修改草稿內容無法核對，請重新編輯。';
const INACTIVE = '帳號、登入狀態或校園已切換，這次草稿儲存已停止。';
const STORAGE = '瀏覽器無法存取修改草稿；目前文字仍需由此頁保留，重新載入後可能遺失。';
const READ = '瀏覽器無法讀取修改草稿，請保留目前頁面並稍後再試。';
const SAVE = '修改草稿尚未確認儲存，請保留目前頁面並確認瀏覽器儲存空間。';
const REMOVE = '修改草稿尚未確認清除，請保留目前頁面並稍後再試。';
const CHANGED = '修改草稿已有更新，這次沒有覆蓋或清除較新的內容。';

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
  const rows = dataArray(value.events, 16);
  return { key: value.key, events: createPlanProtection(rows, []).originalEvents };
}
function contentValue(content: unknown, count: number): RevisionDraftContent {
  const value = dataObject(content, ['instruction', 'protectedIndices']);
  if (typeof value.instruction !== 'string' || value.instruction.length > 300) return invalid();
  const indices = dataArray(value.protectedIndices, 16), seen = new Set<number>();
  for (const index of indices) {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) return invalid();
    seen.add(index);
  }
  return { instruction: value.instruction, protectedIndices: [...seen].sort((left, right) => left - right) };
}
function rawContent(events: PlanProtectionEvent[]): string {
  return JSON.stringify(events.map(event => FIELDS.map(field =>
    Object.hasOwn(event, field) ? [true, event[field]] : [false])));
}
function validTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) return invalid();
  return now;
}
function draftValue(raw: unknown, expectedScope: string): RevisionDraft {
  const value = dataObject(raw, DRAFT_FIELDS);
  if (value.version !== 1 || typeof value.id !== 'string' || !UUID.test(value.id) || value.scopeKey !== expectedScope ||
    typeof value.savedAt !== 'number') return invalid();
  const source = sourceValue(value.source);
  const content = contentValue({ instruction: value.instruction, protectedIndices: value.protectedIndices }, source.events.length);
  return { version: 1, id: value.id, scopeKey: expectedScope, source, ...content, savedAt: validTime(value.savedAt) };
}
function tooLarge(raw: string): boolean {
  return raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES;
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

/** The hash is cleanup ownership only. It does not authorize execution or preserve an old token. */
export function revisionDraftSource(cards: readonly { mutationId: string; tool: string; schoolId: string; args: unknown }[]): RevisionDraftSource {
  const rows = dataArray(cards, 16);
  if (!rows.length) return invalid();
  const ids = new Set<string>();
  let school: string | undefined;
  const events = rows.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    // Real cards contain other UI/signature metadata; never read or persist those fields.
    const selected: Record<string, unknown> = {};
    for (const field of ['mutationId', 'tool', 'schoolId', 'args']) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, field);
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      selected[field] = descriptor.value;
    }
    if (selected.tool !== 'propose_personal_event' || typeof selected.mutationId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(selected.mutationId) || ids.has(selected.mutationId) ||
      typeof selected.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(selected.schoolId) || selected.schoolId === 'personal' ||
      (school !== undefined && selected.schoolId !== school)) return invalid();
    school = selected.schoolId;
    ids.add(selected.mutationId);
    return selected.args;
  });
  const validated = createPlanProtection(events, []).originalEvents;
  return { key: sha256(JSON.stringify([[...ids], rawContent(validated)])), events: validated };
}

/** Compare the complete ordered content, allowing fresh card IDs but never guessing by title. */
export function revisionDraftContentMatches(draft: RevisionDraft, source: RevisionDraftSource): boolean {
  try {
    const value = dataObject(draft, DRAFT_FIELDS);
    if (typeof value.scopeKey !== 'string' || !HASH.test(value.scopeKey)) return false;
    const validated = draftValue(value, value.scopeKey);
    return rawContent(validated.source.events) === rawContent(sourceValue(source).events);
  } catch { return false; }
}

/** Read only this scope. Reads never renew the 30-minute lifetime. */
export function readRevisionDraft(scope: RevisionDraftScope, now = Date.now()): RevisionDraftReadResult {
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
    if (tooLarge(raw)) return invalid();
    const draft = draftValue(JSON.parse(raw), hash);
    if (draft.savedAt > now) return invalid();
    if (now - draft.savedAt < REVISION_DRAFT_TTL_MS) return { draft, status: 'ready' };
    status = 'expired';
  } catch { /* Invalid stored content is never exposed. */ }
  let message = status === 'expired' ? '修改草稿已超過 30 分鐘，請重新編輯。' : INVALID;
  try { removeRaw(storage, key, raw, () => true); }
  catch (error) { message += ' ' + errorMessage(error, REMOVE); }
  return { draft: null, status, message };
}

/**
 * This stores unfinished input only; restoring it cannot confirm, cancel or send.
 * An empty edit returns draft:null even when another source remains untouched.
 */
export function saveRevisionDraft(
  scope: RevisionDraftScope, source: RevisionDraftSource, content: RevisionDraftContent,
  active: () => boolean, now = Date.now(),
): RevisionDraftSaveResult {
  try {
    const hash = scopeHash(scope), selected = sourceValue(source);
    const edited = contentValue(content, selected.events.length);
    validTime(now);
    requireActive(active);
    if (edited.instruction === '' && edited.protectedIndices.length === 0) {
      const result = clearRevisionDraft(scope, active, { sourceKey: selected.key });
      return { ok: result.ok, draft: null, ...(result.message ? { message: result.message } : {}) };
    }
    const storage = storageValue(), key = PREFIX + hash, previous = readRaw(storage, key);
    const id = crypto.randomUUID();
    if (!UUID.test(id)) return invalid();
    const draft: RevisionDraft = { version: 1, id, scopeKey: hash, source: selected, ...edited, savedAt: now };
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

/** Match an ID to reject late cleanup; a different source is an intentional safe no-op. */
export function clearRevisionDraft(
  scope: RevisionDraftScope, active: () => boolean, match?: { sourceKey?: string; id?: string },
): RevisionDraftClearResult {
  try {
    const hash = scopeHash(scope);
    const condition = match === undefined ? {} : dataObject(match, ['sourceKey', 'id']);
    if ((condition.sourceKey !== undefined && (typeof condition.sourceKey !== 'string' || !HASH.test(condition.sourceKey))) ||
      (condition.id !== undefined && (typeof condition.id !== 'string' || !UUID.test(condition.id)))) return invalid();
    requireActive(active);
    const storage = storageValue(), key = PREFIX + hash, raw = readRaw(storage, key);
    requireActive(active);
    if (raw === null) return { ok: true, cleared: false };
    if (condition.sourceKey !== undefined || condition.id !== undefined) {
      if (tooLarge(raw)) return invalid();
      const existing = draftValue(JSON.parse(raw), hash);
      if (condition.id !== undefined && condition.id !== existing.id) throw new Error(CHANGED);
      if (condition.sourceKey !== undefined && condition.sourceKey !== existing.source.key) return { ok: true, cleared: false };
    }
    removeRaw(storage, key, raw, active);
    return { ok: true, cleared: true };
  } catch (error) { return { ok: false, cleared: false, message: errorMessage(error, REMOVE) }; }
}
