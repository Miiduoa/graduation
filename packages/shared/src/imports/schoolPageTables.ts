import { personalImportHeaderField } from './parser';
import { periodLabelAt, slotIndexForLabel, type PeriodProfileId } from '../timetable/periods';
import { PERSONAL_IMPORT_MAX_ROWS, type PersonalImportKind } from './types';

/**
 * Reads user-saved school portal tables locally. This does not fetch a school URL,
 * execute HTML, submit a form, or send credentials to Campus One.
 */
export type SchoolPageTable = {
  id: string;
  label: string;
  rowCount: number;
  text: string;
  layout: 'list' | 'weekly';
};

export class SchoolPageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchoolPageImportError';
  }
}

const HTML_LIMIT = 512_000;
const MAX_TABLES = 30;
const MAX_TABLE_ROWS = 1_200;
const MAX_COLUMNS = 32;
const MAX_CANDIDATES = 12;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (source, number: string) => {
      const code = number[0].toLowerCase() === 'x'
        ? parseInt(number.slice(1), 16)
        : parseInt(number, 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : source;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ensp|emsp|ndash|mdash|hellip);/gi, (_match, entity: string) => {
      const values: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        ensp: ' ', emsp: ' ', ndash: '–', mdash: '—', hellip: '…',
      };
      return values[entity.toLowerCase()] ?? '';
    });
}

function plainText(markup: string): string {
  return decodeEntities(
    markup
      .replace(/<(?:script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|iframe)\s*>/gi, '')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t\r\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ')
    .slice(0, 500);
}

function span(attribute: string, name: 'rowspan' | 'colspan'): number {
  const match = new RegExp('\\b' + name + '\\s*=\\s*(?:["\\x27]?(\\d+)["\\x27]?)', 'i').exec(attribute);
  return match ? Math.max(1, Math.min(MAX_COLUMNS, Number(match[1]))) : 1;
}

function isHidden(attribute: string): boolean {
  return /\bhidden(?:\s|=|>|$)/i.test(attribute) ||
    /\bdisplay\s*:\s*none\b/i.test(attribute) ||
    /\baria-hidden\s*=\s*["']?true\b/i.test(attribute);
}

/** Expands rowspan/colspan so weekly grids keep their weekday alignment. */
function tableRows(table: string): string[][] {
  const result: string[][] = [];
  const carries = new Map<number, { text: string; remaining: number }>();
  const trs = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) ?? [];
  if (trs.length > MAX_TABLE_ROWS) {
    throw new SchoolPageImportError('學校網頁表格超過 1,200 列，請改存成 CSV，或分批匯入。');
  }
  for (const tr of trs) {
    const columns: (string | undefined)[] = [];
    for (const [column, carry] of carries) {
      columns[column] = carry.text;
      carry.remaining -= 1;
      if (carry.remaining <= 0) carries.delete(column);
    }
    const cells = tr.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi);
    let cursor = 0;
    for (const cell of cells) {
      const attributes = cell[2];
      while (columns[cursor] !== undefined && cursor < MAX_COLUMNS) cursor++;
      if (cursor >= MAX_COLUMNS) break;
      const count = Math.min(span(attributes, 'colspan'), MAX_COLUMNS - cursor);
      const text = isHidden(attributes) ? '' : plainText(cell[3]);
      for (let offset = 0; offset < count; offset++) {
        columns[cursor + offset] = text;
        const additionalRows = span(attributes, 'rowspan') - 1;
        if (additionalRows > 0) {
          carries.set(cursor + offset, { text, remaining: additionalRows });
        }
      }
      cursor += count;
    }
    if (columns.some((value) => value?.trim())) {
      result.push(Array.from({ length: columns.length }, (_, index) => columns[index] ?? ''));
    }
  }
  return result;
}

function normalizedHeader(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s:：()（）\-_/]/g, '');
}

function weekday(value: string): number | null {
  const header = normalizedHeader(value);
  const chinese = /^(?:星期|禮拜|週|周)([一二三四五六日天])$/.exec(header);
  if (chinese) {
    return ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } as Record<string, number>)[chinese[1]];
  }
  const english = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const day = english.findIndex((name) => header === name || header === name.slice(0, 3));
  return day === -1 ? null : day + 1;
}

function period(value: string, profile?: PeriodProfileId): number | null {
  const match = /^(?:第\s*)?(\d{1,2}|[NABCD])(?:\s*節)?(?:\s|$|[（(:：])/i.exec(value.trim());
  if (!match) return null;
  if (profile) return slotIndexForLabel(match[1], profile) ?? null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 1 && number <= 24 ? number : null;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) =>
    row.map((value) => '"' + value.replace(/"/g, '""') + '"').join(',')
  ).join('\n');
}

function listCandidate(
  rows: string[][],
  index: number,
  kind: PersonalImportKind,
): SchoolPageTable | null {
  for (let headerIndex = 0; headerIndex < Math.min(rows.length, 8); headerIndex++) {
    const header = rows[headerIndex];
    const fields = header.map(personalImportHeaderField);
    const set = new Set(fields.filter((field): field is string => typeof field === 'string'));
    const sufficient = set.has('title') && (
      kind === 'timetable'
        ? ['dayOfWeek', 'periods', 'startPeriod', 'startTime', 'times'].some((field) => set.has(field))
        : kind === 'grades'
          ? set.has('grade') || set.has('credits')
          : set.has('date') || set.has('startTime') || set.has('times')
    );
    if (!sufficient || set.size < 2 || set.size !== fields.filter(Boolean).length) continue;
    const titleColumn = fields.indexOf('title');
    const data = rows.slice(headerIndex + 1).filter((row) => {
      const title = row[titleColumn]?.trim() ?? '';
      return !!title && !/^(?:總計|合計|小計|平均|total|subtotal)$/i.test(title);
    });
    if (!data.length) continue;
    if (data.length > PERSONAL_IMPORT_MAX_ROWS) {
      throw new SchoolPageImportError('這張表格超過 500 筆資料，請拆成較小的檔案再匯入。');
    }
    return {
      id: 'table-' + (index + 1) + '-row-' + headerIndex,
      label: '表格 ' + (index + 1) + ' · ' + data.length + ' 筆 · ' + header.filter(Boolean).slice(0, 4).join('／').slice(0, 90),
      rowCount: data.length,
      layout: 'list',
      text: toCsv([header, ...data.map((row) => header.map((_, column) => row[column] ?? ''))]),
    };
  }
  return null;
}

function weeklyCandidate(
  rows: string[][],
  index: number,
  profile?: PeriodProfileId,
): SchoolPageTable | null {
  for (let headerIndex = 0; headerIndex < Math.min(rows.length, 8); headerIndex++) {
    const header = rows[headerIndex];
    if (!/^(?:節次|上課節次|時段|堂次|時間|periods?)$/i.test(normalizedHeader(header[0] ?? ''))) continue;
    const days = header.map(weekday);
    if (new Set(days.filter((day) => day !== null)).size < 2) continue;
    const result: { name: string; day: number; start: number; end: number }[] = [];
    const byDay = new Map<number, { name: string; day: number; start: number; end: number }>();
    for (const row of rows.slice(headerIndex + 1)) {
      const slot = period(row[0] ?? '', profile);
      if (!slot) continue;
      for (let col = 1; col < header.length; col++) {
        const day = days[col];
        const name = (row[col] ?? '').trim();
        if (day === null || !name || /^(?:空堂|無|—|-|N\/A)$/i.test(name)) continue;
        const previous = byDay.get(day);
        if (previous?.name === name && previous.end + 1 === slot) {
          previous.end = slot;
        } else {
          const item = { name, day, start: slot, end: slot };
          result.push(item);
          byDay.set(day, item);
        }
      }
    }
    if (!result.length) continue;
    if (result.length > PERSONAL_IMPORT_MAX_ROWS)
      throw new SchoolPageImportError('這張課表超過 500 筆資料，請分批匯入。');
    return {
      id: 'table-' + (index + 1) + '-grid-' + headerIndex,
      label: '表格 ' + (index + 1) + ' · ' + result.length + ' 門課 · 每週課表',
      layout: 'weekly',
      rowCount: result.length,
      text: toCsv([
        ['課程名稱', '星期', '開始節次', '結束節次'],
        ...result.map((item) => [
          item.name,
          ['一', '二', '三', '四', '五', '六', '日'][item.day - 1],
          profile ? periodLabelAt(item.start, profile) : String(item.start),
          profile ? periodLabelAt(item.end, profile) : String(item.end),
        ]),
      ]),
    };
  }
  return null;
}

export function extractSchoolPageTables(
  markup: string,
  kind: PersonalImportKind,
  profile?: PeriodProfileId,
): SchoolPageTable[] {
  if (typeof markup !== 'string' || markup.length === 0)
    throw new SchoolPageImportError('學校網頁存檔沒有內容，請重新下載。');
  if (markup.length > HTML_LIMIT)
    throw new SchoolPageImportError('學校網頁存檔超過 500 KB，請只複製課表或成績表格。');
  if (!/<table\b/i.test(markup))
    throw new SchoolPageImportError('沒有找到網頁表格。請在校務網站開啟課表或成績列表，再儲存頁面。');
  const cleaned = markup.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const all = cleaned.match(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi) ?? [];
  if (all.length > MAX_TABLES)
    throw new SchoolPageImportError('這個頁面包含太多表格，請只複製要匯入的表格。');
  const found: SchoolPageTable[] = [];
  all.forEach((table, index) => {
    const rows = tableRows(table);
    if (rows.length < 2) return;
    const candidate = listCandidate(rows, index, kind);
    if (candidate) found.push(candidate);
    if (kind === 'timetable') {
      const grid = weeklyCandidate(rows, index, profile);
      if (grid) found.push(grid);
    }
  });
  if (!found.length)
    throw new SchoolPageImportError('找不到符合目前資料類型的表格。請確認已開啟課表／成績列表，或改用 CSV、PDF、截圖。');
  if (found.length > MAX_CANDIDATES)
    throw new SchoolPageImportError('找到的表格過多，請只複製需要匯入的那一張。');
  return found;
}
