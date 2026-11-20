import { createPersonalImportId } from './records';
import { personalImportErrorMessage } from './copy';
import { validatePersonalImportRow } from './validation';
import type { PersonalImportRecord, PersonalImportRow } from './types';

export type PersonalEventDraft = {
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
};

export function emptyPersonalEventDraft(today = new Date()): PersonalEventDraft {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return {
    title: '',
    date: `${part('year')}-${part('month')}-${part('day')}`,
    endDate: '',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    location: '',
  };
}

export function draftFromPersonalEvent(row: PersonalImportRecord): PersonalEventDraft {
  return {
    title: row.title,
    date: row.date || '',
    endDate: row.endDate || '',
    allDay: !!row.allDay,
    startTime: row.startTime || '09:00',
    endTime: row.endTime || '10:00',
    location: row.location || '',
  };
}

/** Build a canonical events row; keeps stable id/source and untouched metadata when revising. */
export function personalEventRowFromDraft(
  draft: PersonalEventDraft,
  schoolId: string,
  existing?: PersonalImportRecord | null,
): PersonalImportRow {
  const allDay = !!draft.allDay;
  const title = draft.title.trim();
  const location = draft.location.trim();
  const preserved = existing
    ? (({ batchId: _batchId, importedAt: _importedAt, ...row }) => row)(existing)
    : {
        id: createPersonalImportId(),
        kind: 'events' as const,
        schoolId,
        academicYear: '',
        semester: '',
        source: {
          type: 'paste' as const,
          name: '手動新增',
          line: 1,
          rawText: title || '手動新增行程',
        },
      };
  return {
    ...preserved,
    kind: 'events',
    title,
    schoolId,
    location: location || undefined,
    date: draft.date || undefined,
    endDate: draft.endDate || undefined,
    allDay: allDay || undefined,
    startTime: allDay ? undefined : draft.startTime || undefined,
    endTime: allDay ? undefined : draft.endTime || undefined,
  };
}

export function personalEventDraftIssues(row: PersonalImportRow) {
  return validatePersonalImportRow(row).filter((issue) => issue.severity === 'error');
}

export function personalEventSaveError(error: unknown) {
  return personalImportErrorMessage(error, '這次沒有存成，草稿還在，請稍後再試。');
}

export function personalEventPersistenceCopy(syncEnabled: boolean) {
  return syncEnabled
    ? '會先存在這台裝置；開啟同步後，同一帳號的其他裝置才看得到。'
    : '目前只存在這台裝置，換裝置或清除資料就會不見。';
}

export function personalEventSourceLabel(row: Pick<PersonalImportRecord, 'source'>): string {
  const name = row.source.name?.trim();
  if (!name || name === '手動新增') return '手動新增';
  return `自行匯入 · ${name}`;
}

export function personalEventExportNotice(count: number) {
  return `已匯出 ${count} 筆個人行程快照（Asia/Taipei）。不會代你報名或設定提醒。`;
}

export function filterPersonalEvents(records: readonly PersonalImportRecord[], month = '') {
  return records
    .filter(
      (row) =>
        row.kind === 'events' &&
        (!month ||
          row.date?.startsWith(month) ||
          (row.date &&
            row.date < `${month}-01` &&
            (row.allDay
              ? (row.endDate || '') > `${month}-01`
              : (row.endDate || '') >= `${month}-01`))),
    )
    .sort((a, b) =>
      `${a.date} ${a.startTime || ''}`.localeCompare(`${b.date} ${b.startTime || ''}`),
    );
}
