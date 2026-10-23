import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parsePersonalImportSyncState,
  type PersonalImportSyncState,
} from '@campus/shared/src/imports/sync';
import {
  createPersonalImportId,
  periodCount,
  periodProfileForSchool,
  planPersonalImport,
  preparePersonalImportBackupRestore,
  PERSONAL_IMPORT_BACKUP_MAX_RECORDS,
  personalImportKey,
  mapPersonalImportPeriods,
  samePersonalCourse,
  validatePersonalImportRow,
  type PersonalImportRow,
  type PersonalImportRecord,
  type PersonalCourse,
} from '@campus/shared';

export type PersonalImportScope = { owner: string; schoolId: string };
export type PersonalImportLedger = {
  version: 1;
  records: PersonalImportRecord[];
  batches: Array<{ id: string; createdAt: string; count: number }>;
  sync?: PersonalImportSyncState;
};
export const personalImportStorageKey = (scope: PersonalImportScope) =>
  `campus.personal-imports.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
const empty = (): PersonalImportLedger => ({ version: 1, records: [], batches: [] });
const locks = new Map<string, Promise<unknown>>();
type ImportChange = { scope: PersonalImportScope; source: 'local' | 'sync' };
const listeners = new Set<(change: ImportChange) => void>();
export function subscribePersonalImports(listener: (change: ImportChange) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function retainActiveBatches(
  batches: PersonalImportLedger['batches'],
  records: PersonalImportRecord[],
): PersonalImportLedger['batches'] {
  const activeIds = new Set(records.map((row) => row.batchId));
  return batches.filter((batch) => activeIds.has(batch.id));
}

/** Read after pending writes so a shared backup never uses an out-of-date UI snapshot. */
export async function snapshotPersonalImports(
  scope: PersonalImportScope,
  active = () => true,
): Promise<PersonalImportLedger> {
  await (locks.get(personalImportStorageKey(scope)) || Promise.resolve()).catch(() => undefined);
  if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
  const snapshot = await loadPersonalImports(scope);
  if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
  return snapshot;
}

export async function loadPersonalImports(
  scope: PersonalImportScope,
): Promise<PersonalImportLedger> {
  const raw = await AsyncStorage.getItem(personalImportStorageKey(scope));
  if (!raw) return empty();
  const value = JSON.parse(raw) as PersonalImportLedger;
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.batches) ||
    value.records.some(
      (row) =>
        !row ||
        row.schoolId !== scope.schoolId ||
        typeof row.id !== 'string' ||
        typeof row.batchId !== 'string' ||
        !row.batchId.trim() ||
        typeof row.importedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.importedAt)) ||
        !row.source ||
        !['paste', 'file', 'screenshot'].includes(row.source.type) ||
        !Number.isInteger(row.source.line) ||
        row.source.line < 1 ||
        typeof row.source.rawText !== 'string' ||
        (row.source.name !== undefined && typeof row.source.name !== 'string') ||
        validatePersonalImportRow(row, {
          periodProfile: periodProfileForSchool(scope.schoolId),
        }).some((issue) => issue.severity === 'error'),
    ) ||
    new Set(value.records.map((row) => row.id)).size !== value.records.length ||
    value.batches.some(
      (batch) =>
        !batch ||
        typeof batch.id !== 'string' ||
        !batch.id.trim() ||
        typeof batch.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(batch.createdAt)) ||
        !Number.isInteger(batch.count) ||
        batch.count <= 0,
    )
  ) {
    throw new Error('儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。');
  }
  if (value.sync !== undefined)
    value.sync = parsePersonalImportSyncState(value.sync, scope.schoolId);
  return value;
}

export function mutatePersonalImportLedger<T>(
  scope: PersonalImportScope,
  active: () => boolean,
  update: (
    ledger: PersonalImportLedger,
    checkpoint: (ledger: PersonalImportLedger) => Promise<void>,
  ) =>
    | { ledger: PersonalImportLedger; result: T }
    | Promise<{ ledger: PersonalImportLedger; result: T }>,
  source: ImportChange['source'] = 'local',
): Promise<T> {
  const key = personalImportStorageKey(scope);
  const previous = locks.get(key) || Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
      const current = await loadPersonalImports(scope);
      if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
      let persisted = current;
      const checkpoint = async (ledger: PersonalImportLedger) => {
        if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
        if (JSON.stringify(persisted) === JSON.stringify(ledger)) return;
        await AsyncStorage.setItem(key, JSON.stringify(ledger));
        persisted = ledger;
        for (const listener of listeners) {
          try {
            listener({ scope, source });
          } catch {
            /* A view cannot invalidate a durable write. */
          }
        }
      };
      const { ledger, result } = await update(current, checkpoint);
      await checkpoint(ledger);
      return result;
    });
  locks.set(key, task);
  void task
    .finally(() => {
      if (locks.get(key) === task) locks.delete(key);
    })
    .catch(() => undefined);
  return task;
}
const mutate = mutatePersonalImportLedger;

export function appendPersonalImports(
  scope: PersonalImportScope,
  rows: PersonalImportRow[],
  active = () => true,
  options: { restoreBackup?: boolean } = {},
) {
  return mutate(scope, active, (current) => {
    if (rows.some((row) => row.schoolId !== scope.schoolId))
      throw new Error('資料的學校與目前選擇不同。');
    const id = createPersonalImportId();
    const createdAt = new Date().toISOString();
    const incoming = options.restoreBackup
      ? preparePersonalImportBackupRestore(rows, current.records)
      : rows;
    const planned = planPersonalImport(current.records, incoming, {
      batchId: id,
      importedAt: createdAt,
      periodProfile: periodProfileForSchool(scope.schoolId),
    });
    const errors = planned.issues.filter(
      (issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict',
    );
    if (errors.length) throw new Error(`這次沒有儲存。${errors[0].message}`);
    if (planned.records.length > PERSONAL_IMPORT_BACKUP_MAX_RECORDS)
      throw new Error('這台裝置已達 2,000 筆上限，請先備份並移除不需要的紀錄。');
    const ledger: PersonalImportLedger = {
      ...current,
      version: 1,
      records: planned.records,
      batches: planned.added.length
        ? [...current.batches, { id, createdAt, count: planned.added.length }]
        : current.batches,
    };
    return {
      ledger,
      result: { ledger, added: planned.added.length, duplicates: planned.duplicates.length },
    };
  });
}

/** A later edit gets a new revision owner, so undoing its original batch cannot remove it. */
export function editPersonalImport(
  scope: PersonalImportScope,
  before: PersonalImportRecord,
  next: PersonalImportRow,
  active = () => true,
) {
  return mutate(scope, active, (current) => {
    const index = current.records.findIndex((row) => row.id === before.id);
    if (index < 0 || JSON.stringify(current.records[index]) !== JSON.stringify(before)) {
      throw new Error('這筆資料已變更，請重新載入後編輯。');
    }
    if (next.id !== before.id || next.schoolId !== scope.schoolId)
      throw new Error('資料範圍不符。');
    const errors = validatePersonalImportRow(next, {
      periodProfile: periodProfileForSchool(scope.schoolId),
    }).filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(errors[0].message);
    const mapped = mapPersonalImportPeriods(next, {
      periodProfile: periodProfileForSchool(scope.schoolId),
    });
    if (
      current.records.some(
        (row) => row.id !== before.id && personalImportKey(row) === personalImportKey(mapped),
      )
    )
      throw new Error('已有相同資料，請核對後再更新。');
    const record: PersonalImportRecord = {
      ...mapped,
      batchId: `revision:${createPersonalImportId()}`,
      importedAt: before.importedAt,
    };
    const records = current.records.map((row, i) => (i === index ? record : row));
    const ledger = {
      ...current,
      records,
      batches: retainActiveBatches(current.batches, records),
    };
    return { ledger, result: ledger };
  });
}

/** Remove one exact revision, never another tab's newer edit or a different school's row. */
export function deletePersonalImport(
  scope: PersonalImportScope,
  before: PersonalImportRecord,
  active = () => true,
) {
  return mutate(scope, active, (current) => {
    const found = current.records.find((row) => row.id === before.id);
    if (!found || JSON.stringify(found) !== JSON.stringify(before)) {
      throw new Error('這筆資料已變更，請重新載入後再移除。');
    }
    if (found.schoolId !== scope.schoolId) throw new Error('資料範圍不符。');
    const records = current.records.filter((row) => row.id !== before.id);
    const ledger = {
      ...current,
      records,
      batches: retainActiveBatches(current.batches, records),
    };
    return { ledger, result: ledger };
  });
}

export function undoLastPersonalImport(
  scope: PersonalImportScope,
  expectedBatchId: string,
  active = () => true,
) {
  return mutate(scope, active, (current) => {
    const last = current.batches[current.batches.length - 1];
    if (!last || last.id !== expectedBatchId)
      throw new Error('匯入紀錄已更新，請重新載入後再撤回。');
    const records = current.records.filter((row) => row.batchId !== last.id);
    const ledger = { ...current, records, batches: current.batches.slice(0, -1) };
    return { ledger, result: { ledger, removed: current.records.length - records.length } };
  });
}

/** The grid uses the school's official period table. Unknown schools stay off the grid. */
export function personalImportCourses(
  records: PersonalImportRecord[],
  schoolId: string,
): PersonalCourse[] {
  const profile = periodProfileForSchool(schoolId);
  if (!profile) return [];
  const slots = periodCount(profile);
  return records
    .filter(
      (row) =>
        row.kind === 'timetable' &&
        row.schoolId === schoolId &&
        Number.isInteger(row.dayOfWeek) &&
        row.dayOfWeek! >= 1 &&
        row.dayOfWeek! <= 5 &&
        Number.isInteger(row.startPeriod) &&
        Number.isInteger(row.endPeriod) &&
        row.startPeriod! >= 1 &&
        row.endPeriod! >= row.startPeriod! &&
        row.endPeriod! <= slots,
    )
    .map((row) => ({
      id: `import:${row.id}`,
      name: row.title,
      day: row.dayOfWeek!,
      start: row.startPeriod!,
      end: row.endPeriod!,
      teacher: row.teacher || '',
      room: row.location || '',
      color: 'blue',
    }));
}

/** Unknown or different academic terms must never be combined into one busy-time view. */
export function selectPersonalTimetableCourses(
  base: { courses: PersonalCourse[]; meta: { year: string; semester: string } } | null,
  imported: PersonalImportRecord[],
  schoolId: string,
  selectedView: string | undefined,
): PersonalCourse[] {
  const baseTerm =
    base?.meta.year && base.meta.semester ? `${base.meta.year}／${base.meta.semester}` : '';
  const term = selectedView === 'legacy' ? baseTerm : selectedView;
  const legacy =
    selectedView === 'legacy' || (baseTerm && term === baseTerm) ? base?.courses || [] : [];
  const projected = term
    ? personalImportCourses(
        imported.filter((row) => `${row.academicYear}／${row.semester}` === term),
        schoolId,
      )
    : [];
  return [
    ...legacy,
    ...projected.filter(
      (course) =>
        !legacy.some((old) => samePersonalCourse(old, course)),
    ),
  ];
}
