'use client';

import type {
  ImportIssue,
  PersonalImportBackupPreview,
  PersonalImportDocument,
  PersonalImportKind,
  PersonalImportRow,
  PersonalImportSource,
} from '@campus/shared';
import { validatePersonalImportDocument } from '@campus/shared';
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
  document?: PersonalImportDocument | null;
  documentSelection?: { selected: string[]; headers: Record<string, number> } | null;
};

const KINDS = ['timetable', 'grades', 'events'];
const MAX_BYTES = 8 * 1024 * 1024;
const tooLarge = (text: string) =>
  text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const optionalString = (value: unknown) => value === undefined || string(value);

export const personalImportDraftKey = (scope: PersonalImportScope) =>
  `${personalImportsStorageKey(scope)}:draft`;
export const personalImportPartialDraftKey = (scope: PersonalImportScope) =>
  `${personalImportDraftKey(scope)}:partial`;

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
  if (value.document != null) {
    let document: PersonalImportDocument;
    try {
      document = validatePersonalImportDocument(value.document);
    } catch {
      return false;
    }
    if (value.rows.length || value.backup) return false;
    const selection = value.documentSelection;
    if (selection != null) {
      if (
        !object(selection) ||
        !Array.isArray(selection.selected) ||
        !selection.selected.every(string) ||
        new Set(selection.selected).size !== selection.selected.length ||
        !object(selection.headers)
      ) return false;
      const headers = selection.headers;
      for (const id of selection.selected) {
        const section = document.sections.find((item) => item.id === id);
        if (!section || section.needsOcr || !section.rows.length) return false;
      }
      for (const [id, line] of Object.entries(headers)) {
        const section = document.sections.find((item) => item.id === id);
        if (!section || !Number.isSafeInteger(line) ||
          (section.rows.length ? !section.rows.some((row) => row.line === line) : line !== 1))
          return false;
      }
      if (!selection.selected.every((id) => id in headers)) return false;
    }
  } else if (value.documentSelection != null) {
    return false;
  }
  return true;
}

function readDraft(scope: PersonalImportScope, key: string): PersonalImportDraft | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    throw new Error('瀏覽器無法讀取暫存草稿。這次輸入請先留在本頁，離開前另存原始文字。');
  }
  if (!raw) return null;
  try {
    if (tooLarge(raw)) throw new Error();
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

export function readPersonalImportDraft(scope: PersonalImportScope): PersonalImportDraft | null {
  return readDraft(scope, personalImportDraftKey(scope));
}

export function readPersonalImportPartialDraft(scope: PersonalImportScope): PersonalImportDraft | null {
  return readDraft(scope, personalImportPartialDraftKey(scope));
}

function writeDraft(key: string, draft: PersonalImportDraft) {
  try {
    if (!draft.text && !draft.rows.length && !draft.document) {
      sessionStorage.removeItem(key);
      return;
    }
    const content = JSON.stringify({ version: 1, draft });
    if (tooLarge(content)) throw new Error();
    sessionStorage.setItem(key, content);
  } catch {
    throw new Error('草稿暫存沒有成功。內容仍在本頁，請完成匯入或另存原始文字後再離開。');
  }
}

export function writePersonalImportDraft(scope: PersonalImportScope, draft: PersonalImportDraft) {
  writeDraft(personalImportDraftKey(scope), draft);
}

export function writePersonalImportPartialDraft(scope: PersonalImportScope, draft: PersonalImportDraft) {
  writeDraft(personalImportPartialDraftKey(scope), draft);
}

export function clearPersonalImportPartialDraft(scope: PersonalImportScope) {
  try {
    sessionStorage.removeItem(personalImportPartialDraftKey(scope));
  } catch {
    throw new Error('無法清除部分結果的暫存，請保留本頁並稍後重試。');
  }
}

export function clearPersonalImportDraft(scope: PersonalImportScope) {
  try {
    sessionStorage.removeItem(personalImportDraftKey(scope));
    sessionStorage.removeItem(personalImportPartialDraftKey(scope));
  } catch {
    throw new Error('無法清除暫存草稿，請保留本頁並稍後重試。');
  }
}
