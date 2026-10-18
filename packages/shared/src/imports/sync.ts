import { validatePersonalImportBackupRecords } from './backup';
import { personalImportKey } from './records';
import type { PersonalImportRecord } from './types';

export const PERSONAL_IMPORT_SYNC_BODY_LIMIT = 8 * 1024 * 1024 + 16 * 1024;
export type PersonalImportSnapshot = {
  schoolId: string;
  revision: number;
  records: PersonalImportRecord[];
  updatedAt: string | null;
  detachedCourseLinks?: string[];
};
export type PersonalImportPendingMutation = {
  mutationId: string;
  expectedRevision: number;
  records: PersonalImportRecord[];
};
export type PersonalImportSyncState = {
  enabled: boolean;
  base: PersonalImportSnapshot | null;
  pending?: PersonalImportPendingMutation;
};
export type PersonalImportSyncConflict = {
  key: string;
  reason: 'changed' | 'duplicate' | 'unconfirmed';
  title: string;
  local: PersonalImportRecord[];
  remote: PersonalImportRecord[];
};
export type PersonalImportSyncChoices = Record<string, 'local' | 'remote'>;

export function validatePersonalImportSyncRecords(
  raw: unknown,
  schoolId: string,
): PersonalImportRecord[] {
  const records = validatePersonalImportBackupRecords(raw, schoolId);
  const keys = new Set<string>();
  for (const record of records) {
    const key = personalImportKey(record);
    if (keys.has(key)) throw new Error('有重複的個人紀錄，請先核對後再同步。');
    keys.add(key);
  }
  return records;
}

export function parsePersonalImportSnapshot(
  raw: unknown,
  schoolId: string,
): PersonalImportSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('同步回應格式不正確，裝置資料仍保留。');
  const value = raw as Record<string, unknown>;
  if (
    value.schoolId !== schoolId ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    (value.updatedAt !== null &&
      (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) ||
    (value.detachedCourseLinks !== undefined &&
      (!Array.isArray(value.detachedCourseLinks) ||
        value.detachedCourseLinks.length > 2000 ||
        value.detachedCourseLinks.some((id) => typeof id !== 'string' || id.length > 300)))
  ) {
    throw new Error('同步資料的校園或版本不正確，裝置資料仍保留。');
  }
  const records = validatePersonalImportSyncRecords(value.records, schoolId);
  if (value.revision === 0 && (records.length || value.updatedAt !== null))
    throw new Error('同步版本不正確。');
  return {
    schoolId,
    revision: value.revision as number,
    records,
    updatedAt: value.updatedAt as string | null,
    ...(value.detachedCourseLinks
      ? { detachedCourseLinks: value.detachedCourseLinks as string[] }
      : {}),
  };
}

/** The pending payload is kept verbatim until the same mutation is acknowledged. */
export function parsePersonalImportSyncState(
  raw: unknown,
  schoolId: string,
): PersonalImportSyncState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('同步紀錄無法讀取，原有資料仍保留，請先匯出備份。');
  const value = raw as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean' || !Object.hasOwn(value, 'base'))
    throw new Error('同步紀錄無法讀取，原有資料仍保留，請先匯出備份。');
  const base = value.base === null ? null : parsePersonalImportSnapshot(value.base, schoolId);
  let pending: PersonalImportPendingMutation | undefined;
  if (value.pending !== undefined) {
    if (!value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending))
      throw new Error('待確認的同步紀錄無法讀取，原有資料仍保留。');
    const candidate = value.pending as Record<string, unknown>;
    if (
      Object.keys(candidate).some(
        (key) => !['mutationId', 'expectedRevision', 'records'].includes(key),
      ) ||
      typeof candidate.mutationId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,100}$/u.test(candidate.mutationId) ||
      !Number.isSafeInteger(candidate.expectedRevision) ||
      (candidate.expectedRevision as number) < 0 ||
      (candidate.expectedRevision as number) >= 2_147_483_647 ||
      (base && (candidate.expectedRevision as number) < base.revision)
    )
      throw new Error('待確認的同步紀錄無法讀取，原有資料仍保留。');
    pending = {
      mutationId: candidate.mutationId,
      expectedRevision: candidate.expectedRevision as number,
      records: validatePersonalImportSyncRecords(candidate.records, schoolId),
    };
  }
  return { enabled: value.enabled, base, ...(pending ? { pending } : {}) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
export function personalImportRecordsEqual(
  left: readonly PersonalImportRecord[],
  right: readonly PersonalImportRecord[],
): boolean {
  return (
    canonical([...left].sort((a, b) => a.id.localeCompare(b.id))) ===
    canonical([...right].sort((a, b) => a.id.localeCompare(b.id)))
  );
}
function same(
  left: PersonalImportRecord | undefined,
  right: PersonalImportRecord | undefined,
): boolean {
  return canonical(left) === canonical(right);
}
function content(record: PersonalImportRecord): string {
  const { id, batchId, importedAt, source, ...fields } = record;
  void id;
  void batchId;
  void importedAt;
  void source;
  return canonical(fields);
}

/** Three-way merge: deletion is represented by absence relative to the acknowledged base. */
export function mergePersonalImportRecords(
  base: readonly PersonalImportRecord[],
  local: readonly PersonalImportRecord[],
  remote: readonly PersonalImportRecord[],
  choices: PersonalImportSyncChoices = {},
): { records: PersonalImportRecord[]; conflicts: PersonalImportSyncConflict[] } {
  const previous = new Map(base.map((row) => [row.id, row]));
  const here = new Map(local.map((row) => [row.id, row]));
  const there = new Map(remote.map((row) => [row.id, row]));
  const merged: PersonalImportRecord[] = [];
  const conflicts: PersonalImportSyncConflict[] = [];
  for (const id of new Set([...previous.keys(), ...here.keys(), ...there.keys()])) {
    const b = previous.get(id),
      l = here.get(id),
      r = there.get(id);
    let selected: PersonalImportRecord | undefined;
    if (same(l, r)) selected = r;
    else if (same(l, b)) selected = r;
    else if (same(r, b)) selected = l;
    else {
      const key = `record:${id}`;
      if (choices[key]) selected = choices[key] === 'local' ? l : r;
      else
        conflicts.push({
          key,
          reason: 'changed',
          title: (l || r || b)!.title,
          local: l ? [l] : [],
          remote: r ? [r] : [],
        });
    }
    if (selected) merged.push(selected);
  }
  const groups = new Map<string, PersonalImportRecord[]>();
  for (const row of merged) {
    const key = personalImportKey(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const records: PersonalImportRecord[] = [];
  for (const [identity, group] of groups) {
    const first = group[0];
    if (!first) continue;
    if (group.length === 1) {
      records.push(first);
      continue;
    }
    if (group.every((row) => content(row) === content(first))) {
      // Acknowledged server identity wins when two devices independently import the same row.
      records.push(group.find((row) => there.has(row.id)) || first);
      continue;
    }
    const key = `duplicate:${identity}`;
    const l = local.filter((row) => personalImportKey(row) === identity);
    const r = remote.filter((row) => personalImportKey(row) === identity);
    if (choices[key]) records.push(...(choices[key] === 'local' ? l : r));
    else
      conflicts.push({
        key,
        reason: 'duplicate',
        title: first.title,
        local: [...l],
        remote: [...r],
      });
  }
  return { records, conflicts };
}

export function personalImportSyncErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'PERSONAL_IMPORT_REVISION_CONFLICT')
    return '另一台裝置剛更新資料，請重新同步並核對差異。';
  if (
    [
      'SIGN_IN_REQUIRED',
      'SESSION_CHANGED',
      'PLATFORM_SESSION_INVALID',
      'UNAUTHORIZED',
      'PERSONAL_IMPORT_SESSION_EXPIRED',
    ].includes(code)
  )
    return '登入狀態已變更，請重新登入後同步；這台裝置的資料仍保留。';
  if (code === 'PERSONAL_IMPORT_SCHOOL_LIMIT')
    return '已達帳號可同步的校園數量上限，這份資料仍保留在裝置。';
  if (['NOT_FOUND', 'IMPORT_SYNC_DISABLED'].includes(code))
    return '帳號同步暫時無法使用，資料已保留在這台裝置。';
  if (error instanceof Error && !code) return error.message;
  return '暫時無法同步，這台裝置的修改仍保留。連線恢復後會再試，也可以下載備份。';
}
