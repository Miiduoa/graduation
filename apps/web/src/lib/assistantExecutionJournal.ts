'use client';

import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';

export type AssistantExecutionJournalScope = {
  owner: string;
  schoolId: string;
  context: string;
};

export type AssistantExecutionJournalCard = {
  tool: 'propose_personal_event';
  token: string;
  args: AssistantCalendarEvent;
  mutationId: string;
  schoolId: string;
  destination: string;
};

export type AssistantExecutionJournalEntry = {
  conversationId: string;
  card: AssistantExecutionJournalCard;
  savedAt: string;
};

const PREFIX = 'campus.assistant-execution.v1:';
const LIMIT = 16;
const MAX_BYTES = 64 * 1024;
const CARD_FIELDS = ['tool', 'token', 'args', 'mutationId', 'schoolId', 'destination'];

function invalid(): never {
  throw new Error('待核對的行程紀錄無法確認，原有紀錄仍保留，請先核對後再送出。');
}

function dataObject(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function validatedScope(raw: AssistantExecutionJournalScope): AssistantExecutionJournalScope {
  const value = dataObject(raw, ['owner', 'schoolId', 'context']);
  if (typeof value.owner !== 'string' || !/^platform:[A-Za-z0-9_-]{1,128}$/.test(value.owner) ||
      typeof value.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.schoolId) || value.schoolId === 'personal' ||
      typeof value.context !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.context)) return invalid();
  return { owner: value.owner, schoolId: value.schoolId, context: value.context };
}

function keyFor(scope: AssistantExecutionJournalScope) {
  return PREFIX + [scope.owner, scope.schoolId, scope.context].map(encodeURIComponent).join(':');
}

function safeId(raw: unknown, minimum: number): string {
  if (typeof raw !== 'string' || raw.length < minimum || raw.length > 100 || !/^[A-Za-z0-9_-]+$/.test(raw)) return invalid();
  return raw;
}

function calendarCard(raw: unknown, scope: AssistantExecutionJournalScope, conversationId: string, uiMetadata = false): AssistantExecutionJournalCard {
  const value = dataObject(raw, uiMetadata ? [...CARD_FIELDS, 'conversationId'] : CARD_FIELDS);
  if (value.tool !== 'propose_personal_event' || value.schoolId !== scope.schoolId ||
      typeof value.token !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(value.token) ||
      typeof value.destination !== 'string' || !value.destination || value.destination.length > 300 ||
      value.destination !== value.destination.trim() || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.destination) ||
      (value.conversationId !== undefined && value.conversationId !== conversationId)) return invalid();
  return {
    tool: 'propose_personal_event', token: value.token,
    args: parseAssistantCalendarEvent(value.args), mutationId: safeId(value.mutationId, 8),
    schoolId: scope.schoolId, destination: value.destination,
  };
}

function savedAt(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) return invalid();
  return raw;
}

function tooLarge(value: string): boolean {
  return value.length > MAX_BYTES || new TextEncoder().encode(value).byteLength > MAX_BYTES;
}

function browserStorage(): Storage {
  try {
    if (typeof window === 'undefined') throw new Error();
    return window.sessionStorage;
  } catch {
    throw new Error('瀏覽器無法保留行程核對紀錄，目前不會送出新操作，請先確認此分頁的儲存權限。');
  }
}

function readRaw(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); }
  catch { throw new Error('瀏覽器無法讀取待核對行程，原有紀錄仍保留，目前不會送出新操作。'); }
}

function readEntries(storage: Storage, key: string, scope: AssistantExecutionJournalScope) {
  const raw = readRaw(storage, key);
  if (raw === null) return { raw, entries: [] as AssistantExecutionJournalEntry[] };
  try {
    if (tooLarge(raw)) return invalid();
    const value = dataObject(JSON.parse(raw), ['version', 'scope', 'entries']);
    const storedScope = validatedScope(value.scope as AssistantExecutionJournalScope);
    if (value.version !== 1 || storedScope.owner !== scope.owner || storedScope.schoolId !== scope.schoolId ||
        storedScope.context !== scope.context || !Array.isArray(value.entries) || value.entries.length > LIMIT) return invalid();
    const ids = new Set<string>();
    const entries = value.entries.map((rawEntry) => {
      const entry = dataObject(rawEntry, ['conversationId', 'card', 'savedAt']);
      const conversationId = safeId(entry.conversationId, 1);
      const card = calendarCard(entry.card, scope, conversationId);
      if (ids.has(card.mutationId)) return invalid();
      ids.add(card.mutationId);
      return { conversationId, card, savedAt: savedAt(entry.savedAt) };
    });
    return { raw, entries };
  } catch { return invalid(); }
}

function requireActive(active: () => boolean) {
  if (typeof active !== 'function' || active() !== true)
    throw new Error('帳號、登入狀態或校園已切換，這次行程操作已停止。');
}

function requireUnchanged(storage: Storage, key: string, previous: string | null) {
  if (readRaw(storage, key) !== previous)
    throw new Error('待核對的行程紀錄已變更，原有紀錄仍保留，請重新核對後再送出。');
}

/** Only the exact current namespace is read; this never scans other accounts or sessions. */
export function readAssistantExecutionJournal(scope: AssistantExecutionJournalScope): AssistantExecutionJournalEntry[] {
  const target = validatedScope(scope);
  return readEntries(browserStorage(), keyFor(target), target).entries;
}

/** Persist before dispatch. These cards are recovery evidence, never an automatic write queue. */
export function saveAssistantExecutionJournal(
  scope: AssistantExecutionJournalScope,
  input: { conversationId: string; card: unknown },
  active: () => boolean,
): void {
  const target = validatedScope(scope);
  requireActive(active);
  const value = dataObject(input, ['conversationId', 'card']);
  const conversationId = safeId(value.conversationId, 1);
  const card = calendarCard(value.card, target, conversationId, true);
  const storage = browserStorage(), key = keyFor(target);
  const previous = readEntries(storage, key, target);
  requireActive(active);
  const existing = previous.entries.find((entry) => entry.card.mutationId === card.mutationId);
  if (existing) {
    if (existing.conversationId !== conversationId || JSON.stringify(existing.card) !== JSON.stringify(card))
      throw new Error('同一筆操作已有不同確認內容，原有紀錄仍保留，請先核對，不能覆蓋或重新送出。');
    return;
  }
  if (previous.entries.length >= LIMIT)
    throw new Error('待核對行程已達上限（16 筆），請先核對既有結果，再送出新操作。');
  const entries = [...previous.entries, { conversationId, card, savedAt: new Date().toISOString() }];
  const encoded = JSON.stringify({ version: 1, scope: target, entries });
  if (tooLarge(encoded))
    throw new Error('待核對行程的暫存容量已達上限，原有紀錄仍保留，請先核對既有結果。');
  requireUnchanged(storage, key, previous.raw);
  requireActive(active);
  try { storage.setItem(key, encoded); }
  catch { throw new Error('待核對行程未能保留，原有紀錄仍保留，目前不會送出新操作，請確認瀏覽器儲存空間。'); }
  requireActive(active);
  if (readRaw(storage, key) !== encoded)
    throw new Error('行程核對紀錄尚未成功保留，目前不會送出新操作，請稍後再試。');
}

/** Call only after an exact result is verified and reflected locally, or revocation is verified. */
export function removeAssistantExecutionJournal(
  scope: AssistantExecutionJournalScope,
  mutationId: string,
  active: () => boolean,
): void {
  const target = validatedScope(scope);
  requireActive(active);
  const id = safeId(mutationId, 8), storage = browserStorage(), key = keyFor(target);
  const previous = readEntries(storage, key, target);
  requireActive(active);
  const entries = previous.entries.filter((entry) => entry.card.mutationId !== id);
  if (entries.length === previous.entries.length) return;
  const encoded = entries.length ? JSON.stringify({ version: 1, scope: target, entries }) : null;
  requireUnchanged(storage, key, previous.raw);
  requireActive(active);
  try {
    if (encoded === null) storage.removeItem(key);
    else storage.setItem(key, encoded);
  } catch { throw new Error('行程結果已核對，但待核對紀錄尚未清除；重新開啟時請再次查核，避免重複送出。'); }
  requireActive(active);
  if (readRaw(storage, key) !== encoded)
    throw new Error('待核對紀錄尚未確認清除，重新開啟時請再次查核，避免重複送出。');
}
