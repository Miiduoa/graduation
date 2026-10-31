import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImportIssue, PersonalImportOptions, PersonalImportRow } from '@campus/shared';
import { maskPersonalImportText } from '@campus/shared/src/imports/aiCloud';
import type { PersonalImportAiTextBatch } from '@campus/shared/src/imports/aiTextBatches';
import type { PersonalImportScope } from '../personalImports';

export type PersonalImportDraft = {
  text: string;
  options: PersonalImportOptions;
  rows: PersonalImportRow[];
  selected?: string[];
  issues: ImportIssue[];
  retryBatches: PersonalImportAiTextBatch[];
};
const keyFor = (scope: PersonalImportScope) =>
  `campus.personal-import-draft.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
const writes = new Map<string, Promise<void>>();

export function savePersonalImportDraft(
  scope: PersonalImportScope,
  draft: PersonalImportDraft | null,
): Promise<void> {
  const key = keyFor(scope);
  const serialized = draft ? JSON.stringify(draft) : null;
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      serialized ? AsyncStorage.setItem(key, serialized) : AsyncStorage.removeItem(key),
    );
  writes.set(key, write);
  void write
    .finally(() => {
      if (writes.get(key) === write) writes.delete(key);
    })
    .catch(() => {});
  return write;
}

export async function loadPersonalImportDraft(
  scope: PersonalImportScope,
): Promise<PersonalImportDraft | null> {
  const key = keyFor(scope);
  await writes.get(key)?.catch(() => {});
  const raw = await AsyncStorage.getItem(key);
  if (!raw || raw.length > 1_000_000) return null;
  try {
    const draft = JSON.parse(raw) as PersonalImportDraft;
    if (
      typeof draft.text !== 'string' ||
      draft.text.length > 40_000 ||
      draft.options?.schoolId !== scope.schoolId ||
      !['grades', 'timetable', 'events'].includes(draft.options.kind) ||
      typeof draft.options.academicYear !== 'string' ||
      typeof draft.options.semester !== 'string' ||
      (draft.options.source !== undefined &&
        (!['paste', 'file', 'screenshot'].includes(draft.options.source.type) ||
          (draft.options.source.name !== undefined &&
            typeof draft.options.source.name !== 'string'))) ||
      !Array.isArray(draft.rows) ||
      draft.rows.length > 500 ||
      new Set(draft.rows.map((row) => row?.id)).size !== draft.rows.length ||
      !draft.rows.every(
        (row) =>
          row &&
          row.schoolId === scope.schoolId &&
          typeof row.id === 'string' &&
          typeof row.title === 'string' &&
          row.kind === draft.options.kind &&
          typeof row.academicYear === 'string' &&
          typeof row.semester === 'string' &&
          row.source &&
          typeof row.source.rawText === 'string' &&
          Number.isSafeInteger(row.source.line) &&
          row.source.line > 0 &&
          ['paste', 'file', 'screenshot'].includes(row.source.type) &&
          (row.source.name === undefined || typeof row.source.name === 'string'),
      ) ||
      (draft.selected !== undefined &&
        (!Array.isArray(draft.selected) ||
          !draft.selected.every(
            (id) => typeof id === 'string' && draft.rows.some((row) => row.id === id),
          ))) ||
      !Array.isArray(draft.issues) ||
      !draft.issues.every(
        (issue) =>
          issue &&
          typeof issue.message === 'string' &&
          typeof issue.code === 'string' &&
          ['error', 'warning'].includes(issue.severity),
      ) ||
      !Array.isArray(draft.retryBatches) ||
      draft.retryBatches.length > 80 ||
      !draft.retryBatches.every(
        (batch) =>
          batch &&
          typeof batch.text === 'string' &&
          Number.isSafeInteger(batch.startLine) &&
          batch.startLine > 0 &&
          batch.text.length <= 40_000 &&
          (batch.columnContext === undefined || typeof batch.columnContext === 'string') &&
          (!batch.recordStarts ||
            (Array.isArray(batch.recordStarts) &&
              batch.recordStarts.every(
                (offset, index) =>
                  Number.isSafeInteger(offset) &&
                  offset >= 0 &&
                  offset < batch.text.length &&
                  (!index || offset > batch.recordStarts![index - 1]),
              ))) &&
          [draft.text, maskPersonalImportText(draft.text)].some((source) =>
            source
              .split('\n')
              .slice(batch.startLine - 1)
              .join('\n')
              .startsWith(batch.text),
          ),
      )
    )
      return null;
    return draft;
  } catch {
    return null;
  }
}
