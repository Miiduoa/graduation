import { periodProfileForSchool } from '../timetable/periods';
import { createPersonalImportId, personalImportKey } from './records';
import {
  PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  type PersonalImportKind,
  type PersonalImportRecord,
  type PersonalImportRow,
} from './types';
import {
  isPersonalImportDate,
  isPersonalImportTime,
  validatePersonalImportRow,
} from './validation';

export const PERSONAL_IMPORT_BACKUP_MAX_RECORDS = 2_000;
export const PERSONAL_IMPORT_BACKUP_MAX_BYTES = 8 * 1024 * 1024;
const FORMAT = 'campus-one.personal-import-backup';

export type PersonalImportBackupPreview = {
  schoolId: string;
  exportedAt: string;
  rows: PersonalImportRow[];
  /** Untrusted archive references. The current account must reselect an accessible class. */
  proposedLinks: Record<string, string>;
  counts: Record<PersonalImportKind, number>;
};

const ENVELOPE_FIELDS = ['format', 'version', 'exportedAt', 'schoolId', 'records'] as const;
const SOURCE_FIELDS = ['type', 'name', 'line', 'rawText'] as const;
const RECORD_FIELDS = [
  'id',
  'kind',
  'title',
  'schoolId',
  'academicYear',
  'semester',
  'courseCode',
  'teacher',
  'className',
  'location',
  'dayOfWeek',
  'startPeriod',
  'endPeriod',
  'periodLabel',
  'startTime',
  'endTime',
  'credits',
  'grade',
  'date',
  'endDate',
  'allDay',
  'linkedCourseId',
  'source',
  'batchId',
  'importedAt',
] as const;

function invalid(message = '備份格式不完整或已損毀，沒有還原任何資料。'): never {
  throw new Error(message);
}

function sizeExceeded(): never {
  return invalid('備份超過 8 MiB，請減少資料後再試。沒有還原任何資料。');
}

/** React Native does not require TextEncoder or a Node Buffer polyfill for file limits. */
function utf8Bytes(text: string): number {
  if (text.length > PERSONAL_IMPORT_BACKUP_MAX_BYTES) sizeExceeded();
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > PERSONAL_IMPORT_BACKUP_MAX_BYTES) sizeExceeded();
  }
  return bytes;
}

function objectWithFields(
  value: unknown,
  allowed: readonly string[],
  allowExtraFields = false,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      if (allowExtraFields) continue;
      invalid('備份含有不支援的欄位，請使用 Campus One 匯出的原始備份。');
    }
    const descriptor = descriptors[key];
    if (!('value' in descriptor)) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function boundedString(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}

function validSchoolId(value: unknown): value is string {
  return (
    boundedString(value, 100, true) &&
    value === value.trim() &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match || !isPersonalImportDate(match[1]) || !isPersonalImportTime(match[2])) return false;
  if (Number(match[3]) > 59) return false;
  if (match[4] !== 'Z' && !isPersonalImportTime(match[4].slice(1))) return false;
  return Number.isFinite(Date.parse(value));
}

/** Validate every field before copying: archive input cannot supply identity or executable objects. */
function validatedRecord(
  value: unknown,
  schoolId: string,
  index: number,
  allowExtraFields: boolean,
): PersonalImportRecord {
  const record = objectWithFields(value, RECORD_FIELDS, allowExtraFields);
  const rowError = () => invalid(`第 ${index + 1} 筆備份資料格式不正確，沒有還原任何資料。`);
  if (
    !boundedString(record.id, 300, true) ||
    !boundedString(record.batchId, 300, true) ||
    !validTimestamp(record.importedAt) ||
    record.schoolId !== schoolId ||
    !boundedString(record.academicYear, PERSONAL_IMPORT_MAX_TEXT_LENGTH) ||
    !boundedString(record.semester, PERSONAL_IMPORT_MAX_TEXT_LENGTH)
  )
    rowError();
  // Archive checks enforce scalar types and bounds. Meaning and numeric ranges belong to
  // validatePersonalImportRow below, which applies them only to the relevant record kind.
  for (const field of ['dayOfWeek', 'startPeriod', 'endPeriod', 'credits'] as const) {
    const number = record[field];
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number)))
      rowError();
  }
  for (const field of ['date', 'endDate', 'startTime', 'endTime', 'grade'] as const) {
    if (
      record[field] !== undefined &&
      !boundedString(record[field], PERSONAL_IMPORT_MAX_TEXT_LENGTH)
    )
      rowError();
  }
  const source = objectWithFields(record.source, SOURCE_FIELDS, allowExtraFields);
  if (
    !['paste', 'file', 'screenshot'].includes(source.type as string) ||
    !Number.isSafeInteger(source.line) ||
    (source.line as number) < 1 ||
    !boundedString(source.rawText, PERSONAL_IMPORT_MAX_TEXT_LENGTH) ||
    (source.name !== undefined && !boundedString(source.name, 1_000))
  )
    rowError();
  // Only these whitelisted scalar fields and this source object enter the archive.
  const copy: Record<string, unknown> = {};
  for (const field of RECORD_FIELDS) {
    if (field !== 'source' && record[field] !== undefined) copy[field] = record[field];
  }
  copy.source = Object.fromEntries(
    SOURCE_FIELDS.filter((field) => source[field] !== undefined).map((field) => [
      field,
      source[field],
    ]),
  );
  const typed = copy as PersonalImportRecord;
  if (
    validatePersonalImportRow(typed, {
      periodProfile: periodProfileForSchool(schoolId),
    }).some(
      (issue) => issue.severity === 'error',
    )
  )
    rowError();
  return typed;
}

function validatedRecords(
  value: unknown,
  schoolId: string,
  allowExtraFields = false,
): PersonalImportRecord[] {
  if (!Array.isArray(value)) invalid();
  if (value.length > PERSONAL_IMPORT_BACKUP_MAX_RECORDS)
    invalid('一份備份最多包含 2,000 筆資料，沒有還原任何資料。');
  const ids = new Set<string>();
  const records: PersonalImportRecord[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) invalid();
    const record = validatedRecord(descriptor.value, schoolId, index, allowExtraFields);
    if (ids.has(record.id)) invalid('備份中的資料識別碼重複，沒有還原任何資料。');
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

/** One school's complete personal ledger. Account identity and permissions are never exported. */
export function serializePersonalImportBackup(
  records: readonly PersonalImportRecord[],
  options: { schoolId: string; exportedAt?: string },
): string {
  if (!options || !validSchoolId(options.schoolId)) invalid('請先選擇要備份的學校。');
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  if (!validTimestamp(exportedAt)) invalid('備份日期格式不正確，請重新匯出。');
  const validated = validatedRecords(records, options.schoolId, true);
  const chunks = [
    `{"format":${JSON.stringify(FORMAT)},"version":1,"exportedAt":${JSON.stringify(exportedAt)},"schoolId":${JSON.stringify(options.schoolId)},"records":[`,
  ];
  let bytes = utf8Bytes(chunks[0]) + 2;
  for (const [index, record] of validated.entries()) {
    const chunk = `${index ? ',' : ''}${JSON.stringify(record)}`;
    bytes += utf8Bytes(chunk);
    if (bytes > PERSONAL_IMPORT_BACKUP_MAX_BYTES) sizeExceeded();
    chunks.push(chunk);
  }
  chunks.push(']}');
  return chunks.join('');
}

/** Decode atomically into a preview. Archive IDs, revision times and batch ownership are not installed. */
export function parsePersonalImportBackup(text: string): PersonalImportBackupPreview {
  if (typeof text !== 'string') invalid();
  utf8Bytes(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid('這個檔案不是有效的 JSON 備份，沒有還原任何資料。');
  }
  const envelope = objectWithFields(value, ENVELOPE_FIELDS);
  if (envelope.format !== FORMAT) invalid('這不是 Campus One 個人資料備份。');
  if (envelope.version !== 1) invalid('尚未支援這個備份版本，請更新 Campus One 後再試。');
  if (!validSchoolId(envelope.schoolId) || !validTimestamp(envelope.exportedAt)) invalid();
  const records = validatedRecords(envelope.records, envelope.schoolId);
  const ids = new Set(records.map((record) => record.id));
  const proposedLinks: Record<string, string> = {};
  const counts: Record<PersonalImportKind, number> = { timetable: 0, grades: 0, events: 0 };
  const rows = records.map((record): PersonalImportRow => {
    const { batchId, importedAt, linkedCourseId, ...row } = record;
    // These fields remain archive provenance only; the normal append path owns new revision metadata.
    void batchId;
    void importedAt;
    let id = createPersonalImportId();
    while (ids.has(id)) id = createPersonalImportId();
    ids.add(id);
    if (linkedCourseId) proposedLinks[id] = linkedCourseId;
    counts[row.kind] += 1;
    return { ...row, id, source: { ...row.source } };
  });
  return {
    schoolId: envelope.schoolId,
    exportedAt: envelope.exportedAt,
    rows,
    proposedLinks,
    counts,
  };
}

/** Call inside the store's mutation lock with the latest ledger, then use its normal append checks. */
export function preparePersonalImportBackupRestore(
  rows: readonly PersonalImportRow[],
  existing: readonly PersonalImportRecord[],
): PersonalImportRow[] {
  const byKey = new Map(existing.map((record) => [personalImportKey(record), record]));
  return rows.map((row) => {
    const current = byKey.get(personalImportKey(row));
    return {
      ...row,
      source: { ...row.source },
      ...(row.linkedCourseId === undefined && current?.linkedCourseId
        ? { linkedCourseId: current.linkedCourseId }
        : {}),
    };
  });
}
