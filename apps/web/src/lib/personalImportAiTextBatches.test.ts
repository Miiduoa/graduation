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
  it('never splits quoted multiline TSV cells using newline guesses', () => {
    const text = `課程名稱\t學分\t成績\n${('"跨行\n課名"\t3\t85\n').repeat(100)}`;
    expect(() => plan(text)).toThrow('無法安全拆開');
  });
  it('rejects oversized sources and excessive batch counts before any inference', () => {
    expect(() => plan('文'.repeat(8001))).toThrow('分批');
    expect(() => planPersonalImportAiTextBatches(`課程名稱\t學分\t成績\n${rows.join('\n')}`, { ...limits, maxBatches: 2 })).toThrow('超過 2 段');
  });
  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid budgets (%s)', (maxBatchCharacters) => {
    expect(() => planPersonalImportAiTextBatches('資料庫', { ...limits, maxBatchCharacters })).toThrow('設定');
  });
});
