'use client';

import { parseAssistantCalendarEvent, parseAssistantCalendarReceipt, type AssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { AssistantExecutionJournalCard } from './assistantExecutionJournal';

export type TodayAgentFollowupScope = { owner: string; schoolId: string };
export type TodayAgentFollowupEntry = {
  issuedContext: string;
  conversationId: string;
  card: AssistantExecutionJournalCard;
  verifiedAt: string;
};
const PREFIX = 'campus.today-agent-followups.v1:';
const LIMIT = 24;
const MAX_BYTES = 128 * 1024;
const CAPACITY_MESSAGE = '這部裝置已保留 24 筆安排追蹤。請先更新安排狀態；已繳交或關閉、且原行程結束超過 7 天的紀錄才會自動整理。';

function invalid(): never {
  throw new Error('這部裝置的安排追蹤紀錄無法核對，原有紀錄仍保留，請先重新確認。');
}
function object(raw: unknown, fields: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== fields.length) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return invalid();
    const value = descriptors[key];
    if (!value.enumerable || !('value' in value) || value.value === undefined) return invalid();
    result[key] = value.value;
  }
  return result;
}
function scope(raw: TodayAgentFollowupScope): TodayAgentFollowupScope {
  const value = object(raw, ['owner', 'schoolId']);
  if (typeof value.owner !== 'string' || !/^platform:[A-Za-z0-9_-]{1,128}$/.test(value.owner) ||
      typeof value.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.schoolId) ||
      value.schoolId === 'personal') return invalid();
  return { owner: value.owner, schoolId: value.schoolId };
}
function id(raw: unknown, minimum = 1): string {
  if (typeof raw !== 'string' || raw.length < minimum || raw.length > 100 || !/^[A-Za-z0-9_-]+$/.test(raw)) return invalid();
  return raw;
}
function parse(raw: unknown, target: TodayAgentFollowupScope): TodayAgentFollowupEntry {
  const value = object(raw, ['issuedContext', 'conversationId', 'card', 'verifiedAt']);
  if (typeof value.issuedContext !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.issuedContext) ||
      typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt)) ||
      new Date(value.verifiedAt).toISOString() !== value.verifiedAt) return invalid();
  const card = object(value.card, ['tool', 'token', 'args', 'mutationId', 'schoolId', 'destination']);
  if (card.tool !== 'propose_personal_event' || card.schoolId !== target.schoolId ||
      typeof card.token !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(card.token) ||
      typeof card.destination !== 'string' || !card.destination.trim() || card.destination !== card.destination.trim() ||
      card.destination.length > 300 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(card.destination)) return invalid();
  return { issuedContext: value.issuedContext, conversationId: id(value.conversationId), verifiedAt: value.verifiedAt,
    card: { tool: 'propose_personal_event', token: card.token, args: parseAssistantCalendarEvent(card.args),
      mutationId: id(card.mutationId, 8), schoolId: target.schoolId, destination: card.destination } };
}
export function todayAgentFollowupStorageKey(raw: TodayAgentFollowupScope): string {
  const target = scope(raw);
  return PREFIX + [target.owner, target.schoolId].map(encodeURIComponent).join(':');
}
function storage(): Storage {
  try { return window.localStorage; }
  catch { throw new Error('這部裝置無法保留安排追蹤紀錄，請確認瀏覽器儲存權限後重新核對。'); }
}
function readRaw(store: Storage, key: string): string | null {
  try { return store.getItem(key); }
  catch { throw new Error('這部裝置的安排紀錄暫時讀不到，請重新核對後再安排。'); }
}
function read(store: Storage, key: string, target: TodayAgentFollowupScope, displayOnly = false) {
  const raw = readRaw(store, key);
  if (raw === null) return { raw, entries: [] as TodayAgentFollowupEntry[] };
  try {
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) return invalid();
    const data = object(JSON.parse(raw), ['version', 'owner', 'schoolId', 'entries']);
    if (data.version !== 1 || data.owner !== target.owner || data.schoolId !== target.schoolId ||
        !Array.isArray(data.entries) || data.entries.length > LIMIT) return invalid();
    const entries: TodayAgentFollowupEntry[] = [];
    for (const item of data.entries) {
      try {
        const entry = parse(item, target);
        if (entries.some(previous => previous.card.mutationId === entry.card.mutationId)) {
          if (!displayOnly) return invalid();
          continue;
        }
        entries.push(entry);
      }
      catch (error) { if (!displayOnly) throw error; }
    }
    return { raw, entries };
  } catch { return invalid(); }
}
function requireActive(active: () => boolean) {
  if (!active()) throw new Error('登入或校園範圍已改變，這次追蹤更新已停止。');
}
async function withScopeLock<T>(target: TodayAgentFollowupScope, active: () => boolean, action: () => T): Promise<T> {
  requireActive(active);
  // localStorage's individual calls are synchronous, but read/compare/write is
  // not a cross-tab transaction. All proof mutations share this browser lock.
  if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.request !== 'function')
    throw new Error('目前瀏覽器無法安全保存安排追蹤，原核對紀錄仍保留。請使用最新版瀏覽器與 HTTPS 網站後重試。');
  const result = await navigator.locks.request(todayAgentFollowupStorageKey(target), () => {
    requireActive(active);
    return action();
  });
  requireActive(active);
  return result;
}
function write(store: Storage, key: string, target: TodayAgentFollowupScope, previous: string | null,
  entries: TodayAgentFollowupEntry[], active: () => boolean) {
  requireActive(active);
  if (readRaw(store, key) !== previous) throw new Error('另一個分頁已更新安排紀錄，請重新核對。');
  const encoded = entries.length ? JSON.stringify({ version: 1, ...target, entries }) : null;
  if (encoded && new TextEncoder().encode(encoded).length > MAX_BYTES) return invalid();
  try {
    if (encoded === null) store.removeItem(key);
    else store.setItem(key, encoded);
  } catch { throw new Error('行程已核對，但這部裝置尚未保留追蹤紀錄；請重新核對結果，避免重複安排。'); }
  requireActive(active);
  if (readRaw(store, key) !== encoded) throw new Error('安排追蹤紀錄尚未確認保存，請重新核對。');
}
/** Persisted proofs are read hints only. Every source association is authenticated again by the server. */
export function readTodayAgentFollowups(raw: TodayAgentFollowupScope): TodayAgentFollowupEntry[] {
  const target = scope(raw), store = storage();
  return read(store, todayAgentFollowupStorageKey(target), target).entries;
}
/** Display only: skip malformed evidence without changing stored proofs or write preflights. */
export function readTodayAgentFollowupsForDisplay(raw: TodayAgentFollowupScope): TodayAgentFollowupEntry[] {
  const target = scope(raw), store = storage();
  return read(store, todayAgentFollowupStorageKey(target), target, true).entries;
}
/** A preflight, never a reservation; save rechecks capacity under the cross-tab lock. */
export function assertTodayAgentFollowupCapacity(raw: TodayAgentFollowupScope, mutationId?: string): void {
  const checkedId = mutationId === undefined ? undefined : id(mutationId, 8);
  const entries = readTodayAgentFollowups(raw);
  if (checkedId && entries.some(entry => entry.card.mutationId === checkedId)) return;
  if (entries.length >= LIMIT) throw new Error(CAPACITY_MESSAGE);
}
/** Only a verified receipt can graduate an operation out of its recovery journal. */
export async function saveTodayAgentFollowup(raw: TodayAgentFollowupScope,
  input: Omit<TodayAgentFollowupEntry, 'verifiedAt'>, receipt: AssistantCalendarReceipt, active: () => boolean): Promise<void> {
  const target = scope(raw);
  requireActive(active);
  const verified = parseAssistantCalendarReceipt(receipt, { schoolId: target.schoolId,
    mutationId: input.card.mutationId, event: input.card.args, storage: 'synced' });
  const entry = parse({ ...input, verifiedAt: verified.verifiedAt }, target);
  await withScopeLock(target, active, () => {
    const store = storage(), key = todayAgentFollowupStorageKey(target), previous = read(store, key, target);
    const existing = previous.entries.find(item => item.card.mutationId === entry.card.mutationId);
    if (existing) {
      if (existing.issuedContext !== entry.issuedContext || existing.conversationId !== entry.conversationId ||
          JSON.stringify(existing.card) !== JSON.stringify(entry.card))
        throw new Error('同一筆安排已有不同追蹤內容，原紀錄仍保留，請先核對。');
      return;
    }
    if (previous.entries.length >= LIMIT) throw new Error(CAPACITY_MESSAGE);
    write(store, key, target, previous.raw, [...previous.entries, entry], active);
  });
}
/** Remove only after fresh server evidence identifies a non-coursework or completed source. Never on read failure. */
export async function removeTodayAgentFollowup(raw: TodayAgentFollowupScope, mutationId: string, active: () => boolean): Promise<void> {
  const target = scope(raw), checkedId = id(mutationId, 8);
  await withScopeLock(target, active, () => {
    const store = storage(), key = todayAgentFollowupStorageKey(target), previous = read(store, key, target);
    const entries = previous.entries.filter(item => item.card.mutationId !== checkedId);
    if (entries.length !== previous.entries.length) write(store, key, target, previous.raw, entries, active);
  });
}
