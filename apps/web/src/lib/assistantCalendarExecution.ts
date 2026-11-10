'use client';

import {
  parseAssistantCalendarEvent,
  parseAssistantCalendarReceipt,
  type AssistantCalendarReceipt,
} from '@campus/shared/src/assistantExecution';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { personalImportKey } from '@campus/shared/src/imports/records';
import {
  parsePersonalImportSyncState,
  personalImportRecordsEqual,
  type PersonalImportSyncState,
} from '@campus/shared/src/imports/sync';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import {
  PERSONAL_IMPORT_LIMIT,
  readPersonalImports,
  readPersonalImportSyncState,
  withPersonalImportSyncLock,
  type PersonalImportScope,
} from './personalImports';

function blocked(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function requireScope(scope: PersonalImportScope, active: () => boolean) {
  if (!active())
    blocked('ASSISTANT_CALENDAR_SCOPE_CHANGED', '帳號或校園已切換，這次行程核對已停止。');
  if (!/^platform:[A-Za-z0-9_-]{1,128}$/.test(scope.owner) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(scope.schoolId))
    blocked('ASSISTANT_CALENDAR_SCOPE_INVALID', '請先確認目前的平台帳號與校園，再加入個人行程。');
}

function requireNoPending(sync: PersonalImportSyncState) {
  if (sync.pending)
    blocked('ASSISTANT_CALENDAR_SYNC_PENDING', '上次個人資料同步尚未核對完成，請先處理同步結果，再加入或顯示這筆行程。');
}

function requireCapacity(records: readonly PersonalImportRecord[], sync: PersonalImportSyncState) {
  if (records.length >= PERSONAL_IMPORT_LIMIT || (sync.acknowledged?.length || 0) >= PERSONAL_IMPORT_LIMIT)
    blocked('ASSISTANT_CALENDAR_LOCAL_FULL', '這台裝置的個人行程或核對紀錄已達上限，請先備份並整理資料，再加入行程。');
}

function eventRange(event: Pick<PersonalImportRecord, 'allDay' | 'date' | 'endDate' | 'startTime' | 'endTime'>) {
  const start = Date.parse(`${event.date}T${event.allDay ? '00:00' : event.startTime}:00+08:00`);
  const endDate = event.allDay ? exclusiveAllDayEnd(event.date!, event.endDate) : event.endDate || event.date;
  const end = Date.parse(`${endDate}T${event.allDay ? '00:00' : event.endTime}:00+08:00`);
  return [start, end] as const;
}

/** A preflight only: it cannot reserve a slot or authorize a later write. */
export async function assertAssistantCalendarLocalReady(
  rawEvent: unknown,
  scope: PersonalImportScope,
  active: () => boolean,
): Promise<void> {
  const target = { ...scope };
  requireScope(target, active);
  const event = parseAssistantCalendarEvent(rawEvent);
  await withPersonalImportSyncLock(target, async (state) => {
    requireScope(target, active);
    const sync = state.sync || { enabled: false, base: null };
    requireNoPending(sync);
    requireCapacity(state.records, sync);
    const key = personalImportKey({
      ...event, id: 'assistant-preflight', kind: 'events', schoolId: target.schoolId,
      academicYear: '', semester: '', source: { type: 'paste', line: 1, rawText: '' },
    });
    if (state.records.some((row) => personalImportKey(row) === key))
      blocked('ASSISTANT_CALENDAR_LOCAL_CONFLICT', '這台裝置已有相同個人行程，請先查看行事曆或核對先前結果，避免重複建立。');
    const [start, end] = eventRange(event);
    if (state.records.some((row) => {
      if (row.kind !== 'events') return false;
      const [otherStart, otherEnd] = eventRange(row);
      return start < otherEnd && end > otherStart;
    }))
      blocked('ASSISTANT_CALENDAR_LOCAL_TIME_CONFLICT', '這段時間與這台裝置的個人行程重疊，請先確認行事曆並調整安排。');
    // Weekly timetable rows do not establish which future academic term is in force.
    return { state, result: undefined };
  }, () => active());
  requireScope(target, active);
}

function dataField(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== 'object')
    blocked('ASSISTANT_CALENDAR_RECEIPT_INVALID', '行程回執無法核對，請重新查核執行結果。');
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor))
    blocked('ASSISTANT_CALENDAR_RECEIPT_INVALID', '行程回執無法核對，請重新查核執行結果。');
  return descriptor.value;
}

function validatedReceipt(raw: AssistantCalendarReceipt, schoolId: string) {
  const record = dataField(raw, 'record');
  const event: Record<string, unknown> = {};
  for (const key of ['title', 'date', 'allDay', 'endDate', 'startTime', 'endTime', 'location']) {
    const value = dataField(record, key);
    if (value !== undefined) event[key] = value;
  }
  return parseAssistantCalendarReceipt(raw, {
    schoolId, mutationId: dataField(raw, 'mutationId') as string,
    event, storage: 'synced',
  });
}

/**
 * The caller first validates the receipt against the user's reviewed card and identity.
 * This second validation protects storage, then records single-row acknowledgement
 * without pretending to download a complete ledger or enabling background sync.
 */
export async function mirrorAssistantCalendarReceipt(
  rawReceipt: AssistantCalendarReceipt,
  scope: PersonalImportScope,
  active: () => boolean,
): Promise<void> {
  const target = { ...scope };
  requireScope(target, active);
  const receipt = validatedReceipt(rawReceipt, target.schoolId);
  const record = receipt.record;
  const revision = receipt.revision!;
  await withPersonalImportSyncLock(target, async (state, checkpoint) => {
    requireScope(target, active);
    const sync = state.sync || { enabled: false, base: null };
    requireNoPending(sync);
    const existing = state.records.find((row) => row.id === record.id);
    if (existing && !personalImportRecordsEqual([existing], [record]))
      blocked('ASSISTANT_CALENDAR_LOCAL_CONFLICT', '這筆行程在裝置上已有不同內容，已保留原資料，請先核對行事曆。');
    if (state.records.some((row) => row.id !== record.id && personalImportKey(row) === personalImportKey(record)))
      blocked('ASSISTANT_CALENDAR_LOCAL_CONFLICT', '這台裝置已有另一筆相同行程，已保留原資料，請先核對，避免重複。');

    const previous = sync.acknowledged?.find((item) => item.record.id === record.id);
    const baseRecord = sync.base?.records.find((row) => row.id === record.id);
    if (!existing && (previous || baseRecord))
      blocked('ASSISTANT_CALENDAR_LOCAL_CONFLICT', '這筆行程已在裝置移除，這次核對不會自動把它加回，請先確認行事曆。');
    if (sync.base?.revision === revision && (!baseRecord || !personalImportRecordsEqual([baseRecord], [record])))
      blocked('ASSISTANT_CALENDAR_RECEIPT_STALE', '同版本的行程資料不一致，請重新查核執行結果。');
    if ((!existing && sync.base && sync.base.revision > revision) ||
        (previous && previous.revision >= revision && !personalImportRecordsEqual([previous.record], [record])))
      blocked('ASSISTANT_CALENDAR_RECEIPT_STALE', '裝置已有較新的行程核對紀錄，請重新查核執行結果。');
    if (!existing) requireCapacity(state.records, sync);

    let nextSync = sync;
    if (!sync.base || sync.base.revision < revision) {
      if (!previous && (sync.acknowledged?.length || 0) >= PERSONAL_IMPORT_LIMIT)
        blocked('ASSISTANT_CALENDAR_LOCAL_FULL', '這台裝置的行程核對紀錄已達上限，請先完成個人資料同步。');
      const acknowledged = (sync.acknowledged || []).filter((item) => item.record.id !== record.id);
      acknowledged.push(previous && previous.revision > revision ? previous : { record, revision });
      nextSync = parsePersonalImportSyncState({ ...sync, acknowledged }, target.schoolId);
    }
    const next = { records: existing ? state.records : [...state.records, record], sync: nextSync };
    await checkpoint(next);
    requireScope(target, active);
    const saved = readPersonalImports(target).filter((row) => row.id === record.id);
    if (!personalImportRecordsEqual(saved, [record]) ||
        JSON.stringify(readPersonalImportSyncState(target)) !== JSON.stringify(nextSync))
      blocked('ASSISTANT_CALENDAR_LOCAL_VERIFY_FAILED', '伺服器已核對行程，但這台裝置尚未讀回相同結果，請重新核對顯示。');
    return { state: next, result: undefined };
  }, () => active());
  requireScope(target, active);
}
