import { PERSONAL_IMPORT_NAME_FIELD_PATTERN } from './nameFields';
import type { PersonalImportOptions } from './types';
import type { PersonalImportAiResult } from './aiRecognition';
import { parsePersonalImport } from './parser';
import { readImportDelimitedRecords, type ImportDelimitedRecord } from './aiDelimitedText';

export const PERSONAL_IMPORT_CLOUD_MAX_TEXT = 8_000;
export const PERSONAL_IMPORT_CLOUD_TIMEOUT_MS = 25_000;
export type PersonalImportCloudFailure = 'disabled' | 'quota' | 'timeout' | 'unavailable' | 'unauthenticated' | 'invalid-input';
export type PersonalImportCloudResult =
  | { ok: true; output: string; sourceText: string; columnContext: string }
  | { ok: false; reason: PersonalImportCloudFailure; message: string };

const messages: Record<PersonalImportCloudFailure, string> = {
  disabled: '雲端整理尚未啟用，改用本機整理。',
  quota: '雲端整理額度已用完，改用本機整理。',
  timeout: '雲端整理等候逾時，改用本機整理。',
  unavailable: '雲端整理暫時無法使用，改用本機整理。',
  unauthenticated: '目前無法確認登入狀態，改用本機整理。',
  'invalid-input': '這段內容無法交給雲端整理，改用本機整理。',
};

// 所有個資欄共用字間正規化，避免表格、直排與行內標籤各自漏掉變體。
const privateLabelPattern = [
  '學生名字', '名字', '學生學號', '學號', 'studentid', 'studentnumber',
  '身分證', '身分證字號', '身份證', '身份證字號',
  '電子郵件', '電郵', '聯絡電話', '電話', '手機', '手機號碼',
  'email', 'phone', 'mobile',
].map((field) => [...field].join('[ \\t_()（）:：-]*')).join('|');
const privateFieldPattern = `(?:${PERSONAL_IMPORT_NAME_FIELD_PATTERN}|${privateLabelPattern})`;
const privateField = new RegExp(`^${privateFieldPattern}$`, 'iu');
const privateTableDelimiters = ['\t', ',', '|', ';', '、'] as const;
const tableField = /^(?:(?:課程|科目|活動)?名稱|課號|科目代碼|課程代碼|學分數?|成績|分數|學年度|學期|(?:授課)?教師|教室|星期|開始節次|結束節次|日期|開始時間|結束時間|地點|班級|系所|序號|編號|course(?: name| code)?|credits?|grade|score|semester|teacher|room|day|date|start|end|title|location)$/iu;

function isAcademicBoundary(value: string): boolean {
  return tableField.test(value) || /^【[^【】]+】$/u.test(value) ||
    value.split(/[\t,|;、]/u).filter((cell) => tableField.test(cell.trim())).length >= 2 ||
    // 無表頭的三欄成績列也可形成邊界，避免把課名當成續行姓名。
    /^[^\t,|;、]+([\t,|;、])[ \t]*\d+(?:\.\d+)?\1[ \t]*(?:\d{1,3}(?:\.\d+)?|[A-F][+-]?|通過|及格)$/iu.test(value) ||
    (/學分\s*[:：]?\s*\d/u.test(value) && /(?:成績|分數)\s*[:：]?\s*(?:\d|[A-F])/iu.test(value)) ||
    /\S[ \t]+\d+(?:\.\d+)?[ \t]+(?:\d{1,3}(?:\.\d+)?|[A-F][+-]?|通過|及格)$/iu.test(value);
}

function hasAmbiguousPrivateList(text: string): boolean {
  const labeledValue = new RegExp(`${privateFieldPattern}[ \\t]*[:=][ \\t]*([^\\n]*)`, 'giu');
  for (const match of text.matchAll(labeledValue)) {
    for (const tail of match[1].split(/[\t,;|、]/u).slice(1)) {
      if (!tail.trim()) continue;
      const field = tail.trim().match(/^([^:=]+)[:=]/u)?.[1].trim();
      if (!field || (!privateField.test(field) && !tableField.test(field) && !/^(?:課程|科目)$/u.test(field))) return true;
    }
  }
  return false;
}

/** OCR 會把標籤和值拆成不同列；保留換行，無法辨別欄位邊界時停用雲端。 */
function maskPrivateVerticalFields(text: string): { text: string; safe: boolean } {
  const lines = text.split('\n');
  const label = new RegExp(`^${privateFieldPattern}[ \\t]*[:=]?$`, 'iu');
  const inlineLabel = new RegExp(`^${privateFieldPattern}[ \\t]*[:=]`, 'iu');
  let safe = true;
  for (let index = 0; index < lines.length; index++) {
    const field = lines[index].trim();
    const bareLabel = label.test(field);
    if (!bareLabel && !inlineLabel.test(field)) continue;
    // 行內已有值仍可能接續多行姓名；直到明確的下一欄或學業資料才停止。
    let values = bareLabel ? 0 : 1;
    for (let next = index + 1; next < lines.length; next++) {
      const value = lines[next].trim();
      if (!value) continue;
      if (label.test(value) || inlineLabel.test(value) || isAcademicBoundary(value)) break;
      if (!/^[\p{L}\p{M}\d .@_+()\-'’·•]+$/u.test(value) && !/^\[(?:姓名|學號|證號|個資|聯絡資料)已遮罩\]$/u.test(value)) {
        safe = false;
        break;
      }
      lines[next] = `[個資已遮罩]${lines[next].endsWith('\r') ? '\r' : ''}`;
      values++;
    }
    if (!values) safe = false;
  }
  return { text: lines.join('\n'), safe };
}

function rawCellSpans(text: string, record: ImportDelimitedRecord, delimiter: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = record.start;
  let quoted = false;
  for (let index = start; index < record.contentEnd; index++) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && text[index] === delimiter) {
      spans.push([start, index]);
      start = index + 1;
    }
  }
  spans.push([start, record.contentEnd]);
  return spans;
}

function maskPrivateTables(text: string): { text: string; safe: boolean } {
  let masked = text;
  for (const delimiter of privateTableDelimiters) {
    const escaped = delimiter === '|' ? '\\|' : delimiter;
    const privateCell = new RegExp(`(?:^|${escaped})[ \\t]*"?${privateFieldPattern}"?[ \\t]*(?=${escaped}|$)`, 'imu');
    if (!privateCell.test(masked)) continue;
    const records = readImportDelimitedRecords(masked, delimiter);
    if (!records) return { text: masked, safe: false };
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    let privateColumns: number[] = [];
    let width = 0;
    for (const [recordIndex, record] of records.entries()) {
      const cells = record.cells.map((cell) => cell.trim());
      if (cells.every((cell) => !cell)) continue;
      const named = cells.flatMap((cell, index) => privateField.test(cell) ? [index] : []);
      const academic = cells.filter((cell) => tableField.test(cell)).length;
      const keyValue = named.length > 0 && cells.length % 2 === 0 && cells.every((cell, index) =>
        index % 2 === 0 ? privateField.test(cell) || tableField.test(cell)
          : !privateField.test(cell) && !tableField.test(cell));
      let columns: number[] = [];
      if (keyValue) {
        const next = records.slice(recordIndex + 1).find((item) => item.cells.some((cell) => cell.trim()));
        if (next && next.cells.length === cells.length && !next.cells.some((cell) => privateField.test(cell.trim())) &&
          next.cells.filter((cell) => tableField.test(cell.trim())).length < 2) return { text: masked, safe: false };
        columns = named.map((index) => index + 1);
        privateColumns = [];
        width = 0;
      } else if (named.length) {
        if (named.some((index) => index + 1 < cells.length && !privateField.test(cells[index + 1]) && !tableField.test(cells[index + 1])))
          return { text: masked, safe: false };
        privateColumns = named;
        width = cells.length;
      } else if (academic >= 2 || (cells.length === 1 && isAcademicBoundary(cells[0])) ||
        (width === 1 && isAcademicBoundary(masked.slice(record.start, record.contentEnd).trim()))) {
        privateColumns = [];
        width = 0;
      } else if (privateColumns.length) {
        if (cells.length !== width) return { text: masked, safe: false };
        columns = privateColumns;
      }
      const spans = rawCellSpans(masked, record, delimiter);
      if (spans.length !== cells.length) return { text: masked, safe: false };
      for (const index of columns) {
        if (!cells[index]) continue;
        const [start, end] = spans[index];
        const raw = masked.slice(start, end);
        const newlines = raw.match(/\r?\n/gu)?.join('') ?? '';
        const value = raw.trim().startsWith('"') || newlines ? `"[個資已遮罩]${newlines}"` : '[個資已遮罩]';
        replacements.push({ start, end, value });
      }
    }
    for (const item of replacements.reverse()) masked = masked.slice(0, item.start) + item.value + masked.slice(item.end);
  }
  return { text: masked, safe: true };
}

/** 格式不完整的姓名欄不送出，保留在裝置上交由本機整理。 */
export function isPersonalImportCloudMaskSafe(text: string, context = ''): boolean {
  const normalized = (context ? `${context}\n${text}` : text).normalize('NFKC');
  if (hasAmbiguousPrivateList(normalized)) return false;
  // 未知的個資標籤無法可靠對應欄位，整份資料留在裝置。
  if (normalized.split(/[\n\t,|;、/:=]/u).some((cell) => {
    const field = cell.replace(/\[(?:姓名|學號|證號|個資|聯絡資料)已遮罩\]/gu, '').trim().replace(/^"|"$/gu, '');
    if (/^[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}$/iu.test(field)) return false;
    const compact = field.normalize('NFKC').replace(/[\s_()（）:：-]/gu, '');
    return /姓名|名字|學號|學生|身分證|身份證|郵件|電郵|電話|手機|student|name|instructor|teacher|教授|教師|老師|email|phone|mobile/iu.test(compact) &&
      !privateField.test(field);
  })) return false;
  // OCR 空白分欄沒有可靠的欄界；不能把相鄰欄名誤當成姓名值遮罩。
  if (normalized.split('\n').some((line) => {
    const cells = line.trim().split(/ +/u);
    return cells.length > 1 && cells.some((cell) => privateField.test(cell));
  })) return false;
  // 明示個資欄名必須有可識別的欄界；未知分隔符或混合欄界一律留在本機。
  const explicitField = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${privateFieldPattern}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
  const labeledField = new RegExp(`^${privateFieldPattern}[ \\t]*[:=]`, 'iu');
  const verticalField = new RegExp(`^${privateFieldPattern}[ \\t]*[:=]?$`, 'iu');
  for (const line of normalized.split('\n')) {
    const value = line.trim();
    if (!explicitField.test(value) || verticalField.test(value)) continue;
    if (labeledField.test(value)) {
      const headerFields = value.replace(/[\p{L}\p{N}_]+[ \t]*[:=][ \t]*(?=[0-9])/gu, '')
        .split(/[^\p{L}\p{N}_]+/u).filter((cell) => tableField.test(cell));
      if (/[:=]{2}/u.test(value) || headerFields.length >= 2) return false;
      continue;
    }
    if (!privateTableDelimiters.some((delimiter) => {
      const records = readImportDelimitedRecords(value, delimiter);
      return records?.length === 1 && records[0].cells.some((cell) => privateField.test(cell.trim()));
    })) return false;
  }
  const vertical = maskPrivateVerticalFields(normalized);
  return vertical.safe && maskPrivateTables(vertical.text).safe;
}

/** 遮罩明示姓名欄、已知姓名，以及學號與身分證格式；保留課程數值。 */
export function maskPersonalImportText(text: string, knownNames: readonly string[] = []): string {
  let masked = text.normalize('NFKC');
  for (const name of knownNames) {
    const value = name.normalize('NFKC').trim();
    if (value.length >= 2) masked = masked.split(value).join('[姓名已遮罩]');
  }
  masked = maskPrivateTables(maskPrivateVerticalFields(masked).text).text;
  masked = masked.split('\n').map((line) => line
      .replace(new RegExp(`((?:${privateLabelPattern})[ \\t]*[:=][ \\t]*)([^\\n\\t,;|]+?)(?=\\s+(?:學分|成績|課程|科目|credits?|grade|score)\\s*[:=]|$|[\\t,;|])`, 'giu'), '$1[個資已遮罩]')
      .replace(/((?:電子郵件|電郵|(?:聯絡)?電話|手機(?:號碼)?|e-?mail|phone|mobile)[ \t]*[:=][ \t]*)([^\n\t,;|]+?)(?=\s+(?:學號|身分證|身份證|班級|系所|學分|成績|課程|科目|姓名|教師|電子郵件|電郵|電話|手機|student\s*id|credits?|grade|score|e-?mail|phone)\s*[:=]|$|[\t,;|])/giu, '$1[聯絡資料已遮罩]')
      .replace(new RegExp(`((?:${PERSONAL_IMPORT_NAME_FIELD_PATTERN})[ \\t]*[:=][ \\t]*)([^\\n\\t,;|]+?)(?=\\s+(?:學號|身分證|身份證|班級|系所|學分|成績|課程|科目|student\\s*id|credits?|grade|score)\\s*[:=]|$|[\\t,;|])`, 'giu'), '$1[姓名已遮罩]')
      .replace(new RegExp(`((?:${PERSONAL_IMPORT_NAME_FIELD_PATTERN})[ ]+)([^\\s,;|:]{2,20})(?![ \\t]*[:=])`, 'giu'), '$1[姓名已遮罩]')
      .replace(/((?:學生)?學號|student\s*(?:id|number))([ \t]*[:=]?[ \t]*)[A-Za-z0-9_-]{4,24}/giu, '$1$2[學號已遮罩]')
  ).join('\n');
  return masked
    .replace(/[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/giu, '[聯絡資料已遮罩]')
    .replace(/\(0[2-8]\)[ -]?\d{3,4}[ -]?\d{4}\b/gu, '[聯絡資料已遮罩]')
    .replace(/(?<![A-Za-z0-9])(?:\+?886[ -]?(?:0[ -]?)?|0)(?:9\d{2}[ -]?\d{3}[ -]?\d{3}|[2-8][ -]?\d{3,4}[ -]?\d{4})(?!\d)/gu, '[聯絡資料已遮罩]')
    .replace(/\b[A-Z][12]\d{8}\b/giu, '[證號已遮罩]')
    .replace(/\b[A-Z]{0,3}\d{7,12}\b/giu, '[學號已遮罩]');
}

/** 雲端片段取自整份文件的遮罩副本，本機與重試仍使用原始文字。 */
export function maskPersonalImportCloudBatch(
  source: string,
  batch: { text: string; startLine: number; columnContext?: string },
  knownNames: readonly string[] = [],
): { sourceText: string; columnContext: string } | null {
  if (!Number.isSafeInteger(batch.startLine) || batch.startLine < 1 || !isPersonalImportCloudMaskSafe(source)) return null;
  const lines = source.split('\n');
  const start = batch.startLine - 1;
  if (start >= lines.length) return null;
  const offset = start ? lines.slice(0, start).join('\n').length + 1 : 0;
  if (source.slice(offset, offset + batch.text.length) !== batch.text ||
    (offset + batch.text.length < source.length && !batch.text.endsWith('\n'))) return null;
  const masked = maskPersonalImportText(source, knownNames).split('\n');
  if (masked.length !== lines.length) return null;
  const length = batch.text.split('\n').length - (batch.text.endsWith('\n') ? 1 : 0);
  const sourceText = masked.slice(start, start + length).join('\n') + (batch.text.endsWith('\n') ? '\n' : '');
  return { sourceText, columnContext: maskPersonalImportText(batch.columnContext ?? '', knownNames) };
}

export function maskPersonalImportCloudInput(text: string, context = '', knownNames: readonly string[] = []): { sourceText: string; columnContext: string } {
  if (!context) return { sourceText: maskPersonalImportText(text, knownNames), columnContext: '' };
  const lines = context.split('\n').length;
  const masked = maskPersonalImportText(`${context}\n${text}`, knownNames).split('\n');
  return { sourceText: masked.slice(lines).join('\n'), columnContext: masked.slice(0, lines).join('\n') };
}

function cancelled(): Error {
  const error = new Error('已取消整理，完成的結果仍保留。');
  error.name = 'AbortError';
  return error;
}

export async function requestPersonalImportCloud(input: {
  text: string;
  kind: PersonalImportOptions['kind'];
  columnContext?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  knownNames?: readonly string[];
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PersonalImportCloudResult> {
  const failure = (reason: PersonalImportCloudFailure): PersonalImportCloudResult => ({ ok: false, reason, message: messages[reason] });
  if (input.signal?.aborted) throw cancelled();
  if (!isPersonalImportCloudMaskSafe(input.text, input.columnContext)) return failure('invalid-input');
  const { sourceText, columnContext } = maskPersonalImportCloudInput(input.text, input.columnContext, input.knownNames);
  if (!sourceText.trim() || sourceText.length + columnContext.length > PERSONAL_IMPORT_CLOUD_MAX_TEXT) return failure('invalid-input');
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const boundary = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, input.timeoutMs ?? PERSONAL_IMPORT_CLOUD_TIMEOUT_MS);
    abortListener = () => { controller.abort(); reject(cancelled()); };
    input.signal?.addEventListener('abort', abortListener, { once: true });
  });
  try {
    const operation = (async (): Promise<PersonalImportCloudResult> => {
      const response = await (input.fetcher ?? fetch)(input.endpoint ?? '/api/personal-import/recognize', {
        method: 'POST',
        credentials: 'include',
        headers: { ...input.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: sourceText, kind: input.kind, columnContext }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 409) return failure('unauthenticated');
        if (response.status === 429) return failure('quota');
        if (response.status === 408 || response.status === 504) return failure('timeout');
        if (response.status === 400 || response.status === 413 || response.status === 422) return failure('invalid-input');
        let code: unknown;
        try { code = (await response.json())?.code; } catch { /* 錯誤頁也可退回本機。 */ }
        return failure(code === 'disabled' ? 'disabled' : 'unavailable');
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object') return failure('unavailable');
      const value = body as Record<string, unknown>;
      const expected = maskPersonalImportCloudInput(sourceText, columnContext);
      if (typeof value.output !== 'string' || !value.output.trim() || value.output.length > 80_000 ||
        typeof value.sourceText !== 'string' || value.sourceText !== expected.sourceText ||
        (value.columnContext !== undefined && value.columnContext !== expected.columnContext)) return failure('unavailable');
      return { ok: true, output: value.output, sourceText: value.sourceText, columnContext: typeof value.columnContext === 'string' ? value.columnContext : columnContext };
    })();
    return await Promise.race([operation, boundary]);
  } catch {
    if (input.signal?.aborted) throw cancelled();
    return failure(timedOut ? 'timeout' : 'unavailable');
  } finally {
    clearTimeout(timer);
    if (abortListener) input.signal?.removeEventListener('abort', abortListener);
  }
}

/** 雲端只能核對遮罩副本；交付草稿前以裝置上的原文還原來源與教師。 */
export function restorePersonalImportCloudRows(
  result: PersonalImportAiResult,
  text: string,
  options: PersonalImportOptions,
  columnContext = '',
): void {
  const prefix = columnContext && !text.includes(columnContext) ? `${columnContext}\n` : '';
  const prefixLines = prefix.split('\n').length - 1;
  const local = parsePersonalImport(prefix + text, options).rows;
  const lines = text.split('\n');
  for (const row of result.rows) {
    const matches = local.filter((candidate) =>
      candidate.source.line - prefixLines === row.source.line && candidate.title === row.title);
    const original = matches.length === 1 ? matches[0] : undefined;
    const rawText = original?.source.rawText ?? lines.slice(
      row.source.line - 1,
      row.source.line - 1 + row.source.rawText.split('\n').length,
    ).join('\n');
    row.source.rawText = rawText;
    // 教師已被送出前遮罩，不能採信模型自行補出的姓名。
    row.teacher = original?.teacher && !/已遮罩/u.test(original.teacher) ? original.teacher : undefined;
    if (!row.teacher && options.kind !== 'events') result.issues.push({
      code: 'cloud-teacher-missing', severity: 'warning', rowId: row.id, field: 'teacher',
      message: '無法從原文還原教師，請核對並補上教師。',
    });
  }
}
