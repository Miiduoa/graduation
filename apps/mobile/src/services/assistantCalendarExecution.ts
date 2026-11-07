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
  type PersonalImportScope,
} from './personalImports';

export type AssistantCalendarContext = {
  uid: string;
  schoolId: string;
  platformTimetable?: PlatformTimetableAccess;
  isCurrent: () => boolean;
};
export type AssistantCalendarProposal = {
  owner: string;
  schoolId: string;
  mutationId: string;
  createdAt: string;
  event: AssistantCalendarEvent;
};
export type AssistantCalendarTask = { proposal: AssistantCalendarProposal } & (
  | { state: 'review' }
  | { state: 'saving' }
  | { state: 'checking' }
  | { state: 'cancelled' }
  | { state: 'verified'; receipt: AssistantCalendarReceipt; checking?: boolean; warning?: string }
  | { state: 'unknown'; reason: 'unavailable' | 'absent' | 'changed'; message: string; lastVerified?: AssistantCalendarReceipt }
  | { state: 'blocked'; message: string }
);

const SOURCE_NAME = '助理行程';
const WAIT_MS = 20_000;
// A rejected native response is not proof that storage stayed unchanged. Further
// confirmations of the same operation are read-only for this process lifetime.
const attempted = new Set<string>();
const UNKNOWN = '尚未確認這筆行程是否已保存。請重新核對同一筆紀錄；目前不會再次建立行程。';

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

async function readBack(proposal: AssistantCalendarProposal, context: AssistantCalendarContext, replay: boolean): Promise<AssistantCalendarTask> {
  const scope = scopeFor(proposal, context);
  try {
    const ledger = await snapshotPersonalImports(scope, () => current(proposal, context));
    scopeFor(proposal, context);
    const row = ledger.records.find((record) => record.id === proposal.mutationId);
    if (!row) return { proposal, state: 'unknown', reason: 'absent', message: '目前沒有讀到這筆行程，可能已被移除。這裡不會自動重新建立。' };
    try {
      return { proposal, state: 'verified', receipt: receiptFor(proposal, row, replay) };
    } catch {
      return { proposal, state: 'unknown', reason: 'changed', message: '同一筆行程目前的內容與確認草稿不同。請到個人行事曆核對，這裡不會覆蓋或重建。' };
    }
  } catch {
    scopeFor(proposal, context);
    return { proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN };
  }
}

/** A deadline releases the UI wait; it is never evidence that native storage did not commit. */
async function bounded(proposal: AssistantCalendarProposal, context: AssistantCalendarContext,
  work: () => Promise<AssistantCalendarTask>, stopFutureWrites: () => void = () => undefined): Promise<AssistantCalendarTask> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work(),
      new Promise<AssistantCalendarTask>((resolve) => {
        timer = setTimeout(() => {
          stopFutureWrites();
          resolve({ proposal, state: 'unknown', reason: 'unavailable', message: UNKNOWN });
        }, WAIT_MS);
      }),
    ]);
    scopeFor(proposal, context);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Only the explicit review button calls this. A retry of an attempted ID can only read. */
export async function confirmAssistantCalendarTask(proposal: AssistantCalendarProposal,
  context: AssistantCalendarContext): Promise<AssistantCalendarTask> {
  const scope = scopeFor(proposal, context);
  const key = personalImportStorageKey(scope) + ':' + proposal.mutationId;
  if (attempted.has(key)) return recheckAssistantCalendarTask(proposal, context);
  let mayWrite = true;
  let replay = false;
  const result = await bounded(proposal, context, async () => {
    try {
      const record = recordFor(proposal);
      await mutatePersonalImportLedger(scope, () => mayWrite && current(proposal, context), (ledger) => {
        scopeFor(proposal, context);
        const existing = ledger.records.find((row) => row.id === proposal.mutationId);
        if (existing) {
          receiptFor(proposal, existing, true);
          replay = true;
          return { ledger, result: undefined };
        }
        if (attempted.has(key) || ledger.batches.some((batch) => batch.id === proposal.mutationId))
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
        attempted.add(key);
        return { ledger: { ...ledger, records: [...ledger.records, record],
          batches: [...ledger.batches, { id: proposal.mutationId, createdAt: proposal.createdAt, count: 1 }] }, result: undefined };
      });
    } catch (error) {
      scopeFor(proposal, context);
      if (error instanceof CalendarBlocked && !attempted.has(key))
        return { proposal, state: 'blocked', message: error.message };
      // A native bridge may have saved before rejecting. Read the same ID;
      // neither an error nor a timeout authorizes a second create operation.
    }
    return readBack(proposal, context, replay);
  }, () => { mayWrite = false; attempted.add(key); });
  if (result.state === 'unknown') attempted.add(key);
  return result;
}

export async function recheckAssistantCalendarTask(proposal: AssistantCalendarProposal,
  context: AssistantCalendarContext, previous?: AssistantCalendarTask): Promise<AssistantCalendarTask> {
  scopeFor(proposal, context);
  const result = await bounded(proposal, context, () => readBack(proposal, context, true));
  const historical = previous?.state === 'verified' ? previous.receipt
    : previous?.state === 'unknown' ? previous.lastVerified : undefined;
  if (!historical || previous?.proposal.owner !== proposal.owner || previous.proposal.schoolId !== proposal.schoolId ||
      previous.proposal.mutationId !== proposal.mutationId || result.state !== 'unknown') return result;
  const receipt = parseAssistantCalendarReceipt(historical, {
    schoolId: proposal.schoolId, mutationId: proposal.mutationId, event: proposal.event, storage: 'device',
  });
  if (receipt.record.importedAt !== proposal.createdAt || receipt.record.source.name !== SOURCE_NAME) return result;
  // Failed access is not evidence of deletion. Keep the last verified result
  // and its original timestamp; a genuinely absent or changed row is different.
  if (result.reason === 'unavailable' && previous.state === 'verified') return { proposal, state: 'verified', receipt,
    warning: '這次無法重新讀取行程，仍保留先前已核對的回執與時間；目前內容尚未重新確認。' };
  return { ...result, lastVerified: receipt };
}
