import { readImportDelimitedRecords } from './aiDelimitedText';

export type PersonalImportAiTextBatch = {
  /** Contiguous original text. Context is never part of this evidence range. */
  text: string;
  startLine: number;
  columnContext: string;
  /** Verified boundaries only; offsets are relative to text, including its metadata. */
  recordStarts?: number[];
};

type Limits = { maxBatchCharacters: number; maxTotalCharacters: number; maxBatches: number };
type Unit = { start: number; end: number; context: string };
const headerNames = new Set([
  '課程名稱', '科目名稱', '名稱', '課號', '科目代碼', '課程代碼', '學分', '學分數', '成績',
  '分數', '學年度', '學期', '教師', '授課教師', '教室', '星期', '開始節次', '結束節次',
  '日期', '開始時間', '結束時間', '地點', '活動名稱',
  'course', 'course name', 'course code', 'credits', 'credit', 'grade', 'score',
  'semester', 'teacher', 'room', 'day', 'date', 'start', 'end', 'title', 'location',
]);

function tableUnits(text: string, from: number, to: number): Unit[] | null {
  const paragraph = text.slice(from, to);
  const candidates: Unit[][] = [];
  for (const delimiter of ['\t', ','] as const) {
    const parsed = readImportDelimitedRecords(paragraph, delimiter);
    if (!parsed) continue;
    const records = parsed.filter((record) => paragraph.slice(record.start, record.contentEnd).trim());
    const first = records[0];
    const label = first && first.cells.length === 1 && /^【[^\n\r【】]+】$/u.test(first.cells[0].trim())
      ? records.shift() : undefined;
    const columns = records[0]?.cells.length ?? 0;
    if (columns < 2 || records.length < 2 || records.some((record) => record.cells.length !== columns))
      continue;
    const hasHeader = records[0].cells.filter((cell) =>
      headerNames.has(cell.normalize('NFKC').trim().toLowerCase()),
    ).length >= 2;
    // Plain prose can contain commas. Require a recognizable CSV header rather
    // than treating every rectangular-looking paragraph as independent records.
    if (!hasHeader && (delimiter === ',' || columns < 3)) continue;
    const rawRecord = (record: typeof first) => paragraph.slice(record.start, record.contentEnd);
    const context = [label ? rawRecord(label).trim() : '', hasHeader ? rawRecord(records[0]) : '']
      .filter(Boolean).join('\n');
    const units: Unit[] = [];
    let cursor = from;
    for (let index = hasHeader ? 1 : 0; index < records.length; index++) {
      const end = index === records.length - 1 ? to : from + records[index].end;
      units.push({ start: cursor, end, context });
      cursor = end;
    }
    candidates.push(units);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/** Split complete delimited records or blank-line-separated paragraphs; never cut a cell. */
export function planPersonalImportAiTextBatches(
  text: string,
  { maxBatchCharacters, maxTotalCharacters, maxBatches }: Limits,
): PersonalImportAiTextBatch[] {
  if (
    ![maxBatchCharacters, maxTotalCharacters, maxBatches].every((n) => Number.isSafeInteger(n) && n > 0) ||
    maxBatchCharacters > maxTotalCharacters || maxTotalCharacters > 8_000 || maxBatches > 80
  ) throw new Error('AI 分段範圍設定不正確。');
  if (typeof text !== 'string' || !text.trim()) throw new Error('請先放入要整理的文字。');
  if (text.length > maxTotalCharacters)
    throw new Error(`這次文字超過 ${maxTotalCharacters.toLocaleString('en')} 字元，請分批整理；不會截掉後面的內容。`);

  const units: Unit[] = [];
  const paragraphs: Array<[number, number]> = [];
  let start = 0;
  let scanOffset = 0;
  let quotedCell = false;
  for (const separator of text.matchAll(/\r?\n[\t ]*\r?\n/gu)) {
    for (; scanOffset < separator.index!; scanOffset++) {
      if (text[scanOffset] !== '"') continue;
      if (quotedCell && text[scanOffset + 1] === '"') {
        scanOffset++;
      } else if (quotedCell) {
        quotedCell = false;
      } else if (
        scanOffset === 0 || (scanOffset === 1 && text[0] === '\uFEFF') ||
        text[scanOffset - 1] === '\t' || text[scanOffset - 1] === ',' || text[scanOffset - 1] === '\n'
      ) {
        quotedCell = true;
      }
    }
    if (quotedCell) continue;
    const end = separator.index! + separator[0].length;
    paragraphs.push([start, end]);
    start = end;
  }
  if (start < text.length) paragraphs.push([start, text.length]);

  let leadingWhitespace: number | undefined;
  for (const [from, to] of paragraphs) {
    if (!text.slice(from, to).trim()) {
      if (units.length) units[units.length - 1].end = to;
      else leadingWhitespace ??= from;
      continue;
    }
    const table = tableUnits(text, from, to);
    const next = table ?? [{ start: from, end: to, context: '' }];
    if (leadingWhitespace !== undefined) {
      next[0].start = leadingWhitespace;
      leadingWhitespace = undefined;
    }
    units.push(...next);
  }

  // Preserve the original small-source contract, except that many short table
  // records still need the output budget protection of the eight-record cap.
  if (text.length <= maxBatchCharacters && units.length <= 8) {
    return [{
      text,
      startLine: 1,
      columnContext: '',
      ...(units.length > 1 && text.length + units[0].context.length <= maxBatchCharacters &&
        units.every((unit) => unit.context === units[0].context)
        ? { recordStarts: units.map((unit) => unit.start), columnContext: units[0].context }
        : {}),
    }];
  }

  const batches: PersonalImportAiTextBatch[] = [];
  let group: Unit[] = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0];
    batches.push({
      text: text.slice(first.start, group[group.length - 1].end),
      startLine: text.slice(0, first.start).split('\n').length,
      columnContext: first.context,
      ...(group.length > 1 ? { recordStarts: group.map((unit) => unit.start - first.start) } : {}),
    });
    group = [];
  };
  for (const unit of units) {
    if (unit.end - unit.start + unit.context.length > maxBatchCharacters) {
      throw new Error(
        `有一筆資料或段落超過 ${maxBatchCharacters.toLocaleString('en')} 字元，無法安全拆開。請用空白行分隔完整紀錄，或改匯入原始表格；原文不會被截斷。`,
      );
    }
    if (group.length && (group[0].context !== unit.context || group.length >= 8 ||
      unit.end - group[0].start + unit.context.length > maxBatchCharacters)) flush();
    group.push(unit);
  }
  flush();
  if (batches.length > maxBatches)
    throw new Error(`資料需要超過 ${maxBatches} 段才能安全整理，請減少頁面或分批匯入。`);
  return batches;
}

/** Retry only at boundaries found by the planner. Neither half gains source text. */
export function splitPersonalImportAiTextBatch(
  batch: PersonalImportAiTextBatch,
): [PersonalImportAiTextBatch, PersonalImportAiTextBatch] | null {
  const starts = batch.recordStarts;
  if (!starts || starts.length < 2 || starts.length > 8 || starts[0] !== 0 ||
    starts.some((offset, index) => !Number.isSafeInteger(offset) || offset < 0 ||
      offset >= batch.text.length || (index > 0 && offset <= starts[index - 1]))) return null;
  const middle = Math.floor(starts.length / 2);
  const cut = starts[middle];
  const left = batch.text.slice(0, cut);
  return [
    { ...batch, text: left, recordStarts: starts.slice(0, middle) },
    {
      text: batch.text.slice(cut),
      startLine: batch.startLine + left.split('\n').length - 1,
      columnContext: batch.columnContext,
      recordStarts: starts.slice(middle).map((offset) => offset - cut),
    },
  ];
}
