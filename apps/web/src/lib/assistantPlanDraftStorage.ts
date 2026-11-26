'use client';

import { sha256 } from 'js-sha256';
import { createPlanProtection, type PlanProtectionEvent } from './assistantPlanProtection';
import type { RevisionDraftScope, RevisionDraftSource } from './assistantPlanRevisionDraft';

export type PlanDraft<C extends object> = C & {
  version: 1; id: string; scopeKey: string; source: RevisionDraftSource; savedAt: number;
};
export type PlanDraftReadResult<D> = {
  draft: D | null; status: 'empty' | 'ready' | 'expired' | 'invalid' | 'unavailable'; message?: string;
};
export type PlanDraftSaveResult<D> = { ok: boolean; draft: D | null; message?: string };
export type PlanDraftClearResult = { ok: boolean; cleared: boolean; message?: string };
export type PlanDraftSaveOptions<D> = { expected?: D | null; savedAt?: number };
export type PlanDraftClearMatch<D> = { sourceKey?: string; id?: string; snapshot?: D | null };
export type PlanDraftMessages = Record<'invalid' | 'inactive' | 'storage' | 'read' | 'save' | 'remove' | 'changed' | 'expired', string>;
type DraftPolicy<C extends object> = {
  prefix: string; ttl: number; maxBytes: number; contentFields: readonly string[];
  contentValue(raw: unknown, source: RevisionDraftSource): C;
  isEmpty(content: C): boolean;
  messages: PlanDraftMessages;
};
const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class DraftValidationError extends Error {}

export function invalidPlanDraft(): never { throw new DraftValidationError(); }
const invalid = invalidPlanDraft;
export function draftDataObject(raw: unknown, fields: readonly string[]): Record<string, unknown> {
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
export function draftDataArray(raw: unknown, limit: number): unknown[] {
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
  const value = draftDataObject(scope, ['accountId', 'schoolId', 'context']);
  if (typeof value.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.accountId) ||
    typeof value.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.schoolId) || value.schoolId === 'personal' ||
    typeof value.context !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.context)) return invalid();
  return sha256(JSON.stringify([value.accountId, value.schoolId, value.context]));
}
export function draftSourceValue(source: unknown): RevisionDraftSource {
  const value = draftDataObject(source, ['key', 'events']);
  if (typeof value.key !== 'string' || !HASH.test(value.key)) return invalid();
  return { key: value.key, events: createPlanProtection(draftDataArray(value.events, 16), []).originalEvents };
}
export function draftRawContent(events: PlanProtectionEvent[]): string {
  return JSON.stringify(events.map(event => FIELDS.map(field =>
    Object.hasOwn(event, field) ? [true, event[field]] : [false])));
}
function validTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) return invalid();
  return now;
}

/** Shared session-only storage, strict snapshots and verified CAS; content policy grants no execution authority. */
export function createPlanDraftStorage<C extends object>(policy: DraftPolicy<C>) {
  type Draft = PlanDraft<C>;
  const { prefix: PREFIX, ttl: TTL, maxBytes: MAX_BYTES } = policy;
  const { invalid: INVALID, inactive: INACTIVE, storage: STORAGE, read: READ,
    save: SAVE, remove: REMOVE, changed: CHANGED } = policy.messages;
  const DRAFT_FIELDS = ['version', 'id', 'scopeKey', 'source', ...policy.contentFields, 'savedAt'];
  function draftValue(raw: unknown, expectedScope: string): Draft {
    const value = draftDataObject(raw, DRAFT_FIELDS);
    if (value.version !== 1 || typeof value.id !== 'string' || !UUID.test(value.id) ||
      value.scopeKey !== expectedScope || typeof value.savedAt !== 'number') return invalid();
    const source = draftSourceValue(value.source);
    const content = policy.contentValue(Object.fromEntries(policy.contentFields.map(field => [field, value[field]])), source);
    return { version: 1, id: value.id, scopeKey: expectedScope, source, ...content, savedAt: validTime(value.savedAt) };
  }
  function validate(raw: unknown): Draft {
    const value = draftDataObject(raw, DRAFT_FIELDS);
    if (typeof value.scopeKey !== 'string' || !HASH.test(value.scopeKey)) return invalid();
    return draftValue(value, value.scopeKey);
  }
  function snapshotKey(draft: Draft): string {
    return JSON.stringify([draft.version, draft.id, draft.scopeKey, draft.source.key,
      draftRawContent(draft.source.events), policy.contentFields.map(field => draft[field as keyof Draft]), draft.savedAt]);
  }
  function tooLarge(raw: string): boolean {
    return raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES;
  }
  function storedValue(raw: string, hash: string): Draft {
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
  function requireSnapshot(raw: string | null, hash: string, expected: Draft | null): void {
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
    return error instanceof DraftValidationError ? INVALID : error instanceof Error && [INVALID, INACTIVE, STORAGE, READ, SAVE, REMOVE, CHANGED].includes(error.message)
      ? error.message : fallback;
  }

  /** Read only the hashed account/school/context scope. Reading never renews the lifetime. */
  function read(scope: RevisionDraftScope, now = Date.now()): PlanDraftReadResult<Draft> {
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
      if (now - draft.savedAt < TTL) return { draft, status: 'ready' };
      status = 'expired';
    } catch { /* Invalid stored input is never exposed. */ }
    let message = status === 'expired' ? policy.messages.expired : INVALID;
    try { removeRaw(storage, key, raw, () => true); }
    catch (error) { message += ' ' + errorMessage(error, REMOVE); }
    return { draft: null, status, message };
  }

  /**
   * Stores unfinished input only. Hook callers supply the complete previously reviewed snapshot.
   * Rebinding a recovered draft supplies its original savedAt; only a new edit renews the lifetime.
   */
  function save(
    scope: RevisionDraftScope, source: RevisionDraftSource, content: C,
    active: () => boolean, now = Date.now(), options?: PlanDraftSaveOptions<Draft>,
  ): PlanDraftSaveResult<Draft> {
    try {
      const hash = scopeHash(scope), selected = draftSourceValue(source), edited = policy.contentValue(content, selected);
      const condition = options === undefined ? {} : draftDataObject(options, ['expected', 'savedAt']);
      validTime(now);
      const savedAt = condition.savedAt === undefined ? now : validTime(condition.savedAt as number);
      if (savedAt > now || now - savedAt >= TTL) return invalid();
      const expected = condition.expected === undefined || condition.expected === null
        ? condition.expected : draftValue(condition.expected, hash);
      requireActive(active);
      const storage = storageValue(), key = PREFIX + hash, previous = readRaw(storage, key);
      requireActive(active);
      if (expected !== undefined) requireSnapshot(previous, hash, expected);
      if (policy.isEmpty(edited)) {
        if (previous === null) return { ok: true, draft: null };
        if (storedValue(previous, hash).source.key !== selected.key) return { ok: true, draft: null };
        removeRaw(storage, key, previous, active);
        return { ok: true, draft: null };
      }
      const id = crypto.randomUUID();
      if (!UUID.test(id)) return invalid();
      const draft: Draft = { version: 1, id, scopeKey: hash, source: selected, ...edited, savedAt };
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
  function clear(
    scope: RevisionDraftScope, active: () => boolean, match?: PlanDraftClearMatch<Draft>,
  ): PlanDraftClearResult {
    try {
      const hash = scopeHash(scope);
      const condition = match === undefined ? {} : draftDataObject(match, ['sourceKey', 'id', 'snapshot']);
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
  return { read, save, clear, validate };
}
