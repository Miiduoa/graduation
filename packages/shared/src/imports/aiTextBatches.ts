export type PersonalImportAiTextBatch = {
  /** Contiguous original text. Context is never part of this evidence range. */
  text: string;
  startLine: number;
  columnContext: string;
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

/** Split only complete rectangular TSV rows or blank-line-delimited paragraphs. */
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
  if (text.length <= maxBatchCharacters) return [{ text, startLine: 1, columnContext: '' }];

  const units: Unit[] = [];
  const paragraphs: Array<[number, number]> = [];
  let start = 0;
  for (const separator of text.matchAll(/\r?\n[\t ]*\r?\n/gu)) {
    const end = separator.index! + separator[0].length;
    paragraphs.push([start, end]);
    start = end;
  }
  if (start < text.length) paragraphs.push([start, text.length]);

  for (const [from, to] of paragraphs) {
    const paragraph = text.slice(from, to);
    const lines: Array<{ text: string; end: number }> = [];
    let offset = from;
    for (const part of paragraph.matchAll(/[^\n]*(?:\n|$)/gu)) {
      if (!part[0]) continue;
      offset += part[0].length;
      if (part[0].trim()) lines.push({ text: part[0].replace(/\r?\n$/u, ''), end: offset });
    }
    const label = lines[0]?.text.match(/^【[^\n【】]+】$/u) ? lines.shift() : undefined;
    const cells = lines.map((line) => line.text.split('\t'));
    const columns = cells[0]?.length ?? 0;
    // Quoted multiline cells and ragged OCR lines are not safe record boundaries.
    const table = columns >= 3 && cells.length >= 2 && cells.every(
      (row) => row.length === columns && row.every((cell) => !cell.includes('"')),
    );
    if (!table) {
      units.push({ start: from, end: to, context: '' });
      continue;
    }
    const hasHeader = cells[0].filter((cell) =>
      headerNames.has(cell.normalize('NFKC').trim().toLowerCase()),
    ).length >= 2;
    const context = [label?.text, hasHeader ? lines[0].text : undefined].filter(Boolean).join('\n');
    // Keep metadata/header with the first data row, never as a header-only request.
    let cursor = from;
    for (let index = hasHeader ? 1 : 0; index < lines.length; index++) {
      const end = index === lines.length - 1 ? to : lines[index].end;
      units.push({ start: cursor, end, context });
      cursor = end;
    }
  }

  const batches: PersonalImportAiTextBatch[] = [];
  let current: Unit | undefined;
  let count = 0;
  const flush = () => {
    if (!current) return;
    batches.push({
      text: text.slice(current.start, current.end),
      startLine: text.slice(0, current.start).split('\n').length,
      columnContext: current.context,
    });
    current = undefined;
    count = 0;
  };
  for (const unit of units) {
    if (unit.end - unit.start + unit.context.length > maxBatchCharacters) {
      throw new Error(
        `有一筆資料或段落超過 ${maxBatchCharacters.toLocaleString('en')} 字元，無法安全拆開。請用空白行分隔完整紀錄，或改匯入原始表格；原文不會被截斷。`,
      );
    }
    if (current && (current.context !== unit.context || count >= 8 ||
      unit.end - current.start + unit.context.length > maxBatchCharacters)) flush();
    current = current ? { ...current, end: unit.end } : { ...unit };
    count++;
  }
  flush();
  if (batches.length > maxBatches)
    throw new Error(`資料需要超過 ${maxBatches} 段才能安全整理，請減少頁面或分批匯入。`);
  // Whitespace-only pieces do not need inference, but preserve their offsets.
  return batches.filter((batch) => batch.text.trim());
}
