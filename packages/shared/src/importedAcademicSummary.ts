import { personalImportKey } from './imports/records';
import {
  PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  type PersonalImportRecord,
  type PersonalImportRow,
  type PersonalImportSource,
} from './imports/types';
import {
  isPersonalImportDate,
  isPersonalImportTime,
  normalizePersonalImportText,
  validatePersonalImportRow,
} from './imports/validation';

const MAX_RECORDS = 2_000;
const MAX_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE = 10;
const MAX_TERMS = 40;
const MAX_SOURCES_PER_RECORD = 5;
const LIMITATIONS = [
  '資料來自個人匯入紀錄，未與校方即時成績核對。',
  '紀錄學分只是已填學分的加總，不代表已取得、通過或校方認列學分；不換算 GPA 或判定畢業資格。',
  '不同學期的同一門課分開保留；重修、抵免與採計方式仍須依校方紀錄確認。',
] as const;

export type ImportedAcademicIntent = {
  kind: 'imported-academics';
  view: 'grades' | 'credits';
  academicYear?: string;
  semester?: string;
};

export type ImportedAcademicSummaryInput = {
  /** The caller must read the currently authenticated account's own ledger. */
  records: readonly PersonalImportRecord[] | null | undefined;
  schoolId: string;
  availability: 'available' | 'unavailable';
  /** Read time, not proof the school has refreshed these records. */
  fetchedAt: string;
  /** Only supply a source-provided modification time. */
  updatedAt?: string | null;
  academicYear?: string;
  semester?: string;
  offset?: number;
  limit?: number;
};

export type ImportedAcademicSource = Omit<PersonalImportSource, 'rawText'>;

export type ImportedAcademicRecord = {
  id: string;
  title: string;
  schoolId: string;
  academicYear: string;
  semester: string;
  courseCode?: string;
  teacher?: string;
  className?: string;
  /** Original grade text: numeric, letter and pass/fail values are not interpreted. */
  grade?: string;
  credits?: number;
  importedAt: string;
  source: ImportedAcademicSource;
  /** Identical course records may have come from more than one import. */
  sources: Array<{ source: ImportedAcademicSource; importedAt: string }>;
  omittedSources: number;
  duplicateCount: number;
  ambiguous: boolean;
  includedInListedCredits: boolean;
};

export type ImportedAcademicTerm = {
  academicYear: string;
  semester: string;
  totalMatching: number;
  missingGrade: number;
  missingCredits: number;
  listedCredits: number | null;
  duplicateRows: number;
  ambiguousGroups: number;
};

export type ImportedAcademicSummary = {
  status: 'ready' | 'empty' | 'unavailable' | 'invalid';
  reason?: string;
  source: 'personal-import';
  official: false;
  schoolId: string;
  academicYear?: string;
  semester?: string;
  fetchedAt: string | null;
  updatedAt: string | null;
  records: ImportedAcademicRecord[];
  /** Matching rows after collapsing exact duplicates, before pagination. */
  totalMatching: number;
  sourceRecordCount: number;
  missingGrade: number;
  missingCredits: number;
  /** Only unambiguous records with a recorded credit value contribute. */
  listedCredits: number | null;
  duplicateRows: number;
  ambiguousGroups: number;
  ambiguousRecords: number;
  terms: ImportedAcademicTerm[];
  totalTerms: number;
  termsTruncated: boolean;
  offset: number;
  limit: number;
  nextOffset: number | null;
  limitations: string[];
};

const RECORD_FIELDS = [
  'id', 'kind', 'title', 'schoolId', 'academicYear', 'semester', 'courseCode',
  'teacher', 'className', 'grade', 'credits', 'source', 'importedAt', 'batchId',
] as const;
const SOURCE_FIELDS = ['type', 'name', 'line', 'rawText'] as const;
const normalized = (value: string) =>
  normalizePersonalImportText(value).replace(/\s+/g, ' ').toLowerCase();

function boundedText(value: unknown, maximum: number, required = false): value is string {
  return typeof value === 'string' && value.length <= maximum &&
    (!required || value.trim().length > 0) && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && isPersonalImportDate(match[1]) && isPersonalImportTime(match[2]) &&
    Number(match[3]) < 60 && (match[4] === 'Z' || isPersonalImportTime(match[4].slice(1))) &&
    Number.isFinite(Date.parse(value)));
}

/** Copy only data properties; storage payloads cannot invoke getters or carry authority fields. */
function fields(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor) continue;
    if (!('value' in descriptor)) return null;
    result[name] = descriptor.value;
  }
  return result;
}

function semesterKey(value: string): string {
  const key = normalized(value);
  if (/^(?:第?[1一](?:學期)?|上(?:學期)?)$/.test(key)) return '1';
  if (/^(?:第?[2二](?:學期)?|下(?:學期)?)$/.test(key)) return '2';
  return key;
}

function projectedGrade(value: Record<string, unknown>): ImportedAcademicRecord | null {
  if (!boundedText(value.id, 300, true) || !boundedText(value.batchId, 300, true) ||
    !timestamp(value.importedAt) || !boundedText(value.title, 200, true) ||
    typeof value.academicYear !== 'string' || !/^\d{2,4}$/.test(value.academicYear) ||
    !boundedText(value.semester, 30, true)) return null;
  for (const key of ['courseCode', 'teacher', 'className'] as const) {
    if (value[key] !== undefined && !boundedText(value[key], 300)) return null;
  }
  if (value.grade !== undefined && !boundedText(value.grade, 40)) return null;
  const source = fields(value.source, SOURCE_FIELDS);
  if (!source || typeof source.type !== 'string' || !['paste', 'file', 'screenshot'].includes(source.type) ||
    !Number.isSafeInteger(source.line) || (source.line as number) < 1 ||
    typeof source.rawText !== 'string' || source.rawText.length > PERSONAL_IMPORT_MAX_TEXT_LENGTH ||
    (source.name !== undefined && !boundedText(source.name, 1_000))) return null;

  const grade = typeof value.grade === 'string' && value.grade.trim() ? value.grade : undefined;
  // Existing import validation remains the authority for grade/credit ranges. Missing values
  // are permitted in this read view and remain absent in the returned record.
  const validationRow: PersonalImportRow = {
    id: value.id, kind: 'grades', schoolId: value.schoolId as string,
    title: value.title, academicYear: value.academicYear, semester: value.semester,
    courseCode: value.courseCode as string | undefined,
    teacher: value.teacher as string | undefined, className: value.className as string | undefined,
    grade: grade?.trim() ?? '未提供',
    credits: value.credits === undefined ? 0 : value.credits as number,
    source: { type: source.type as PersonalImportSource['type'], line: source.line as number, rawText: '' },
  };
  if (validatePersonalImportRow(validationRow).some((issue) => issue.severity === 'error')) return null;
  const evidence: ImportedAcademicSource = {
    type: source.type as PersonalImportSource['type'], line: source.line as number,
    ...(typeof source.name === 'string' ? { name: source.name } : {}),
  };
  return {
    id: value.id, title: value.title, schoolId: value.schoolId as string,
    academicYear: value.academicYear, semester: value.semester,
    ...(typeof value.courseCode === 'string' ? { courseCode: value.courseCode } : {}),
    ...(typeof value.teacher === 'string' ? { teacher: value.teacher } : {}),
    ...(typeof value.className === 'string' ? { className: value.className } : {}),
    ...(grade !== undefined ? { grade } : {}),
    ...(typeof value.credits === 'number' ? { credits: value.credits } : {}),
    importedAt: value.importedAt, source: evidence,
    sources: [{ source: { ...evidence }, importedAt: value.importedAt }],
    omittedSources: 0, duplicateCount: 1, ambiguous: false,
    includedInListedCredits: typeof value.credits === 'number',
  };
}

function termKey(row: Pick<ImportedAcademicRecord, 'academicYear' | 'semester'>): string {
  return JSON.stringify([row.academicYear, semesterKey(row.semester)]);
}

function exactContentKey(row: ImportedAcademicRecord): string {
  const identity = personalImportKey({
    ...row, kind: 'grades', semester: semesterKey(row.semester),
    source: { ...row.source, rawText: '' },
  });
  return JSON.stringify([identity, normalized(row.title), row.grade ?? null, row.credits ?? null]);
}

type GroupedRecord = { row: ImportedAcademicRecord; index: number; ambiguousGroup?: number };

/** Same-term code collisions are reviewed together, including changed teacher/class metadata. */
function groupRecords(records: ImportedAcademicRecord[]): GroupedRecord[] {
  const parents = records.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const codes = new Map<string, number>();
  const names = new Map<string, number[]>();
  records.forEach((row, index) => {
    const term = termKey(row);
    if (row.courseCode?.trim()) {
      const codeKey = JSON.stringify([term, normalized(row.courseCode)]);
      const previous = codes.get(codeKey);
      if (previous !== undefined) parents[root(index)] = root(previous);
      else codes.set(codeKey, index);
    }
    const nameKey = JSON.stringify([term, normalized(row.title)]);
    const group = names.get(nameKey) ?? [];
    group.push(index);
    names.set(nameKey, group);
  });
  // A missing code can refer to an already listed coded record. Do not double-count the title.
  for (const indexes of names.values()) {
    if (!indexes.some((index) => !records[index].courseCode?.trim())) continue;
    for (const index of indexes.slice(1)) parents[root(index)] = root(indexes[0]);
  }
  const groups = new Map<number, number[]>();
  records.forEach((_, index) => {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  const result: GroupedRecord[] = [];
  for (const [groupKey, indexes] of groups) {
    const first = records[indexes[0]];
    const exact = indexes.length > 1 && Boolean(first.courseCode?.trim()) &&
      indexes.every((index) => exactContentKey(records[index]) === exactContentKey(first));
    if (exact) {
      first.duplicateCount = indexes.length;
      first.sources = indexes.slice(0, MAX_SOURCES_PER_RECORD).map((index) => ({
        source: { ...records[index].source }, importedAt: records[index].importedAt,
      }));
      first.omittedSources = Math.max(0, indexes.length - MAX_SOURCES_PER_RECORD);
      result.push({ row: first, index: indexes[0] });
    } else {
      const ambiguous = indexes.length > 1;
      for (const index of indexes) {
        const row = records[index];
        row.ambiguous = ambiguous;
        row.includedInListedCredits = !ambiguous && row.credits !== undefined;
        result.push({ row, index, ...(ambiguous ? { ambiguousGroup: groupKey } : {}) });
      }
    }
  }
  return result.sort((left, right) => left.index - right.index);
}

function totals(records: readonly GroupedRecord[]) {
  const credits = records.filter(({ row }) => row.includedInListedCredits).map(({ row }) => row.credits!);
  // Compensated addition keeps fractional recorded credits stable without interpreting grades.
  let sum = 0;
  let correction = 0;
  for (const value of credits) {
    const increment = value - correction;
    const next = sum + increment;
    correction = (next - sum) - increment;
    sum = next;
  }
  return {
    totalMatching: records.length,
    missingGrade: records.filter(({ row }) => row.grade === undefined).length,
    missingCredits: records.filter(({ row }) => row.credits === undefined).length,
    listedCredits: credits.length ? Number(sum.toPrecision(15)) : null,
    duplicateRows: records.reduce((total, { row }) => total + row.duplicateCount - 1, 0),
    ambiguousGroups: new Set(records.flatMap(({ ambiguousGroup }) =>
      ambiguousGroup === undefined ? [] : [ambiguousGroup])).size,
  };
}

/** Account authorization belongs to the caller; school scope is checked again before any output. */
export function summarizeImportedAcademics(input: ImportedAcademicSummaryInput): ImportedAcademicSummary {
  const result: ImportedAcademicSummary = {
    status: 'invalid', source: 'personal-import', official: false, schoolId: '',
    fetchedAt: null, updatedAt: null, records: [], totalMatching: 0, sourceRecordCount: 0,
    missingGrade: 0, missingCredits: 0, listedCredits: null, duplicateRows: 0,
    ambiguousGroups: 0, ambiguousRecords: 0, terms: [], totalTerms: 0, termsTruncated: false,
    offset: 0, limit: DEFAULT_PAGE_SIZE, nextOffset: null, limitations: [...LIMITATIONS],
  };
  const invalid = (reason: string): ImportedAcademicSummary => ({ ...result, status: 'invalid', reason });
  try {
    if (!input || !boundedText(input.schoolId, 100, true) || input.schoolId !== input.schoolId.trim())
      return invalid('invalid-school');
    result.schoolId = input.schoolId;
    if (!timestamp(input.fetchedAt) || (input.updatedAt != null && !timestamp(input.updatedAt)))
      return invalid('invalid-evidence');
    result.fetchedAt = input.fetchedAt;
    result.updatedAt = input.updatedAt ?? null;
    if ((input.academicYear !== undefined && (typeof input.academicYear !== 'string' ||
      !/^\d{2,4}$/.test(input.academicYear))) ||
      (input.semester !== undefined && (!boundedText(input.semester, 30, true) || input.semester !== input.semester.trim())) ||
      (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > MAX_RECORDS)) ||
      (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE)))
      return invalid('invalid-query');
    if (input.academicYear !== undefined) result.academicYear = input.academicYear;
    if (input.semester !== undefined) result.semester = input.semester;
    result.offset = input.offset ?? 0;
    result.limit = input.limit ?? DEFAULT_PAGE_SIZE;
    if (input.availability === 'unavailable') return { ...result, status: 'unavailable', reason: 'source-unavailable' };
    if (input.availability !== 'available' || !Array.isArray(input.records)) return invalid('invalid-records');
    if (input.records.length > MAX_RECORDS) return invalid('too-many-records');

    const grades: ImportedAcademicRecord[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < input.records.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input.records, String(index));
      if (!descriptor || !('value' in descriptor)) return invalid('invalid-records');
      const record = fields(descriptor.value, RECORD_FIELDS);
      if (!record || typeof record.kind !== 'string' || !['timetable', 'grades', 'events'].includes(record.kind))
        return invalid('invalid-records');
      if (record.schoolId !== input.schoolId) return invalid('school-mismatch');
      if (record.kind !== 'grades') continue;
      const grade = projectedGrade(record);
      if (!grade) return invalid('invalid-records');
      if (ids.has(grade.id)) return invalid('duplicate-id');
      ids.add(grade.id);
      if (input.academicYear !== undefined && grade.academicYear !== input.academicYear) continue;
      if (input.semester !== undefined && semesterKey(grade.semester) !== semesterKey(input.semester)) continue;
      grades.push(grade);
    }
    const grouped = groupRecords(grades);
    const aggregate = totals(grouped);
    const termGroups = new Map<string, GroupedRecord[]>();
    for (const record of grouped) {
      const key = termKey(record.row);
      const term = termGroups.get(key) ?? [];
      term.push(record);
      termGroups.set(key, term);
    }
    const terms = [...termGroups.values()].map((rows): ImportedAcademicTerm => ({
      academicYear: rows[0].row.academicYear, semester: rows[0].row.semester, ...totals(rows),
    })).sort((left, right) => Number(right.academicYear) - Number(left.academicYear) ||
      semesterKey(right.semester).localeCompare(semesterKey(left.semester), 'zh-TW', { numeric: true }));
    const page = grouped.slice(result.offset, result.offset + result.limit).map(({ row }) => row);
    return {
      ...result, ...aggregate, status: grouped.length ? 'ready' : 'empty', records: page,
      sourceRecordCount: grades.length,
      ambiguousRecords: grouped.filter(({ row }) => row.ambiguous).length,
      terms: terms.slice(0, MAX_TERMS), totalTerms: terms.length, termsTruncated: terms.length > MAX_TERMS,
      nextOffset: result.offset + result.limit < grouped.length ? result.offset + result.limit : null,
    };
  } catch {
    return invalid('invalid-records');
  }
}

/** Narrow read intent. Unsupported calculations, other people and relative terms stay with the existing engine. */
export function parseImportedAcademicIntent(message: string): ImportedAcademicIntent | null {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) return null;
  let text = normalizePersonalImportText(message).replace(/\s+/g, '').replace(/[?？!！。]+$/u, '');
  text = text.replace(/(?:嗎|呢)$/u, '');
  const terms = [...text.matchAll(/(\d{2,4})(?:學年度|學年)(?:第?([一二12])學期|([上下])學期)?|(\d{2,4})[-/]([12])/gu)];
  if (terms.length > 1) return null;
  const term = terms[0];
  let academicYear: string | undefined;
  let semester: string | undefined;
  if (term) {
    academicYear = term[1] || term[4];
    const part = term[2] || term[3] || term[5];
    semester = part ? (/^[一1上]$/.test(part) ? '1' : '2') : undefined;
    text = text.replace(term[0], '').replace(/的的/gu, '的');
  }
  const target = '(成績(?:紀錄|記錄|資料)?|學分(?:紀錄|記錄|資料))';
  const polite = '(?:(?:請|麻煩)(?:你)?)?';
  const verb = '(?:查看|查詢|看一下|看看|查|看|列出|顯示|整理)(?:一下)?';
  const own = '(?:我(?:已)?(?:匯入|儲存|保存)的|我的(?:已)?匯入(?:的)?|我的|我)';
  const ending = '(?:有哪些|有幾筆)?';
  const direct = new RegExp(`^${polite}(?:${verb})?${own}${target}${ending}$`, 'u');
  const request = new RegExp(`^${polite}(?:幫我|替我)${verb}(?:${own}|(?:已)?匯入的|儲存的)?${target}${ending}$`, 'u');
  if (!direct.test(text) && !request.test(text)) return null;
  return {
    kind: 'imported-academics', view: text.includes('學分') ? 'credits' : 'grades',
    ...(academicYear !== undefined ? { academicYear } : {}),
    ...(semester !== undefined ? { semester } : {}),
  };
}

function taipeiTime(value: string): string {
  return `${new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(0, 19).replace('T', ' ')}（台灣時間）`;
}

/** Deterministic display copy; raw pasted/OCR text is never included in a response. */
export function formatImportedAcademicSummary(summary: ImportedAcademicSummary): string {
  if (summary.status === 'unavailable')
    return '目前無法讀取這個帳號的個人匯入紀錄，請稍後重試。這不表示你沒有成績或學分紀錄。';
  if (summary.status === 'invalid')
    return '這份個人匯入紀錄的範圍或格式尚無法確認，這次沒有列出或加總。請到個人匯入頁核對後再試。';
  const filter = [summary.academicYear && `${summary.academicYear} 學年度`, summary.semester && `${summary.semester} 學期`]
    .filter(Boolean).join('・');
  const lines = [`個人匯入紀錄${filter ? `｜${filter}` : ''}`];
  if (summary.status === 'empty') {
    lines.push(filter ? '目前沒有符合這個學年度／學期的成績紀錄。' : '目前沒有已儲存的成績紀錄。');
    lines.push('可先到個人匯入頁保存成績單；空清單不代表校方沒有成績。');
  } else {
    lines.push(`共 ${summary.totalMatching} 筆${summary.records.length ? `，這次顯示第 ${summary.offset + 1}–${summary.offset + summary.records.length} 筆` : '，這一頁沒有其他紀錄'}。`);
    summary.records.forEach((row, index) => {
      lines.push(`${summary.offset + index + 1}. ${row.title}${row.courseCode ? `（${row.courseCode}）` : ''}｜${row.academicYear} 學年度 ${row.semester} 學期`);
      lines.push(`成績：${row.grade ?? '未填'}；紀錄學分：${row.credits ?? '未填'}${row.ambiguous ? '；同學期課程資料有疑義，未列入加總' : ''}。`);
    });
    lines.push(summary.listedCredits === null
      ? '目前沒有可安全加總的已填學分。'
      : `紀錄中可加總的學分：${summary.listedCredits}，只計已填學分且無重複疑義的紀錄。`);
    if (summary.missingGrade || summary.missingCredits)
      lines.push(`缺少成績 ${summary.missingGrade} 筆；缺少學分 ${summary.missingCredits} 筆，未把缺值當成 0。`);
    if (summary.duplicateRows) lines.push(`${summary.duplicateRows} 筆完全相同的課程紀錄已合併顯示，沒有重複加總。`);
    if (summary.ambiguousGroups) lines.push(`${summary.ambiguousGroups} 組同學期課程需要核對，相關 ${summary.ambiguousRecords} 筆均未列入學分加總。`);
    if (summary.nextOffset !== null) lines.push('還有其他紀錄，可到個人匯入頁查看完整內容。');
  }
  if (summary.fetchedAt) lines.push(`查閱時間：${taipeiTime(summary.fetchedAt)}。`);
  lines.push(summary.updatedAt ? `紀錄更新時間：${taipeiTime(summary.updatedAt)}。` : '來源未提供紀錄更新時間。');
  lines.push(...summary.limitations);
  return lines.join('\n');
}
