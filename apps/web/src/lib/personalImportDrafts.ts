'use client';

import type {
  ImportIssue,
  PersonalImportBackupPreview,
  PersonalImportKind,
  PersonalImportRow,
  PersonalImportSource,
} from '@campus/shared';
import { personalImportsStorageKey, type PersonalImportScope } from './personalImports';

export type PersonalImportDraft = {
  kind: PersonalImportKind;
  year: string;
  semester: string;
  text: string;
  source: Pick<PersonalImportSource, 'type' | 'name'>;
  rows: PersonalImportRow[];
  excluded: string[];
  parseIssues: ImportIssue[];
  backup: Omit<PersonalImportBackupPreview, 'rows'> | null;
};

const KINDS = ['timetable', 'grades', 'events'];
const MAX_LENGTH = 8 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const optionalString = (value: unknown) => value === undefined || string(value);

export const personalImportDraftKey = (scope: PersonalImportScope) =>
  `${personalImportsStorageKey(scope)}:draft`;

function validDraft(value: unknown, schoolId: string): value is PersonalImportDraft {
  if (
    !object(value) ||
    !KINDS.includes(String(value.kind)) ||
    ![value.year, value.semester, value.text].every(string) ||
    !object(value.source) ||
    !['paste', 'file', 'screenshot'].includes(String(value.source.type)) ||
    !optionalString(value.source.name) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 2000 ||
    !Array.isArray(value.excluded) ||
    !value.excluded.every(string) ||
    !Array.isArray(value.parseIssues)
  )
    return false;
  const ids = new Set<string>();
  for (const row of value.rows) {
    if (
      !object(row) ||
      !string(row.id) ||
      ids.has(row.id) ||
      row.schoolId !== schoolId ||
      !KINDS.includes(String(row.kind)) ||
      ![row.title, row.academicYear, row.semester].every(string) ||
      !object(row.source) ||
      !['paste', 'file', 'screenshot'].includes(String(row.source.type)) ||
      !string(row.source.rawText) ||
      !optionalString(row.source.name) ||
      typeof row.source.line !== 'number' ||
      !Number.isFinite(row.source.line)
    )
      return false;
    if (
      ![
        'courseCode',
        'teacher',
        'className',
        'location',
        'periodLabel',
        'startTime',
        'endTime',
        'grade',
        'date',
        'endDate',
        'linkedCourseId',
      ].every((key) => optionalString(row[key]))
    )
      return false;
    if (
      !['dayOfWeek', 'startPeriod', 'endPeriod', 'credits'].every(
        (key) =>
          row[key] === undefined || (typeof row[key] === 'number' && Number.isFinite(row[key])),
      )
    )
      return false;
    if (row.allDay !== undefined && typeof row.allDay !== 'boolean') return false;
    ids.add(row.id);
  }
  if (
    !value.excluded.every((id) => ids.has(id)) ||
    !value.parseIssues.every(
      (issue) =>
        object(issue) &&
        string(issue.code) &&
        string(issue.message) &&
        ['error', 'warning'].includes(String(issue.severity)) &&
        optionalString(issue.rowId) &&
        optionalString(issue.field),
    )
  )
    return false;
  if (value.backup !== null) {
    const backup = value.backup;
    if (
      !object(backup) ||
      backup.schoolId !== schoolId ||
      !string(backup.exportedAt) ||
      !Number.isFinite(Date.parse(backup.exportedAt)) ||
      !object(backup.counts) ||
      !KINDS.every(
        (kind) =>
          typeof backup.counts === 'object' &&
          backup.counts !== null &&
          typeof (backup.counts as Record<string, unknown>)[kind] === 'number',
      ) ||
      !object(backup.proposedLinks) ||
      !Object.values(backup.proposedLinks).every(string)
    )
      return false;
  }
  return true;
}

export function readPersonalImportDraft(scope: PersonalImportScope): PersonalImportDraft | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(personalImportDraftKey(scope));
  } catch {
    throw new Error('瀏覽器無法讀取暫存草稿。這次輸入請先留在本頁，離開前另存原始文字。');
  }
  if (!raw) return null;
  try {
    if (raw.length > MAX_LENGTH) throw new Error();
    const saved: unknown = JSON.parse(raw);
    if (!object(saved) || saved.version !== 1 || !validDraft(saved.draft, scope.schoolId))
      throw new Error();
    return saved.draft;
  } catch {
    throw new Error(
      '上次的暫存草稿無法還原，原始暫存仍保留。清除草稿後可重新帶入；已匯入的紀錄不受影響。',
    );
  }
}

export function writePersonalImportDraft(scope: PersonalImportScope, draft: PersonalImportDraft) {
  try {
    if (!draft.text && !draft.rows.length) {
      sessionStorage.removeItem(personalImportDraftKey(scope));
      return;
    }
    const content = JSON.stringify({ version: 1, draft });
    if (content.length > MAX_LENGTH) throw new Error();
    sessionStorage.setItem(personalImportDraftKey(scope), content);
  } catch {
    throw new Error('草稿暫存沒有成功。內容仍在本頁，請完成匯入或另存原始文字後再離開。');
  }
}

export function clearPersonalImportDraft(scope: PersonalImportScope) {
  try {
    sessionStorage.removeItem(personalImportDraftKey(scope));
  } catch {
    throw new Error('無法清除暫存草稿，請保留本頁並稍後重試。');
  }
}
