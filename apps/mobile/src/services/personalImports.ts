import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createPersonalImportId,
  planPersonalImport,
  personalImportKey,
  mapPersonalImportPeriods,
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
};
export const personalImportStorageKey = (scope: PersonalImportScope) =>
  `campus.personal-imports.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
const empty = (): PersonalImportLedger => ({ version: 1, records: [], batches: [] });
const locks = new Map<string, Promise<unknown>>();

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
          periodProfile: scope.schoolId === 'pu' ? 'pu' : undefined,
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
  return value;
}

function mutate<T>(
  scope: PersonalImportScope,
  active: () => boolean,
  update: (ledger: PersonalImportLedger) => { ledger: PersonalImportLedger; result: T },
): Promise<T> {
  const key = personalImportStorageKey(scope);
  const previous = locks.get(key) || Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
      const current = await loadPersonalImports(scope);
      if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
      const { ledger, result } = update(current);
      await AsyncStorage.setItem(key, JSON.stringify(ledger));
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

export function appendPersonalImports(
  scope: PersonalImportScope,
  rows: PersonalImportRow[],
  active = () => true,
) {
  return mutate(scope, active, (current) => {
    if (rows.some((row) => row.schoolId !== scope.schoolId))
      throw new Error('資料的學校與目前選擇不同。');
    const id = createPersonalImportId();
    const createdAt = new Date().toISOString();
    const planned = planPersonalImport(current.records, rows, {
      batchId: id,
      importedAt: createdAt,
      periodProfile: scope.schoolId === 'pu' ? 'pu' : undefined,
    });
    const errors = planned.issues.filter(
      (issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict',
    );
    if (errors.length) throw new Error(`這次沒有儲存。${errors[0].message}`);
    const ledger: PersonalImportLedger = {
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
      periodProfile: scope.schoolId === 'pu' ? 'pu' : undefined,
    }).filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(errors[0].message);
    const mapped = mapPersonalImportPeriods(next, {
      periodProfile: scope.schoolId === 'pu' ? 'pu' : undefined,
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
    const ledger = {
      ...current,
      records: current.records.map((row, i) => (i === index ? record : row)),
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

/** The legacy grid uses Providence period times. Never invent equivalent times for another school. */
export function personalImportCourses(
  records: PersonalImportRecord[],
  schoolId: string,
): PersonalCourse[] {
  if (schoolId !== 'pu') return [];
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
        row.endPeriod! <= 13,
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
        !legacy.some(
          (old) =>
            old.name === course.name &&
            old.day === course.day &&
            old.start === course.start &&
            old.end === course.end,
        ),
    ),
  ];
}
