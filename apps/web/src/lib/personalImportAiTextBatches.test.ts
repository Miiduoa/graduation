import { describe, expect, it } from 'vitest';
import { planPersonalImportAiTextBatches } from '@campus/shared/src/imports/aiTextBatches';
const limits = { maxBatchCharacters: 1000, maxTotalCharacters: 8000, maxBatches: 16 };
const plan = (text: string) => planPersonalImportAiTextBatches(text, limits);
const rows = Array.from({ length: 60 }, (_, index) => `資料庫系統設計與資料分析實務課程${index}\t3\t85`);

describe('lossless import text batches', () => {
  it('keeps a short source byte-for-byte in one request without adding context', () => {
    const text = ' 資料庫 3 學分 85 分\r\n';
    expect(plan(text)).toEqual([{ text, startLine: 1, columnContext: '' }]);
  });
  it.each(['\n', '\r\n'])('preserves all TSV records, columns and source lines with %j endings', (newline) => {
    const source = ['【學期成績】', '課程名稱\t學分\t成績', ...rows].join(newline);
    const batches = plan(source);
    expect(batches).toHaveLength(8);
    expect(batches.map((batch) => batch.text).join('')).toBe(source);
    let offset = 0;
    for (const batch of batches) {
      expect(batch.text.length + batch.columnContext.length).toBeLessThanOrEqual(1000);
      expect(batch.startLine).toBe(source.slice(0, offset).split('\n').length);
      expect(batch.columnContext).toBe(`【學期成績】\n課程名稱\t學分\t成績`);
      expect(batch.text).toMatch(/資料庫系統/);
      offset += batch.text.length;
    }
  });
  it('does not cut a multiline paragraph just because it contains short lines', () => {
    expect(() => plan(('課名\n教師\n時間\n').repeat(150))).toThrow('無法安全拆開');
  });
  it('keeps blank-line-delimited records intact', () => {
    const records = Array.from({ length: 10 }, (_, index) => `第${index}筆\n${'原始內容'.repeat(70)}`);
    const source = records.join('\n\n');
    const batches = plan(source);
    expect(batches.map((batch) => batch.text).join('')).toBe(source);
    for (const record of records) expect(batches.filter((batch) => batch.text.includes(record))).toHaveLength(1);
  });
  it('preserves trailing empty TSV cells rather than changing column counts', () => {
    const source = `課程名稱\t學分\t成績\t教師\n${rows.map((row) => `${row}\t`).join('\n')}`;
    expect(plan(source).map((batch) => batch.text).join('')).toBe(source);
  });
  it('keeps sheet context separate instead of borrowing the previous sheet header', () => {
    const first = `【成績甲】\n課程名稱\t學分\t成績\n${rows.slice(0, 30).join('\n')}\n\n`;
    const second = `【成績乙】\n課程名稱\t學分\t成績\n${rows.slice(30).join('\n')}`;
    const batches = plan(first + second);
    expect(batches.map((batch) => batch.text).join('')).toBe(first + second);
    let offset = 0;
    for (const batch of batches) {
      expect(batch.columnContext).toBe(`【${offset < first.length ? '成績甲' : '成績乙'}】\n課程名稱\t學分\t成績`);
      if (offset < first.length) expect(offset + batch.text.length).toBeLessThanOrEqual(first.length);
      offset += batch.text.length;
    }
  });
  it('splits complete quoted multiline TSV records without cutting a cell', () => {
    const record = '"跨行\n課名"\t3\t85\n';
    const text = `課程名稱\t學分\t成績\n${record.repeat(100)}`;
    const batches = plan(text);
    expect(batches).toHaveLength(13);
    expect(batches.map((batch) => batch.text).join('')).toBe(text);
    expect(batches.every((batch) => batch.text.endsWith(record))).toBe(true);
    expect(batches.reduce((count, batch) => count + batch.text.split(record).length - 1, 0)).toBe(100);
  });
  it.each(['\n', '\r\n'])('rejects an oversized quoted cell containing a blank line (%j)', (newline) => {
    const source = '課程名稱\t學分\t備註' + newline + '資料庫\t3\t"' +
      '說明'.repeat(300) + newline + newline + '附註'.repeat(300) + '"';
    expect(() => plan(source)).toThrow('無法安全拆開');
  });
  it.each(['\n', '\r\n'])('rejects an oversized quoted CSV cell containing a blank line (%j)', (newline) => {
    const source = '課程名稱,學分,備註' + newline + '資料庫,3,"' +
      '說明'.repeat(300) + newline + newline + '附註'.repeat(300) + '"';
    expect(() => plan(source)).toThrow('無法安全拆開');
  });
  it('does not mistake escaped double quotes for the end of a multiline cell', () => {
    const source = '課程名稱\t學分\t備註\n資料庫\t3\t"' + '說明'.repeat(300) +
      ' ""引述\n\n跨段引述"" ' + '附註'.repeat(300) + '"';
    expect(() => plan(source)).toThrow('無法安全拆開');
  });
  it('keeps a bounded quoted cell intact while splitting following complete paragraphs', () => {
    const record = '課程名稱\t學分\t備註\n資料庫\t3\t"' + '說明'.repeat(120) +
      ' ""引述\n\n跨段引述"" ' + '附註'.repeat(120) + '"';
    const source = record + '\n\n另一筆完整紀錄\n' + '其他內容'.repeat(175);
    const batches = plan(source);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.map((batch) => batch.text).join('')).toBe(source);
    expect(batches.filter((batch) => batch.text.includes(record))).toHaveLength(1);
  });
  it('continues to batch ordinary quotation marks in complete prose paragraphs', () => {
    const records = Array.from({ length: 8 }, (_, index) =>
      '第' + index + '筆說明含有 "一般引號"，' + '內容'.repeat(150));
    const source = records.join('\n\n');
    const batches = plan(source);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.map((batch) => batch.text).join('')).toBe(source);
    for (const record of records) expect(batches.filter((batch) => batch.text.includes(record))).toHaveLength(1);
  });
  it('rejects oversized sources and excessive batch counts before any inference', () => {
    expect(() => plan('文'.repeat(8001))).toThrow('分批');
    expect(() => planPersonalImportAiTextBatches(`課程名稱\t學分\t成績\n${rows.join('\n')}`, { ...limits, maxBatches: 2 })).toThrow('超過 2 段');
  });
  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid budgets (%s)', (maxBatchCharacters) => {
    expect(() => planPersonalImportAiTextBatches('資料庫', { ...limits, maxBatchCharacters })).toThrow('設定');
  });
});
