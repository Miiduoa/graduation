import AsyncStorage from '@react-native-async-storage/async-storage';

// Serialize writes across screen remounts, so a returning screen reads the latest edit.
const pending = new Map<string, Promise<void>>();
export async function readImportReviewDraft(key: string) {
  await pending.get(key)?.catch(() => {});
  return AsyncStorage.getItem(key);
}
export function writeImportReviewDraft(key: string, value: string | null) {
  const next = (pending.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value));
  pending.set(key, next);
  void next
    .finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    })
    .catch(() => {});
  return next;
}

// Only a recognized, empty draft may be discarded; unknown/corrupt data stays protected.
export function isEmptyImportReviewDraft(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  const source = draft.source as Record<string, unknown> | null;
  return Object.keys(draft).every((key) => [
    'version', 'kind', 'academicYear', 'semester', 'text', 'source',
    'rows', 'issues', 'selected', 'editedIds', 'backupPreview',
  ].includes(key)) &&
    draft.version === 1 &&
    ['timetable', 'grades', 'events'].includes(draft.kind as string) &&
    [draft.academicYear, draft.semester, draft.text].every(
      (field) => typeof field === 'string',
    ) &&
    !(draft.text as string).trim() &&
    !!source && Object.keys(source).every((key) => ['type', 'name'].includes(key)) &&
    source.type === 'paste' &&
    (source.name === undefined || source.name === '') &&
    ['rows', 'issues', 'selected'].every(
      (field) => Array.isArray(draft[field]) && draft[field].length === 0,
    ) &&
    (draft.editedIds === undefined ||
      (Array.isArray(draft.editedIds) && draft.editedIds.length === 0)) &&
    (draft.backupPreview === undefined || draft.backupPreview === null);
}

export function hasImportReviewDraft(raw: string | null): boolean {
  if (raw === null) return false;
  try { return !isEmptyImportReviewDraft(JSON.parse(raw)); }
  catch { return true; }
}
