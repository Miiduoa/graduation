import {
  createAssistantCalendarReceipt, parseAssistantCalendarEvent, parseAssistantCalendarReceipt,
  type AssistantCalendarEvent, type AssistantCalendarReceipt,
} from '@campus/shared/src/assistantExecution';
import { PERSONAL_IMPORT_BACKUP_MAX_RECORDS } from '@campus/shared/src/imports/backup';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { createPersonalImportId, personalImportKey } from '@campus/shared/src/imports/records';
import { validatePersonalImportRow } from '@campus/shared/src/imports/validation';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import type { PlatformTimetableAccess } from './assistantTimetableSource';
import {
  mutatePersonalImportLedger, snapshotPersonalImports, personalImportStorageKey,
  type PersonalImportScope, type PersonalImportLedger,
} from './personalImports';
import {
  ASSISTANT_CALENDAR_SOURCE_NAME, AssistantCalendarJournalError, assistantCalendarEventIdentity,
  consumeAssistantCalendarJournalPermit, readAssistantCalendarJournal, reserveAssistantCalendarAttempt,
  saveAssistantCalendarJournalObservation, saveAssistantCalendarJournalObservations,
  type AssistantCalendarJournalEntry, type AssistantCalendarJournalObservation, type AssistantCalendarJournalProposal,
} from './assistantCalendarJournal';

export type AssistantCalendarContext = {
  uid: string;
  schoolId: string;
  platformTimetable?: PlatformTimetableAccess;
  isCurrent: () => boolean;
};
/** Additional evidence may only restrict a fresh write; it never authorizes a retry. */
export type AssistantCalendarWriteCheck = {
  isCurrent: () => boolean;
  matches: (ledger: PersonalImportLedger) => boolean;
  message: string;
};
export type AssistantCalendarProposal = AssistantCalendarJournalProposal;
export type AssistantCalendarTask = { proposal: AssistantCalendarProposal } & (
  | { state: 'review' }
  | { state: 'saving' }
  | { state: 'checking' }
  | { state: 'cancelled' }
  | { state: 'verified'; receipt: AssistantCalendarReceipt; checking?: boolean; warning?: string }
  | { state: 'unknown'; reason: 'unavailable' | 'absent' | 'changed'; message: string; lastVerified?: AssistantCalendarReceipt }
  | { state: 'blocked'; message: string }
);

const SOURCE_NAME = ASSISTANT_CALENDAR_SOURCE_NAME;
const WAIT_MS = 20_000;
const attempted = new Set<string>();
// A deserialized proposal never inherits the original review button's write
// authority. Every fresh proposal can be confirmed only once in this process.
const freshProposals = new WeakSet<AssistantCalendarProposal>();
const UNKNOWN = '尚未確認這筆行程是否已保存。請重新核對同一筆紀錄；目前不會再次建立行程。';
const JOURNAL_WARNING = '本次核對結果尚未更新到操作紀錄。已保留原操作 ID，稍後只會重新核對，不會再次建立。';

export class AssistantCalendarScopeError extends Error {
  readonly code = 'session-changed';
  constructor() { super('Assistant calendar scope changed'); }
}
class CalendarBlocked extends Error {}

export function assistantCalendarOwner(context: AssistantCalendarContext): string | null {
  if (!context.isCurrent() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(context.schoolId)) return null;
  const platform = context.platformTimetable;
  if (platform) return !context.uid && platform.accountId && platform.isCurrent()
    ? `nuni:${platform.accountId}` : null;
  if (!context.uid || isFirebaseMockMode() || getAuthInstance().currentUser?.uid !== context.uid) return null;
  return `firebase:${context.uid}`;
}

export function sameAssistantCalendarEvent(first: AssistantCalendarEvent, second: AssistantCalendarEvent): boolean {
  const keys = ['title', 'date', 'allDay', 'endDate', 'startTime', 'endTime', 'location'] as const;
  return keys.every((key) => first[key] === second[key]);
}

export function createAssistantCalendarTask(event: AssistantCalendarEvent, context: AssistantCalendarContext): AssistantCalendarTask {
  const owner = assistantCalendarOwner(context);
  if (!owner) throw new AssistantCalendarScopeError();
  const proposal = {
    owner, schoolId: context.schoolId, mutationId: `aev_${createPersonalImportId()}`,
    createdAt: new Date().toISOString(), event: Object.freeze(parseAssistantCalendarEvent(event)),
  };
  freshProposals.add(proposal);
  return { state: 'review', proposal: Object.freeze(proposal) };
}

function scopeFor(proposal: AssistantCalendarProposal, context: AssistantCalendarContext): PersonalImportScope {
  const owner = assistantCalendarOwner(context);
  if (!owner || owner !== proposal.owner || proposal.schoolId !== context.schoolId)
    throw new AssistantCalendarScopeError();
  return { owner: proposal.owner, schoolId: proposal.schoolId };
}
function eventRange(event: Pick<PersonalImportRecord, 'allDay' | 'date' | 'endDate' | 'startTime' | 'endTime'>) {
  const start = Date.parse(`${event.date}T${event.allDay ? '00:00' : event.startTime}:00+08:00`);
  const endDate = event.allDay ? exclusiveAllDayEnd(event.date!, event.endDate) : event.endDate || event.date;
  const end = Date.parse(`${endDate}T${event.allDay ? '00:00' : event.endTime}:00+08:00`);
  return [start, end] as const;
}
function current(proposal: AssistantCalendarProposal, context: AssistantCalendarContext): boolean {
  try { scopeFor(proposal, context); return true; } catch { return false; }
}
function recordFor(proposal: AssistantCalendarProposal): AssistantCalendarReceipt['record'] {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(proposal.mutationId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(proposal.createdAt) ||
      !Number.isFinite(Date.parse(proposal.createdAt))) throw new CalendarBlocked('這份行程草稿無法核對，請重新提供日期與時間。');
  const event = parseAssistantCalendarEvent(proposal.event);
  const record: AssistantCalendarReceipt['record'] = {
    ...event, id: proposal.mutationId, batchId: proposal.mutationId, kind: 'events',
    schoolId: proposal.schoolId, academicYear: '', semester: '', importedAt: proposal.createdAt,
    source: { type: 'paste', name: SOURCE_NAME, line: 1, rawText: '' },
  };
  if (validatePersonalImportRow(record).some((issue) => issue.severity === 'error'))
    throw new CalendarBlocked('行程內容無法保存，請重新提供有效日期與起訖時間。');
  return record;
}
function receiptFor(proposal: AssistantCalendarProposal, record: unknown, replay: boolean): AssistantCalendarReceipt {
  const receipt = createAssistantCalendarReceipt({
    schoolId: proposal.schoolId, mutationId: proposal.mutationId, event: proposal.event,
    storage: 'device', record, verifiedAt: new Date().toISOString(), replay,
  });
  if (receipt.record.importedAt !== proposal.createdAt || receipt.record.source.name !== SOURCE_NAME)
    throw new CalendarBlocked('這筆行程已變更，無法核對為原本確認的內容。請到行事曆確認。');
  return receipt;
}

function taskFromLedger(proposal: AssistantCalendarProposal, ledger: PersonalImportLedger, replay: boolean): AssistantCalendarTask {
  const row = ledger.records.find((record) => record.id === proposal.mutationId);
  if (!row) return { proposal, state: 'unknown', reason: 'absent', message: '目前沒有讀到這筆行程，可能已被移除。這裡不會自動重新建立。' };
  try {
    return { proposal, state: 'verified', receipt: receiptFor(proposal, row, replay) };
  } catch {
    return { proposal, state: 'unknown', reason: 'changed', message: '同一筆行程目前的內容與確認草稿不同。請到個人行事曆核對，這裡不會覆蓋或重建。' };
  }
}
async function readBack(proposal: AssistantCalendarProposal, context: AssistantCalendarContext, replay: boolean): Promise<AssistantCalendarTask> {
  const scope = scopeFor(proposal, context);
  try {
    const ledger = await snapshotPersonalImports(scope, () => current(proposal, context));
    scopeFor(proposal, context);
    return taskFromLedger(proposal, ledger, replay);
  } catch {
    scopeFor(proposal, context);
    return { proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN };
  }
}

/** A deadline releases the UI wait; it is never evidence that native storage did not commit. */
async function bounded(proposal: AssistantCalendarProposal, context: AssistantCalendarContext,
  work: () => Promise<AssistantCalendarTask>, stopFutureWrites: () => void = () => undefined,
  timeoutResult: () => AssistantCalendarTask = () => ({ proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN }),
): Promise<AssistantCalendarTask> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work(),
      new Promise<AssistantCalendarTask>((resolve) => {
        timer = setTimeout(() => {
          stopFutureWrites();
          resolve(timeoutResult());
        }, WAIT_MS);
      }),
    ]);
    scopeFor(proposal, context);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function withHistory(result: AssistantCalendarTask, previous?: AssistantCalendarTask): AssistantCalendarTask {
  const { proposal } = result;
  const historical = previous?.state === 'verified' ? previous.receipt
    : previous?.state === 'unknown' ? previous.lastVerified : undefined;
  if (!historical || previous?.proposal.owner !== proposal.owner || previous.proposal.schoolId !== proposal.schoolId ||
      previous.proposal.mutationId !== proposal.mutationId || result.state !== 'unknown') return result;
  const receipt = parseAssistantCalendarReceipt(historical, {
    schoolId: proposal.schoolId, mutationId: proposal.mutationId, event: proposal.event, storage: 'device',
  });
  if (receipt.record.importedAt !== proposal.createdAt || receipt.record.source.name !== SOURCE_NAME) return result;
  if (result.reason === 'unavailable' && previous.state === 'verified') return { proposal, state: 'verified', receipt,
    warning: '這次無法重新讀取行程，仍保留先前已核對的回執與時間；目前內容尚未重新確認。' };
  return { ...result, lastVerified: receipt };
}
function journalWarning(task: AssistantCalendarTask): AssistantCalendarTask {
  if (task.state === 'verified') return { ...task, warning: [task.warning, JOURNAL_WARNING].filter(Boolean).join(' ') };
  if (task.state === 'unknown') return { ...task, message: task.message + ' ' + JOURNAL_WARNING };
  return task;
}
function observationFor(task: AssistantCalendarTask): AssistantCalendarJournalObservation {
  if (task.state === 'verified') return task.warning
    ? { state: 'unknown', checkedAt: new Date().toISOString(), reason: 'unavailable', lastVerified: task.receipt }
    : { state: 'verified', checkedAt: task.receipt.verifiedAt, receipt: task.receipt };
  if (task.state !== 'unknown') throw new AssistantCalendarJournalError('journal-corrupt');
  return { state: 'unknown', checkedAt: new Date().toISOString(), reason: task.reason,
    ...(task.lastVerified ? { lastVerified: task.lastVerified } : {}) };
}
function historicalTask(entry: AssistantCalendarJournalEntry): AssistantCalendarTask {
  const observation = entry.observation;
  const receipt = observation?.state === 'verified' ? observation.receipt : observation?.lastVerified;
  // Stored completion is history. Recovery needs a fresh exact ledger read
  // before displaying completion, even if an earlier negative update failed.
  return { proposal: entry.proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN,
    ...(receipt ? { lastVerified: receipt } : {}) };
}
async function persistObservation(task: AssistantCalendarTask, context: AssistantCalendarContext,
  active: () => boolean): Promise<AssistantCalendarTask> {
  try {
    await saveAssistantCalendarJournalObservation(task.proposal, observationFor(task), active);
    scopeFor(task.proposal, context);
    return task;
  } catch {
    scopeFor(task.proposal, context);
    return journalWarning(task);
  }
}
function matchingEntry(entries: AssistantCalendarJournalEntry[], proposal: AssistantCalendarProposal) {
  const sameId = entries.find((entry) => entry.proposal.mutationId === proposal.mutationId);
  if (sameId && (sameId.proposal.createdAt !== proposal.createdAt ||
      !sameAssistantCalendarEvent(sameId.proposal.event, proposal.event)))
    throw new AssistantCalendarJournalError('journal-corrupt');
  return sameId || entries.find((entry) => assistantCalendarEventIdentity(entry.proposal.event) === assistantCalendarEventIdentity(proposal.event));
}

/** Only the explicit review button calls this. A retry of an attempted ID can only read. */
export async function confirmAssistantCalendarTask(proposal: AssistantCalendarProposal,
  context: AssistantCalendarContext, writeCheck?: AssistantCalendarWriteCheck): Promise<AssistantCalendarTask> {
  const scope = scopeFor(proposal, context);
  const key = personalImportStorageKey(scope) + ':' + proposal.mutationId;
  if (!freshProposals.delete(proposal) || attempted.has(key)) return recheckAssistantCalendarTask(proposal, context);
  attempted.add(key);
  let mayWrite = true;
  let replay = false;
  let dispatched = false;
  let canonical = proposal;
  let previous: AssistantCalendarTask | undefined;
  let latest: AssistantCalendarTask | undefined;
  const active = () => mayWrite && current(proposal, context);
  // The event's own durable write changes the calendar version. Readback and
  // journal observation retain the account guard rather than this write guard.
  const canWrite = () => active() && (!writeCheck || writeCheck.isCurrent());
  const verifyWrite = (ledger: PersonalImportLedger) => {
    if (writeCheck && (!writeCheck.isCurrent() || !writeCheck.matches(ledger)))
      throw new CalendarBlocked(writeCheck.message);
  };
  const result = await bounded(proposal, context, async () => {
    try {
      const record = recordFor(proposal);
      await mutatePersonalImportLedger(scope, canWrite, async (ledger) => {
        scopeFor(proposal, context);
        const known = matchingEntry(await readAssistantCalendarJournal(scope, active), proposal);
        if (known) {
          canonical = known.proposal; previous = historicalTask(known); replay = true;
          return { ledger, result: undefined };
        }
        const existing = ledger.records.find((row) => row.id === proposal.mutationId);
        if (existing) {
          receiptFor(proposal, existing, true);
          await reserveAssistantCalendarAttempt(proposal, active);
          replay = true;
          return { ledger, result: undefined };
        }
        if (ledger.batches.some((batch) => batch.id === proposal.mutationId))
          throw new CalendarBlocked('這筆操作已送出過，請核對原紀錄；目前不會再次建立。');
        if (ledger.records.some((row) => row.kind === 'events' && personalImportKey(row) === personalImportKey(record)))
          throw new CalendarBlocked('個人行事曆已有相同名稱與時段的行程。請先核對原行程，這次沒有重複建立。');
        const [startAt, endAt] = eventRange(record);
        if (ledger.records.some((row) => {
          if (row.kind !== 'events') return false;
          const [otherStart, otherEnd] = eventRange(row);
          return startAt < otherEnd && endAt > otherStart;
        })) throw new CalendarBlocked('這段時間與這台手機的個人行程重疊。請先查看行事曆，調整時段後再提供新的安排。');
        // A weekly timetable alone does not prove its academic term applies to
        // this future date. Only stored dated events can establish a conflict.
        if (!Number.isFinite(startAt) || startAt <= Date.now())
          throw new CalendarBlocked('原先確認的開始時間已經過了，請重新提供未來的起訖時間。');
        if (ledger.records.length >= PERSONAL_IMPORT_BACKUP_MAX_RECORDS)
          throw new CalendarBlocked('這台裝置的個人紀錄已達上限，請先到匯入頁整理資料。');
        verifyWrite(ledger);
        const reservation = await reserveAssistantCalendarAttempt(proposal, canWrite);
        if (reservation.kind === 'existing') {
          canonical = reservation.entry.proposal; previous = historicalTask(reservation.entry); replay = true;
          return { ledger, result: undefined };
        }
        // Reservation can wait on native storage. Re-check the original time
        // and guard after its readback, before consuming this call's permit.
        if (!active()) throw new AssistantCalendarScopeError();
        verifyWrite(ledger);
        if (startAt <= Date.now())
          throw new CalendarBlocked('原先確認的開始時間已經過了，請重新提供未來的起訖時間。');
        if (!consumeAssistantCalendarJournalPermit(reservation.permit, proposal, canWrite))
          throw new AssistantCalendarJournalError('journal-write-unverified');
        dispatched = true;
        return { ledger: { ...ledger, records: [...ledger.records, record],
          batches: [...ledger.batches, { id: proposal.mutationId, createdAt: proposal.createdAt, count: 1 }] }, result: undefined };
      });
    } catch (error) {
      scopeFor(proposal, context);
      if (!dispatched && writeCheck && !writeCheck.isCurrent())
        return { proposal, state: 'blocked', message: writeCheck.message };
      if (!dispatched && error instanceof CalendarBlocked)
        return { proposal, state: 'blocked', message: error.message };
      if (!dispatched && error instanceof AssistantCalendarJournalError)
        return { proposal, state: 'blocked', message: error.message };
      // A native bridge may have saved before rejecting. Read the same ID;
      // neither an error nor a timeout authorizes a second create operation.
    }
    latest = withHistory(await readBack(canonical, context, replay), previous);
    return persistObservation(latest, context, active);
  }, () => { mayWrite = false; }, () => latest ? journalWarning(latest)
    : withHistory({ proposal: canonical, state: 'unknown', reason: 'unavailable', message: UNKNOWN }, previous));
  mayWrite = false;
  return result;
}

export async function recheckAssistantCalendarTask(proposal: AssistantCalendarProposal,
  context: AssistantCalendarContext, previous?: AssistantCalendarTask): Promise<AssistantCalendarTask> {
  scopeFor(proposal, context);
  let active = true;
  let latest: AssistantCalendarTask | undefined;
  try {
    return await bounded(proposal, context, async () => {
      latest = withHistory(await readBack(proposal, context, true), previous);
      return persistObservation(latest, context, () => active && current(proposal, context));
    }, () => { active = false; }, () => latest ? journalWarning(latest)
      : withHistory({ proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN }, previous));
  } finally { active = false; }
}

async function recover(context: AssistantCalendarContext, event?: AssistantCalendarEvent): Promise<AssistantCalendarTask[]> {
  const owner = assistantCalendarOwner(context);
  if (!owner) throw new AssistantCalendarScopeError();
  const scope = { owner, schoolId: context.schoolId };
  const scopeCurrent = () => assistantCalendarOwner(context) === owner && context.schoolId === scope.schoolId;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: AssistantCalendarTask[] | undefined;
  let savingObservation = false;
  const active = () => running && scopeCurrent();
  const guard = () => { if (!scopeCurrent()) throw new AssistantCalendarScopeError(); };
  try {
    const result = await Promise.race([
      (async () => {
        const saved = await readAssistantCalendarJournal(scope, active);
        guard();
        const entries = event ? saved.filter((entry) => assistantCalendarEventIdentity(entry.proposal.event) === assistantCalendarEventIdentity(event)) : saved;
        latest = entries.map(historicalTask);
        if (!entries.length) return latest; // The ordinary assistant mount does no ledger I/O.
        try {
          const ledger = await snapshotPersonalImports(scope, active);
          guard();
          latest = entries.map((entry) => withHistory(taskFromLedger(entry.proposal, ledger, true), historicalTask(entry)));
        } catch { guard(); }
        if (!running) return latest;
        savingObservation = true;
        try {
          await saveAssistantCalendarJournalObservations(scope,
            latest.map((task) => ({ proposal: task.proposal, observation: observationFor(task) })), active);
          guard();
        } catch { guard(); latest = latest.map(journalWarning); }
        return latest;
      })(),
      new Promise<AssistantCalendarTask[]>((resolve, reject) => {
        timer = setTimeout(() => {
          running = false;
          if (!latest) reject(new AssistantCalendarJournalError('journal-timeout'));
          else resolve(savingObservation ? latest.map(journalWarning) : latest);
        }, WAIT_MS);
      }),
    ]);
    guard();
    return result;
  } finally {
    running = false;
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Restored operations never become review drafts or acquire a new write permit. */
export function restoreAssistantCalendarTasks(context: AssistantCalendarContext): Promise<AssistantCalendarTask[]> {
  return recover(context);
}

/** Null means a successful journal read found no matching operation; errors never mean absence. */
export async function findPersistedAssistantCalendarTask(event: AssistantCalendarEvent,
  context: AssistantCalendarContext): Promise<AssistantCalendarTask | null> {
  return (await recover(context, parseAssistantCalendarEvent(event)))[0] || null;
}
