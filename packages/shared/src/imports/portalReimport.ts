import { personalImportKey } from './records';
import { mapPersonalImportPeriods, validatePersonalImportRow } from './validation';
import { PERSONAL_IMPORT_MAX_ROWS, type PersonalImportOptions, type PersonalImportRecord, type PersonalImportRow } from './types';

export type ReimportChoice = 'keep' | 'replace';
export type ReimportEntry = {
  row: PersonalImportRow;
  status: 'new' | 'duplicate' | 'change' | 'ambiguous';
  before?: PersonalImportRecord;
  next?: PersonalImportRow;
  differences: Array<{ label: string; before: string; after: string }>;
};
export type PortalReimportPlan = { entries: ReimportEntry[] };
const fields = {
  title: '課程名稱', courseCode: '課號', className: '班別', teacher: '教師',
  location: '教室', dayOfWeek: '星期', startPeriod: '開始節次格位', endPeriod: '結束節次格位',
  periodLabel: '原始節次', startTime: '開始時間', endTime: '結束時間', credits: '學分', grade: '成績',
} as const;
const schedule = ['dayOfWeek', 'startPeriod', 'endPeriod', 'periodLabel', 'startTime', 'endTime'] as const;
const normalize = (value: unknown): string => value == null ? '' : String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
const display = (value: unknown) => normalize(value) || '未提供';
function equivalent(field: string, a: unknown, b: unknown): boolean {
  const x = normalize(a), y = normalize(b);
  if (field === 'grade' && /^\d+(?:\.\d+)?$/.test(x) && /^\d+(?:\.\d+)?$/.test(y)) return Number(x) === Number(y);
  return x === y;
}
function related(a: PersonalImportRow, b: PersonalImportRow): boolean {
  if (a.kind !== b.kind || a.schoolId !== b.schoolId || a.academicYear !== b.academicYear || a.semester !== b.semester) return false;
  const ac = normalize(a.courseCode), bc = normalize(b.courseCode);
  if (ac && bc ? ac !== bc : normalize(a.title) !== normalize(b.title)) return false;
  const aClass = normalize(a.className), bClass = normalize(b.className);
  return !aClass || !bClass || aClass === bClass;
}
/** Keep missing metadata and the user's course link; never retain stale clocks after a new schedule. */
function proposal(before: PersonalImportRecord, row: PersonalImportRow): PersonalImportRow {
  const next: PersonalImportRow = { ...before, source: { ...row.source } };
  if (row.kind === 'timetable') for (const key of schedule) delete next[key];
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    const value = row[key];
    if (value !== undefined && normalize(value) !== '') Object.assign(next, { [key]: value });
  }
  next.id = before.id;
  next.linkedCourseId = before.linkedCourseId;
  return next;
}
function differences(before: PersonalImportRow, after: PersonalImportRow): ReimportEntry['differences'] {
  return (Object.keys(fields) as Array<keyof typeof fields>).flatMap((key) =>
    equivalent(key, before[key], after[key]) ? [] : [{ label: fields[key], before: display(before[key]), after: display(after[key]) }]);
}
function sameIncoming(a: PersonalImportRow, b: PersonalImportRow): boolean {
  return personalImportKey(a) === personalImportKey(b) && differences(a, b).length === 0 && a.linkedCourseId === b.linkedCourseId;
}

/** Suggestions only. No deletion, guessed pairing, writes, or authorization derived from imported data. */
export function planPortalReimport(
  existing: readonly PersonalImportRecord[], incoming: readonly PersonalImportRow[], schoolId: string,
  options: Pick<PersonalImportOptions, 'periodProfile'> = {},
): PortalReimportPlan {
  if (!schoolId || incoming.length > PERSONAL_IMPORT_MAX_ROWS || existing.length > 2_000) throw new Error('資料筆數或校園範圍不符，請重新核對。');
  if (new Set(incoming.map((row) => row.id)).size !== incoming.length || new Set(existing.map((row) => row.id)).size !== existing.length) throw new Error('資料識別碼重複，請重新建立預覽。');
  if (existing.some((row) => row.schoolId !== schoolId)) throw new Error('原有資料的校園範圍不符。');
  const rows = incoming.map((row) => {
    if (row.schoolId !== schoolId || !['grades', 'timetable'].includes(row.kind)) throw new Error('只能核對目前校園的課表與成績。');
    if (!row.source || !['paste', 'file', 'screenshot'].includes(row.source.type) || !Number.isInteger(row.source.line) || row.source.line < 1 || typeof row.source.rawText !== 'string') throw new Error('資料來源不完整，請重新建立預覽。');
    const mapped = mapPersonalImportPeriods(row, options);
    const error = validatePersonalImportRow(mapped, options).find((issue) => issue.severity === 'error');
    if (error) throw new Error(error.message);
    return mapped;
  });
  const unique: PersonalImportRow[] = [];
  const duplicateIds = new Set<string>();
  for (const row of rows) {
    if (unique.some((old) => sameIncoming(old, row))) duplicateIds.add(row.id);
    else unique.push(row);
  }
  const entries = rows.map((row): ReimportEntry => {
    if (duplicateIds.has(row.id)) return { row, status: 'duplicate', differences: [] };
    const candidates = existing.filter((old) => related(old, row));
    const exact = candidates.filter((old) => personalImportKey(old) === personalImportKey(row) && differences(old, proposal(old, row)).length === 0);
    if (exact.length === 1) return { row, status: 'duplicate', before: exact[0], differences: [] };
    const siblings = unique.filter((other) => related(row, other));
    if (!candidates.length && siblings.length === 1) return { row, status: 'new', differences: [] };
    // Missing class/code, overlapping incoming rows, and multi-meeting courses cannot be guessed.
    if (candidates.length !== 1 || siblings.length !== 1 ||
      (!!normalize(candidates[0].className) !== !!normalize(row.className))) return { row, status: 'ambiguous', differences: [] };
    const before = candidates[0];
    const next = proposal(before, row);
    const error = validatePersonalImportRow(next, options).find((issue) => issue.severity === 'error');
    if (error) return { row, status: 'ambiguous', differences: [] };
    const changes = differences(before, next);
    return changes.length ? { row, before, next, status: 'change', differences: changes }
      : { row, before, status: 'duplicate', differences: [] };
  });
  return { entries };
}

/** Every differing/ambiguous row requires a deliberate decision; unchanged rows are never rewritten. */
export function resolvePortalReimport(plan: PortalReimportPlan, choices: Readonly<Record<string, ReimportChoice>>) {
  const added: PersonalImportRow[] = [];
  const replacements: Array<{ before: PersonalImportRecord; next: PersonalImportRow }> = [];
  let duplicates = 0, kept = 0;
  for (const entry of plan.entries) {
    if (entry.status === 'new') { added.push(entry.row); continue; }
    if (entry.status === 'duplicate') { duplicates++; continue; }
    const choice = choices[entry.row.id];
    if (choice === 'keep') { kept++; continue; }
    if (entry.status === 'change' && choice === 'replace' && entry.before && entry.next) {
      replacements.push({ before: entry.before, next: entry.next }); continue;
    }
    throw new Error('請逐筆確認差異；無法唯一配對的資料只能保留舊紀錄。');
  }
  if (new Set(replacements.map((item) => item.before.id)).size !== replacements.length) throw new Error('多筆資料指向同一筆舊紀錄，請分開核對。');
  return { added, replacements, duplicates, kept };
}
