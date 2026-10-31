import { PERSONAL_IMPORT_TEACHER_FIELDS } from './nameFields';
import {
  isPeriodProfileId,
  parsePeriodRange,
  slotIndexForLabel,
  type PeriodProfileId,
} from '../timetable/periods';
import {
  PERSONAL_IMPORT_MAX_ROWS,
  PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  type ImportIssue,
  type PersonalImportOptions,
  type PersonalImportRow,
} from './types';
import {
  mapPersonalImportPeriods,
  normalizePersonalImportText,
  validatePersonalImportRow,
} from './validation';
import { createPersonalImportId, personalImportKey } from './records';
import { parsePersonalImportCalendar } from './icalendar';

type Field =
  | Exclude<keyof PersonalImportRow, 'id' | 'kind' | 'source' | 'linkedCourseId'>
  | 'periods'
  | 'times';
const aliases: Record<Field, string[]> = {
  title: [
    '課程名稱',
    '科目名稱',
    '課名',
    '科目',
    '活動名稱',
    '活動',
    '名稱',
    'title',
    'name',
    'course',
    'coursename',
    'subject',
    'event',
  ],
  schoolId: ['學校代碼', 'schoolid'],
  academicYear: ['學年度', '學年', 'academicyear', 'year'],
  semester: ['學期', 'semester', 'term'],
  courseCode: ['課程代碼', '選課代碼', '科目代號', '科目代碼', '課號', 'coursecode', 'code'],
  teacher: PERSONAL_IMPORT_TEACHER_FIELDS,
  className: ['授課班級', '班級', '課班', 'classname', 'class', 'section'],
  location: ['上課地點', '活動地點', '教室', '地點', 'location', 'room'],
  dayOfWeek: ['星期', '上課日', '週次', 'weekday', 'day', 'dayofweek'],
  startPeriod: ['開始節次', '起始節次', '起節', 'startperiod'],
  endPeriod: ['結束節次', '迄節', 'endperiod'],
  periodLabel: ['原始節次', '節次文字', 'periodlabel'],
  periods: ['上課節次', '節次', 'periods', 'period'],
  startTime: ['開始時間', '起始時間', '開始', 'starttime', 'start'],
  endTime: ['結束時間', '結束', 'endtime', 'end'],
  times: ['上課時間', '活動時間', '時間', 'time'],
  credits: ['學分數', '學分', 'credits', 'credit'],
  grade: ['學期成績', '成績', '分數', 'grade', 'score'],
  date: ['開始日期', '活動日期', '日期', 'date', 'startdate'],
  endDate: ['結束日期', '迄日', 'enddate'],
  allDay: ['全天', '整天', 'allday'],
};
const headerMap = new Map(
  Object.entries(aliases).flatMap(([field, names]) =>
    names.map((name) => [name, field as Field] as const),
  ),
);
const normalizeHeader = (value: string) =>
  normalizePersonalImportText(value)
    .toLowerCase()
    .replace(/[\s_()（）:：]/g, '');
const fieldFor = (value: string) => headerMap.get(normalizeHeader(value));

/** Shared header recognition for locally imported school portal tables. */
export function personalImportHeaderField(value: string): string | undefined {
  return fieldFor(value);
}

function weekday(value: string): number | undefined {
  const clean = normalizePersonalImportText(value);
  const match = /^(?:(?:星期|週|周|禮拜)\s*)?([一二三四五六日天1-7])$/.exec(clean);
  if (match)
    return (
      ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } as Record<string, number>)[
        match[1]
      ] ?? Number(match[1])
    );
  return (
    {
      mon: 1,
      monday: 1,
      tue: 2,
      tuesday: 2,
      wed: 3,
      wednesday: 3,
      thu: 4,
      thursday: 4,
      fri: 5,
      friday: 5,
      sat: 6,
      saturday: 6,
      sun: 7,
      sunday: 7,
    } as Record<string, number>
  )[clean.toLowerCase()];
}

function periods(
  value: string,
  profile?: PeriodProfileId,
): [number, number] | undefined {
  const clean = normalizePersonalImportText(value);
  if (profile) {
    const parsed = parsePeriodRange(clean, profile);
    return parsed ? [parsed.start, parsed.end] : undefined;
  }
  const match =
    /^(?:第\s*)?(\d{1,2})(?:\s*節)?(?:\s*[-–—~～至到]\s*(?:第\s*)?(\d{1,2})(?:\s*節)?)?$/.exec(
      clean,
    );
  return match ? [Number(match[1]), Number(match[2] ?? match[1])] : undefined;
}

function time(value: string): string {
  const clean = normalizePersonalImportText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(clean);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : clean;
}

function date(value: string): string {
  const clean = normalizePersonalImportText(value);
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(clean);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const roc = /^民國\s*(\d{2,3})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(clean);
  if (roc) return `${Number(roc[1]) + 1911}-${roc[2].padStart(2, '0')}-${roc[3].padStart(2, '0')}`;
  return clean;
}

function setField(
  row: PersonalImportRow,
  field: Field,
  value: string,
  issues: ImportIssue[],
  profile?: PeriodProfileId,
) {
  const clean = normalizePersonalImportText(value);
  if (!clean) return;
  const invalid = () =>
    issues.push({
      code: 'unrecognized-field',
      severity: 'error',
      rowId: row.id,
      message: `無法確認「${value}」的格式，請修正後再匯入。`,
      field: field === 'periods' ? 'startPeriod' : field === 'times' ? 'startTime' : field,
    });
  if (field === 'allDay') {
    if (/^(?:是|全天|整天|true|yes|1)$/i.test(clean)) row.allDay = true;
    else if (/^(?:否|false|no|0)$/i.test(clean)) row.allDay = false;
    else invalid();
  } else if (field === 'dayOfWeek') {
    row.dayOfWeek = weekday(clean);
    if (row.dayOfWeek === undefined) invalid();
  } else if (field === 'credits') {
    if (!/^\d+(?:\.\d+)?$/.test(clean)) invalid();
    else row.credits = Number(clean);
  } else if (field === 'startPeriod' || field === 'endPeriod') {
    if (profile && row.kind === 'timetable') {
      const slot = slotIndexForLabel(clean, profile);
      if (slot) row[field] = slot;
      else invalid();
    } else if (!/^\d+(?:\.\d+)?$/.test(clean)) invalid();
    else row[field] = Number(clean);
  } else if (field === 'periods') {
    const parsed = periods(clean, profile);
    if (parsed) [row.startPeriod, row.endPeriod] = parsed;
    else row.periodLabel = clean;
  } else if (field === 'times') {
    const parsed = /^(\d{1,2}:\d{2})\s*[-–—~～至到]\s*(\d{1,2}:\d{2})$/.exec(clean);
    if (parsed) [row.startTime, row.endTime] = [time(parsed[1]), time(parsed[2])];
    else invalid();
  } else if (field === 'startTime' || field === 'endTime') row[field] = time(clean);
  else if (field === 'date' || field === 'endDate') row[field] = date(clean);
  else row[field] = clean;
}

type SourceLine = { cells: string[]; line: number; rawText: string };
type SourceTable = { lines: SourceLine[]; malformed: boolean; skippedPrefix?: SourceLine[] };
/** Small RFC-style delimited reader: quoted commas/newlines and doubled quotes are preserved. */
function readTable(text: string, delimiter: string): SourceTable {
  const lines: SourceLine[] = [];
  let cells: string[] = [],
    cell = '',
    raw = '',
    quoted = false,
    closedQuote = false,
    line = 1,
    startLine = 1,
    malformed = false;
  const finish = () => {
    cells.push(cell.trim());
    if (cells.some(Boolean)) lines.push({ cells, line: startLine, rawText: raw });
    cells = [];
    cell = '';
    raw = '';
    closedQuote = false;
    startLine = line + 1;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      raw += char;
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        raw += '"';
        index++;
      } else if (quoted) {
        quoted = false;
        closedQuote = true;
      } else if (!cell.trim()) quoted = true;
      else {
        cell += char;
        malformed = true;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
      closedQuote = false;
      raw += char;
    } else if (char === '\n') {
      if (quoted) {
        cell += char;
        raw += char;
      } else finish();
      line++;
    } else {
      if (closedQuote && !/\s/.test(char)) malformed = true;
      cell += char;
      raw += char;
    }
  }
  if (quoted) malformed = true;
  finish();
  return { lines, malformed };
}

/** OCR text tables can retain column gaps; single spaces inside course names are never delimiters. */
function readScreenshotTable(text: string): SourceTable {
  const lines = text
    .split('\n')
    .map((rawText, index) => ({
      cells: rawText.trim().split(/[ \u00a0\u3000]{2,}/),
      line: index + 1,
      rawText,
    }))
    .filter((line) => line.rawText.trim());
  // Screenshot titles and OCR noise often precede the table. Only a real,
  // recognizable header permits skipping that prefix; all later lines remain data.
  const headerIndex = lines.findIndex(
    (line) => line.cells.filter((cell) => fieldFor(cell)).length >= 2,
  );
  return {
    lines: headerIndex > 0 ? lines.slice(headerIndex) : lines,
    ...(headerIndex > 0 ? { skippedPrefix: lines.slice(0, headerIndex) } : {}),
    malformed: false,
  };
}

function newRow(options: PersonalImportOptions, line: number, rawText: string): PersonalImportRow {
  return {
    id: createPersonalImportId(),
    kind: options.kind,
    title: '',
    schoolId: options.schoolId,
    academicYear: options.academicYear,
    semester: options.semester,
    source: { ...options.source, type: options.source?.type ?? 'paste', line, rawText },
  };
}

const labelNames = Object.values(aliases)
  .flat()
  .sort((a, b) => b.length - a.length);
const labelPattern = new RegExp(`(?:^|[\\s/|;；,，])(${labelNames.join('|')})\\s*[:：]\\s*`, 'gi');

function profileOf(options: PersonalImportOptions): PeriodProfileId | undefined {
  return isPeriodProfileId(options.periodProfile) ? options.periodProfile : undefined;
}

function naturalPeriodPattern(profile?: PeriodProfileId): RegExp {
  if (profile === 'ncku') {
    return /第\s*(?:0|[1-9]|[NABCD])(?:\s*節)?\s*[-–—~～至到]\s*(?:第\s*)?(?:0|[1-9]|[NABCD])\s*節?|第\s*(?:0|[1-9]|[NABCD])\s*節|\[(?:0|[1-9]|[NABCD])\](?:\s*\[(?:0|[1-9]|[NABCD])\])+/i;
  }
  return /第\s*\d{1,2}(?:\s*節)?\s*[-–—~～至到]\s*(?:第\s*)?\d{1,2}\s*節|第\s*\d{1,2}\s*節/;
}

function naturalRow(
  rawText: string,
  line: number,
  options: PersonalImportOptions,
  issues: ImportIssue[],
): PersonalImportRow {
  const row = newRow(options, line, rawText);
  const profile = profileOf(options);
  let clean = normalizePersonalImportText(rawText);
  const labels = Array.from(clean.matchAll(labelPattern));
  const seen = new Set<Field>();
  for (let index = 0; index < labels.length; index++) {
    const current = labels[index];
    const field = fieldFor(current[1]);
    if (!field) continue;
    if (seen.has(field))
      issues.push({
        code: 'repeated-field',
        severity: 'error',
        rowId: row.id,
        message: `同一筆資料出現重複的「${current[1]}」，請分開或確認內容。`,
      });
    seen.add(field);
    const start = current.index! + current[0].length;
    const end = labels[index + 1]?.index ?? clean.length;
    setField(row, field, clean.slice(start, end).replace(/[\s/|;；,，]+$/, ''), issues, profile);
  }
  clean = clean.slice(0, labels[0]?.index ?? clean.length).trim();
  if (options.kind === 'timetable') {
    // Prefix is mandatory in free text: digits in 科目1, a course code or a room are not weekdays.
    const day = /(?:星期|週|周|禮拜)\s*([一二三四五六日天1-7])(?=$|[\s/|,，;；第\d])/.exec(clean);
    if (day && row.dayOfWeek === undefined) {
      row.dayOfWeek = weekday(day[0]);
      clean = clean.replace(day[0], ' ');
    }
    const period = naturalPeriodPattern(profile).exec(clean);
    if (period && row.startPeriod === undefined) {
      setField(row, 'periods', period[0], issues, profile);
      clean = clean.replace(period[0], ' ');
    }
    const times = /\b\d{1,2}:\d{2}\s*[-–—~～至到]\s*\d{1,2}:\d{2}\b/.exec(clean);
    if (times && !row.startTime) {
      setField(row, 'times', times[0], issues, profile);
      clean = clean.replace(times[0], ' ');
    }
  }
  if (!row.title)
    row.title = clean.replace(/^[\s/|,，;；]+|[\s/|,，;；]+$/g, '').replace(/\s+/g, ' ');
  return mapPersonalImportPeriods(row, options);
}

export function parsePersonalImport(
  text: string,
  options: PersonalImportOptions,
): { rows: PersonalImportRow[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const normalized = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (normalized.length > PERSONAL_IMPORT_MAX_TEXT_LENGTH)
    return {
      rows: [],
      issues: [
        {
          code: 'text-limit',
          severity: 'error',
          message: `一次最多讀取 ${PERSONAL_IMPORT_MAX_TEXT_LENGTH.toLocaleString('en-US')} 個字，請分成較小的檔案。`,
        },
      ],
    };
  if (!normalized.trim())
    return {
      rows: [],
      issues: [
        { code: 'empty-input', severity: 'error', message: '請貼上文字或選擇有內容的檔案。' },
      ],
    };
  let rows: PersonalImportRow[];
  if (/^\s*BEGIN:VCALENDAR\b/i.test(normalized)) {
    if (options.kind !== 'events')
      return {
        rows: [],
        issues: [
          {
            code: 'calendar-kind-mismatch',
            severity: 'error',
            message: '這是行事曆檔案，請切換到「行事曆／活動」後再匯入。',
          },
        ],
      };
    const parsed = parsePersonalImportCalendar(normalized.trim(), options);
    rows = parsed.rows;
    issues.push(...parsed.issues);
  } else {
    const tables = ['\t', ',', ';', '|', '、'].map((delimiter) => {
      const table = readTable(normalized, delimiter);
      const firstHeaderCount = table.lines[0]?.cells.filter((cell) => fieldFor(cell)).length ?? 0;
      const headerIndex = firstHeaderCount >= 2 ? 0 : table.lines.findIndex((line) => {
        const fields = line.cells.map(fieldFor);
        return fields.includes('title') && fields.filter(Boolean).length >= 2 &&
          new Set(fields.filter(Boolean)).size === fields.filter(Boolean).length;
      });
      return headerIndex > 0 ? {
        ...table,
        lines: table.lines.slice(headerIndex),
        skippedPrefix: table.lines.slice(0, headerIndex),
      } : table;
    });
    if (options.source?.type === 'screenshot') tables.push(readScreenshotTable(normalized));
    const candidates = tables.map((table) => ({
      ...table,
      headers: table.lines[0]?.cells.map(fieldFor) ?? [],
    }));
    const table = candidates.sort(
      (a, b) => b.headers.filter(Boolean).length - a.headers.filter(Boolean).length,
    )[0];
    if (table.headers.filter(Boolean).length >= 2) {
      if (table.skippedPrefix?.length) {
        const firstLine = table.skippedPrefix[0].line;
        const lastLine = table.skippedPrefix[table.skippedPrefix.length - 1].line;
        const preview = table.skippedPrefix
          .map((line) => line.rawText.trim())
          .join('／')
          .slice(0, 160);
        issues.push({
          code: options.source?.type === 'screenshot' ? 'screenshot-prologue-skipped' : 'table-prologue-skipped',
          severity: 'warning',
          message: `已略過${options.source?.type === 'screenshot' ? '截圖' : ''}表頭前第 ${firstLine} 至 ${lastLine} 行文字：${preview}。請核對原文，確認這些不是要匯入的資料。`,
        });
      }
      if (table.malformed)
        issues.push({
          code: 'malformed-table',
          severity: 'error',
          message: '表格引號不完整，請先修正 CSV 檔案。',
        });
      const known = table.headers.filter(Boolean);
      if (new Set(known).size !== known.length)
        issues.push({
          code: 'duplicate-header',
          severity: 'error',
          message: '表格有重複欄位，請保留一份並確認內容。',
        });
      const unknown = table.lines[0].cells.filter((_, index) => !table.headers[index]);
      if (unknown.length)
        issues.push({
          code: 'unknown-header',
          severity: 'warning',
          message: `未讀取的欄位：${unknown.join('、')}。原文保留在來源中。`,
        });
      rows = table.lines.slice(1).map((source) => {
        const row = newRow(options, source.line, source.rawText);
        if (source.cells.length !== table.headers.length)
          issues.push({
            code: 'column-count',
            severity: 'error',
            rowId: row.id,
            message: '這一列的欄位數與標題不同，請確認分隔符號。',
          });
        table.headers.forEach((field, index) => {
          if (field) setField(row, field, source.cells[index] ?? '', issues, profileOf(options));
        });
        return mapPersonalImportPeriods(row, options);
      });
    } else
      rows = normalized
        .split('\n')
        .map((rawText, index) => ({ rawText, line: index + 1 }))
        .filter((source) => source.rawText.trim())
        .map((source) => naturalRow(source.rawText, source.line, options, issues));
  }
  if (rows.length > PERSONAL_IMPORT_MAX_ROWS)
    return {
      rows: [],
      issues: [
        {
          code: 'row-limit',
          severity: 'error',
          message: `一次最多匯入 ${PERSONAL_IMPORT_MAX_ROWS} 筆，請分批匯入；這次沒有讀入任何資料。`,
        },
      ],
    };
  if (!rows.length)
    issues.push({
      code: 'no-data',
      severity: 'error',
      message: '只讀到欄位標題，沒有可匯入的資料。',
    });
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.schoolId !== options.schoolId)
      issues.push({
        code: 'school-mismatch',
        severity: 'error',
        rowId: row.id,
        field: 'schoolId',
        message: '這筆資料的學校與目前選擇不同，請確認後分開匯入。',
      });
    issues.push(...validatePersonalImportRow(row, options));
    const key = personalImportKey(row);
    if (keys.has(key))
      issues.push({
        code: 'duplicate-row',
        severity: 'warning',
        rowId: row.id,
        message: '這筆資料與前面的資料重複，匯入時只會保留一筆。',
      });
    keys.add(key);
  }
  return { rows, issues };
}
