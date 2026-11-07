import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseAssistantCalendarEvent, parseAssistantCalendarReceipt,
  type AssistantCalendarEvent, type AssistantCalendarReceipt,
} from '@campus/shared/src/assistantExecution';
import { personalImportKey } from '@campus/shared/src/imports/records';
import type { PersonalImportScope } from './personalImports';

export const ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES = 256;
export const ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES = 512 * 1024;
export const ASSISTANT_CALENDAR_SOURCE_NAME = '助理行程';
const WAIT_MS = 20_000;
const locks = new Map<string, Promise<unknown>>();

export type AssistantCalendarJournalErrorCode =
  | 'journal-unavailable' | 'journal-corrupt' | 'journal-full'
  | 'journal-write-unverified' | 'journal-timeout' | 'session-changed';
const messages: Record<AssistantCalendarJournalErrorCode, string> = {
  'journal-unavailable': '目前無法讀取行程操作紀錄。請稍後再核對，這次不會新增行程。',
  'journal-corrupt': '行程操作紀錄無法安全核對。已保留原資料，這次不會新增行程。',
  'journal-full': '這台手機的行程操作紀錄已達保存上限。既有行程仍可核對，這次不會新增行程。',
  'journal-write-unverified': '尚未確認行程操作紀錄已完整保存，這次不會新增行程。請稍後核對原操作。',
  'journal-timeout': '讀取行程操作紀錄逾時。請稍後核對原操作，這次不會重新送出。',
  'session-changed': '帳號或學校已切換，這次行程核對已停止。',
};
export class AssistantCalendarJournalError extends Error {
  constructor(readonly code: AssistantCalendarJournalErrorCode) {
    super(messages[code]);
    this.name = 'AssistantCalendarJournalError';
  }
}

export type AssistantCalendarJournalProposal = {
  owner: string;
  schoolId: string;
  mutationId: string;
  createdAt: string;
  event: AssistantCalendarEvent;
};
export type AssistantCalendarJournalObservation =
  | { state: 'verified'; checkedAt: string; receipt: AssistantCalendarReceipt }
  | { state: 'unknown'; checkedAt: string; reason: 'unavailable' | 'absent' | 'changed'; lastVerified?: AssistantCalendarReceipt };
export type AssistantCalendarJournalEntry = {
  proposal: AssistantCalendarJournalProposal;
  attemptedAt: string;
  observation?: AssistantCalendarJournalObservation;
};
type Journal = {
  version: 1;
  owner: string;
  schoolId: string;
  entries: AssistantCalendarJournalEntry[];
};
declare const permitBrand: unique symbol;
export type AssistantCalendarJournalPermit = { readonly [permitBrand]: true };
const permits = new WeakMap<AssistantCalendarJournalPermit, string>();
export type AssistantCalendarJournalReservation =
  | { kind: 'reserved'; entry: AssistantCalendarJournalEntry; permit: AssistantCalendarJournalPermit }
  | { kind: 'existing'; entry: AssistantCalendarJournalEntry };

function invalid(): never { throw new AssistantCalendarJournalError('journal-corrupt'); }
function object(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function scopeValue(raw: unknown): PersonalImportScope {
  const value = object(raw, ['owner', 'schoolId']);
  if (typeof value.owner !== 'string' || !/^(?:firebase|nuni):.+$/u.test(value.owner) ||
      value.owner.length > 520 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.owner) ||
      typeof value.schoolId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.schoolId)) return invalid();
  try { encodeURIComponent(value.owner); } catch { return invalid(); }
  return { owner: value.owner, schoolId: value.schoolId };
}
function requireActive(scope: PersonalImportScope, active: () => boolean) {
  scopeValue(scope);
  let valid = false;
  try { valid = active(); } catch { /* A failed live guard cannot grant access. */ }
  if (!valid) throw new AssistantCalendarJournalError('session-changed');
}
function instant(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) return invalid();
  return raw;
}
function proposalValue(raw: unknown, scope: PersonalImportScope): AssistantCalendarJournalProposal {
  const value = object(raw, ['owner', 'schoolId', 'mutationId', 'createdAt', 'event']);
  if (value.owner !== scope.owner || value.schoolId !== scope.schoolId ||
      typeof value.mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.mutationId)) return invalid();
  try {
    return Object.freeze({
      owner: scope.owner, schoolId: scope.schoolId, mutationId: value.mutationId,
      createdAt: instant(value.createdAt), event: Object.freeze(parseAssistantCalendarEvent(value.event)),
    });
  } catch { return invalid(); }
}
function receiptValue(raw: unknown, proposal: AssistantCalendarJournalProposal): AssistantCalendarReceipt {
  try {
    const receipt = parseAssistantCalendarReceipt(raw, {
      schoolId: proposal.schoolId, mutationId: proposal.mutationId, event: proposal.event, storage: 'device',
    });
    if (receipt.record.importedAt !== proposal.createdAt || receipt.record.source.name !== ASSISTANT_CALENDAR_SOURCE_NAME) return invalid();
    return receipt;
  } catch { return invalid(); }
}
function observationValue(raw: unknown, proposal: AssistantCalendarJournalProposal): AssistantCalendarJournalObservation {
  const value = object(raw, ['state', 'checkedAt', 'receipt', 'reason', 'lastVerified']);
  const checkedAt = instant(value.checkedAt);
  if (value.state === 'verified' && value.reason === undefined && value.lastVerified === undefined) {
    const receipt = receiptValue(value.receipt, proposal);
    if (receipt.verifiedAt !== checkedAt) return invalid();
    return { state: 'verified', checkedAt, receipt };
  }
  if (value.state !== 'unknown' || value.receipt !== undefined ||
      !['unavailable', 'absent', 'changed'].includes(value.reason as string)) return invalid();
  return {
    state: 'unknown', checkedAt, reason: value.reason as 'unavailable' | 'absent' | 'changed',
    ...(value.lastVerified !== undefined ? { lastVerified: receiptValue(value.lastVerified, proposal) } : {}),
  };
}
function entryValue(raw: unknown, scope: PersonalImportScope): AssistantCalendarJournalEntry {
  const value = object(raw, ['proposal', 'attemptedAt', 'observation']);
  const proposal = proposalValue(value.proposal, scope);
  return {
    proposal, attemptedAt: instant(value.attemptedAt),
    ...(value.observation !== undefined ? { observation: observationValue(value.observation, proposal) } : {}),
  };
}
/** Use the ledger's duplicate identity, while receipts still check every original field exactly. */
export function assistantCalendarEventIdentity(event: AssistantCalendarEvent): string {
  return personalImportKey({
    ...parseAssistantCalendarEvent(event), id: 'assistant-journal', kind: 'events', schoolId: 'journal',
    academicYear: '', semester: '', source: { type: 'paste', line: 1, rawText: '' },
  });
}
const eventKey = assistantCalendarEventIdentity;
function proposalKey(proposal: AssistantCalendarJournalProposal) { return JSON.stringify(proposal); }
function utf8Bytes(value: string): number {
  let length = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}
function checkSize(raw: string) {
  if (raw.length > ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES || utf8Bytes(raw) > ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES)
    throw new AssistantCalendarJournalError('journal-full');
}
function journalValue(raw: string | null, scope: PersonalImportScope): Journal {
  if (raw === null) return { version: 1, ...scope, entries: [] };
  checkSize(raw);
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return invalid(); }
  const value = object(decoded, ['version', 'owner', 'schoolId', 'entries']);
  if (value.version !== 1 || value.owner !== scope.owner || value.schoolId !== scope.schoolId ||
      !Array.isArray(value.entries)) return invalid();
  if (value.entries.length > ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES) throw new AssistantCalendarJournalError('journal-full');
  const entries = value.entries.map((entry) => entryValue(entry, scope));
  if (new Set(entries.map((entry) => entry.proposal.mutationId)).size !== entries.length ||
      new Set(entries.map((entry) => eventKey(entry.proposal.event))).size !== entries.length) return invalid();
  return { version: 1, ...scope, entries };
}

export function assistantCalendarJournalStorageKey(scope: PersonalImportScope): string {
  const target = scopeValue(scope);
  return 'campus.assistant-calendar-journal.v1:' + encodeURIComponent(target.owner) + ':' + encodeURIComponent(target.schoolId);
}

/** Lock work itself, not its caller's deadline: a pending native write must stay serialized. */
function locked<T>(scope: PersonalImportScope, work: () => Promise<T>): Promise<T> {
  const key = assistantCalendarJournalStorageKey(scope);
  const previous = locks.get(key) || Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  locks.set(key, task);
  void task.finally(() => { if (locks.get(key) === task) locks.delete(key); }).catch(() => undefined);
  return task;
}
async function bounded<T>(scope: PersonalImportScope, active: () => boolean,
  work: (current: () => boolean) => Promise<T>): Promise<T> {
  requireActive(scope, active);
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => running && active();
  try {
    const value = await Promise.race([
      work(current),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { running = false; reject(new AssistantCalendarJournalError('journal-timeout')); }, WAIT_MS);
      }),
    ]);
    requireActive(scope, active);
    return value;
  } finally {
    running = false;
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function read(scope: PersonalImportScope, active: () => boolean): Promise<Journal> {
  requireActive(scope, active);
  let raw: string | null;
  try { raw = await AsyncStorage.getItem(assistantCalendarJournalStorageKey(scope)); }
  catch { requireActive(scope, active); throw new AssistantCalendarJournalError('journal-unavailable'); }
  requireActive(scope, active);
  return journalValue(raw, scope);
}
async function write(journal: Journal, active: () => boolean) {
  const scope = { owner: journal.owner, schoolId: journal.schoolId };
  requireActive(scope, active);
  const serialized = JSON.stringify(journal);
  checkSize(serialized);
  const key = assistantCalendarJournalStorageKey(scope);
  try {
    await AsyncStorage.setItem(key, serialized);
    requireActive(scope, active);
    const saved = await AsyncStorage.getItem(key);
    requireActive(scope, active);
    if (saved !== serialized) throw new AssistantCalendarJournalError('journal-write-unverified');
    journalValue(saved, scope);
  } catch (error) {
    requireActive(scope, active);
    if (error instanceof AssistantCalendarJournalError) throw error;
    throw new AssistantCalendarJournalError('journal-write-unverified');
  }
}

/** A failure is never an empty history. No legacy or unscoped storage is consulted. */
export function readAssistantCalendarJournal(scope: PersonalImportScope, active: () => boolean): Promise<AssistantCalendarJournalEntry[]> {
  const target = scopeValue(scope);
  return bounded(target, active, (current) => locked(target, async () => (await read(target, current)).entries));
}

/**
 * Called inside the existing ledger lock. The journal never calls the ledger,
 * so restore can release this lock before waiting for a ledger snapshot.
 */
export function reserveAssistantCalendarAttempt(rawProposal: AssistantCalendarJournalProposal,
  active: () => boolean): Promise<AssistantCalendarJournalReservation> {
  const raw = object(rawProposal, ['owner', 'schoolId', 'mutationId', 'createdAt', 'event']);
  const scope = scopeValue({ owner: raw.owner, schoolId: raw.schoolId });
  const proposal = proposalValue(rawProposal, scope);
  return bounded(scope, active, (current) => locked(scope, async () => {
    const journal = await read(scope, current);
    const sameId = journal.entries.find((entry) => entry.proposal.mutationId === proposal.mutationId);
    if (sameId && proposalKey(sameId.proposal) !== proposalKey(proposal)) return invalid();
    const existing = sameId || journal.entries.find((entry) => eventKey(entry.proposal.event) === eventKey(proposal.event));
    if (existing) return { kind: 'existing' as const, entry: existing };
    if (journal.entries.length >= ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES) throw new AssistantCalendarJournalError('journal-full');
    const entry = { proposal, attemptedAt: new Date().toISOString() };
    await write({ ...journal, entries: [...journal.entries, entry] }, current);
    requireActive(scope, current);
    const permit = Object.freeze({}) as AssistantCalendarJournalPermit;
    permits.set(permit, proposalKey(proposal));
    return { kind: 'reserved' as const, entry, permit };
  }));
}

/** Non-serializable and consumed once. A saved proposal or reservation grants no write authority. */
export function consumeAssistantCalendarJournalPermit(permit: AssistantCalendarJournalPermit,
  rawProposal: AssistantCalendarJournalProposal, active: () => boolean): boolean {
  const expected = permits.get(permit);
  permits.delete(permit);
  const raw = object(rawProposal, ['owner', 'schoolId', 'mutationId', 'createdAt', 'event']);
  const scope = scopeValue({ owner: raw.owner, schoolId: raw.schoolId });
  requireActive(scope, active);
  return expected !== undefined && expected === proposalKey(proposalValue(rawProposal, scope));
}

export function saveAssistantCalendarJournalObservations(
  scope: PersonalImportScope,
  updates: ReadonlyArray<{ proposal: AssistantCalendarJournalProposal; observation: AssistantCalendarJournalObservation }>,
  active: () => boolean,
): Promise<void> {
  const target = scopeValue(scope);
  const parsed = updates.map((update) => {
    const proposal = proposalValue(update.proposal, target);
    return { proposal, observation: observationValue(update.observation, proposal) };
  });
  return bounded(target, active, (current) => locked(target, async () => {
    const journal = await read(target, current);
    const entries = journal.entries.map((entry) => {
      const update = parsed.find((item) => item.proposal.mutationId === entry.proposal.mutationId);
      if (!update) return entry;
      if (proposalKey(entry.proposal) !== proposalKey(update.proposal)) return invalid();
      if (entry.observation && entry.observation.checkedAt > update.observation.checkedAt) return entry;
      const previousReceipt = entry.observation?.state === 'verified' ? entry.observation.receipt : entry.observation?.lastVerified;
      const observation = update.observation.state === 'unknown' && previousReceipt && !update.observation.lastVerified
        ? { ...update.observation, lastVerified: previousReceipt } : update.observation;
      return { ...entry, observation };
    });
    // No implicit reservation: an old receipt can only update an existing operation.
    if (parsed.some((update) => !entries.some((entry) => entry.proposal.mutationId === update.proposal.mutationId)))
      throw new AssistantCalendarJournalError('journal-write-unverified');
    if (JSON.stringify(entries) !== JSON.stringify(journal.entries)) await write({ ...journal, entries }, current);
  }));
}

export function saveAssistantCalendarJournalObservation(
  proposal: AssistantCalendarJournalProposal,
  observation: AssistantCalendarJournalObservation,
  active: () => boolean,
): Promise<void> {
  const raw = object(proposal, ['owner', 'schoolId', 'mutationId', 'createdAt', 'event']);
  return saveAssistantCalendarJournalObservations(scopeValue({ owner: raw.owner, schoolId: raw.schoolId }),
    [{ proposal, observation }], active);
}
