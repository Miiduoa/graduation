import { describe, expect, it } from 'vitest';
import {
  planResilientPersonalImportBatches,
  splitPersonalImportAiTextBatch,
} from '@campus/shared/src/imports/aiTextBatches';

const limits = { maxBatchCharacters: 1000, maxTotalCharacters: 40_000, maxBatches: 80 };
const plan = (text: string) => planResilientPersonalImportBatches(text, limits);

function expectLossless(source: string, batches: ReturnType<typeof plan>['batches']) {
  expect(batches.map((batch) => batch.text).join('')).toBe(source);
  let position = 0;
  for (const batch of batches) {
    expect(batch.startLine).toBe(source.slice(0, position).split('\n').length);
    if (!batch.rulesOnly)
      expect(batch.text.length + batch.columnContext.length).toBeLessThanOrEqual(1000);
    position += batch.text.length;
  }
}

describe('resilient import segmentation', () => {
  it('keeps completed-size paragraphs on both sides of an indivisible oversized paragraph', () => {
    const first = '資料庫 3 學分 成績 85\n\n';
    const oversized = '完整原始內容'.repeat(300) + '\n\n';
    const last = '微積分 2 學分 成績 90';
    const source = first + oversized + last;
    const result = plan(source);
    expectLossless(source, result.batches);
    expect(result.batches).toHaveLength(3);
    expect(result.batches.map((batch) => Boolean(batch.rulesOnly))).toEqual([false, true, false]);
    expect(result.batches[1].text).toBe(oversized);
    expect(result.issues).toHaveLength(1);
  });

  it.each([',', '\t'] as const)('keeps an oversized quoted %j record intact and continues subsequent records', (delimiter) => {
    const first = ['課程名稱', '學分', '備註'].join(delimiter) + '\r\n';
    const huge = ['資料庫', '3', '"' + '段落'.repeat(350) + '\r\n\r\n' + '附註'.repeat(350) + '"']
      .join(delimiter) + '\r\n';
    const last = ['微積分', '2', '完整紀錄'].join(delimiter);
    const source = first + huge + last;
    const result = plan(source);
    expectLossless(source, result.batches);
    expect(result.batches).toHaveLength(2);
    expect(result.batches[0]).toMatchObject({ text: first + huge, rulesOnly: true });
    expect(result.batches[1].text).toBe(last);
    expect(result.batches[1].rulesOnly).toBeUndefined();
    expect(result.batches[1].columnContext).toBe(first.trim());
  });

  it('segments more than 8000 source characters without increasing the model request budget', () => {
    const source = '課程名稱\t學分\t成績\n' + Array.from({ length: 400 }, (_, i) =>
      `資料分析與資料庫系統實務課程${i}\t3\t85\n`).join('');
    expect(source.length).toBeGreaterThan(8000);
    const result = plan(source);
    expectLossless(source, result.batches);
    expect(result.batches).toHaveLength(50);
    expect(result.issues).toEqual([]);
    expect(result.batches.every((batch) => !batch.rulesOnly)).toBe(true);
  });

  it.each([
    '資料庫 3 學分 成績 85',
    '資料庫 星期一 09:00 至 11:00',
  ])('splits self-contained OCR lines with explicit evidence: %s', (record) => {
    const source = Array.from({ length: 40 }, () => record).join('\n');
    const result = plan(source);
    expectLossless(source, result.batches);
    expect(result.batches).toHaveLength(5);
    expect(result.issues).toEqual([]);
    for (const batch of result.batches) {
      const halves = splitPersonalImportAiTextBatch(batch);
      expect(halves).not.toBeNull();
      expect(halves?.map((half) => half.text).join('')).toBe(batch.text);
      expect(halves?.every((half) => half.text.trim().split('\n').every((line) => line === record))).toBe(true);
    }
  });

  it('keeps vertically arranged OCR fields together when their row boundaries are unknown', () => {
    const source = ('資料庫\n學分 3\n成績 85\n').repeat(100);
    const result = plan(source);
    expect(result.batches).toEqual([{ text: source, startLine: 1, columnContext: '', rulesOnly: true }]);
  });

  it('does not split inside malformed quoted CSV that contains plausible independent lines', () => {
    const source = '課程名稱,備註\n資料庫,"' + ('資料庫 3 學分 成績 85\n').repeat(100);
    const result = plan(source);
    expect(result.batches).toEqual([{ text: source, startLine: 1, columnContext: '', rulesOnly: true }]);
  });

  it('bounds the number of model segments while retaining the complete remaining source', () => {
    const source = '課程名稱,學分,成績\n' + Array.from({ length: 50 }, (_, i) => `課${i},3,85\n`).join('');
    const result = planResilientPersonalImportBatches(source, { ...limits, maxBatches: 3 });
    expectLossless(source, result.batches);
    expect(result.batches).toHaveLength(3);
    expect(result.batches.map((batch) => Boolean(batch.rulesOnly))).toEqual([false, false, true]);
    expect(result.batches[2].text).toContain('課49,3,85');
  });

  it('rejects a source beyond the explicit total limit without silently trimming it', () => {
    expect(() => plan('文'.repeat(40_001))).toThrow('40,000');
  });
});
