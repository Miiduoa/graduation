import type { PersonalImportOptions } from './types';
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

const privateFieldPattern = '(?:(?:學生)?姓名|(?:學生)?學號|身分證(?:字號)?|身份證(?:字號)?|(?:授課)?教師|老師|(?:student\\s*)?name|student\\s*(?:id|number)|teacher(?:\\s*name)?)';
const privateField = new RegExp(`^${privateFieldPattern}$`, 'iu');
const tableField = /^(?:(?:課程|科目|活動)?名稱|課號|科目代碼|課程代碼|學分數?|成績|分數|學年度|學期|(?:授課)?教師|教室|星期|開始節次|結束節次|日期|開始時間|結束時間|地點|班級|系所|序號|編號|course(?: name| code)?|credits?|grade|score|semester|teacher|room|day|date|start|end|title|location)$/iu;

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
  for (const delimiter of ['\t', ',', '|'] as const) {
    const escaped = delimiter === '|' ? '\\|' : delimiter;
    const privateCell = new RegExp(`(?:^|${escaped})[ \\t]*"?${privateFieldPattern}"?[ \\t]*(?=${escaped}|$)`, 'imu');
    if (!privateCell.test(masked)) continue;
    // 管線表格只用等長替換供結構解析，實際欄位仍由原文字範圍取得。
    const records = readImportDelimitedRecords(delimiter === '|' ? masked.replace(/\|/gu, '\t') : masked, delimiter === '|' ? '\t' : delimiter);
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
      } else if (academic >= 2 || (cells.length === 1 && (academic === 1 || /^【[^【】]+】$/u.test(cells[0])))) {
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
  return maskPrivateTables((context ? `${context}\n${text}` : text).normalize('NFKC')).safe;
}

/** 遮罩明示姓名欄、已知姓名，以及學號與身分證格式；保留課程數值。 */
export function maskPersonalImportText(text: string, knownNames: readonly string[] = []): string {
  let masked = text.normalize('NFKC');
  for (const name of knownNames) {
    const value = name.normalize('NFKC').trim();
    if (value.length >= 2) masked = masked.split(value).join('[姓名已遮罩]');
  }
  masked = maskPrivateTables(masked).text;
  masked = masked.split('\n').map((line) => line
      .replace(/((?:學生姓名|姓名|(?:授課)?教師|老師|student\s*name|name|teacher(?:\s*name)?)[ \t]*[:=][ \t]*)([^\n\t,;|]+?)(?=\s+(?:學號|身分證|身份證|班級|系所|學分|成績|課程|科目|student\s*id|credits?|grade|score)\s*[:=]|$|[,;|])/giu, '$1[姓名已遮罩]')
      .replace(/((?:學生姓名|姓名|(?:授課)?教師|老師)[ ]+)([^\s,;|:]{2,20})(?![ \t]*[:=])/gu, '$1[姓名已遮罩]')
      .replace(/((?:學生)?學號|student\s*(?:id|number))([ \t]*[:=]?[ \t]*)[A-Za-z0-9_-]{4,24}/giu, '$1$2[學號已遮罩]')
  ).join('\n');
  return masked
    .replace(/\b[A-Z][12]\d{8}\b/giu, '[證號已遮罩]')
    .replace(/\b[A-Z]{0,3}\d{7,12}\b/giu, '[學號已遮罩]');
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
