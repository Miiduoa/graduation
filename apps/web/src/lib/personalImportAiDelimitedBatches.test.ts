import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readImportDelimitedRecords } from '@campus/shared/src/imports/aiDelimitedText';
import { planPersonalImportAiTextBatches, splitPersonalImportAiTextBatch } from '@campus/shared/src/imports/aiTextBatches';

const limits = { maxBatchCharacters: 1000, maxTotalCharacters: 8000, maxBatches: 16 };
const plan = (text: string) => planPersonalImportAiTextBatches(text, limits);
const quote = (text: string) => `"${text.replace(/"/gu, '""')}"`;

function assertLossless(source: string) {
  const batches = plan(source);
  assert.equal(batches.map((batch) => batch.text).join(''), source);
  let offset = 0;
  for (const batch of batches) {
    assert.ok(batch.text.length + batch.columnContext.length <= limits.maxBatchCharacters);
    assert.equal(batch.startLine, source.slice(0, offset).split('\n').length);
    if (batch.recordStarts) {
      assert.ok(batch.recordStarts.length <= 8);
      assert.equal(batch.recordStarts[0], 0);
    }
    offset += batch.text.length;
  }
  return batches;
}

describe('quoted table boundaries and bounded retry ranges', () => {
  it('caps even a sub-1000-character CSV at eight data records per inference', () => {
    const source = '課程名稱,學分,成績\n' + Array.from({ length: 25 }, (_, i) => `課${i},3,85`).join('\n');
    assert.ok(source.length < 1000);
    const batches = assertLossless(source);
    assert.equal(batches.length, 4);
    assert.deepEqual(batches.map((batch) => batch.recordStarts?.length ?? 1), [8, 8, 8, 1]);
    assert.ok(batches.every((batch) => batch.columnContext === '課程名稱,學分,成績'));
  });
  it('recognizes two-column tables with headers, but not headerless prose with commas', () => {
    const table = '課程名稱,成績\n' + Array.from({ length: 20 }, (_, i) => `課${i},85`).join('\n');
    assert.equal(assertLossless(table).length, 3);
    const prose = Array.from({ length: 20 }, (_, i) => `說明${i},時間,地點`).join('\n');
    assert.equal(plan(prose).length, 1);
    assert.equal(plan(prose)[0].recordStarts, undefined);
    assert.throws(() => plan(prose.repeat(8)), /無法安全拆開/u);
  });
  for (const delimiter of [',', '\t'] as const) {
    for (const newline of ['\n', '\r\n']) {
      it(`preserves quoted delimiters, escaped quotes and embedded blank lines (${JSON.stringify([delimiter, newline])})`, () => {
        const values = Array.from({ length: 19 }, (_, i) => [
          `課程${i}含${delimiter}逗號與"引號"`, '3', `說明${newline}${newline}第二行`,
        ]);
        const header = ['課程名稱', '學分', '備註'].map(quote).join(delimiter);
        const records = values.map((cells) => cells.map(quote).join(delimiter));
        const source = '\uFEFF' + [header, ...records].join(newline) + newline;
        const decoded = readImportDelimitedRecords(source, delimiter);
        assert.ok(decoded);
        assert.deepEqual(decoded.slice(1).map((record) => record.cells), values);
        const batches = assertLossless(source);
        for (const record of records) {
          assert.equal(batches.filter((batch) => batch.text.includes(record)).length, 1);
        }
        for (const batch of batches) {
          const retry = splitPersonalImportAiTextBatch(batch);
          if (!retry) continue;
          assert.equal(retry.map((part) => part.text).join(''), batch.text);
          for (const record of records.filter((record) => batch.text.includes(record))) {
            assert.equal(retry.filter((part) => part.text.includes(record)).length, 1);
          }
          assert.equal(retry[1].startLine, batch.startLine + retry[0].text.split('\n').length - 1);
          assert.ok(retry.every((part) => part.columnContext === batch.columnContext));
        }
      });
    }
  }
  it('never turns an empty final cell into one fewer column', () => {
    const source = '課程名稱,學分,成績,教師\n' + Array.from({ length: 20 }, (_, i) => `課${i},3,85,`).join('\n');
    const records = readImportDelimitedRecords(source, ',');
    assert.ok(records);
    assert.ok(records.every((record) => record.cells.length === 4));
    assertLossless(source);
  });
  it('keeps leading and inter-sheet whitespace without leaking headers between sheets', () => {
    const sheet = (name: string) => `【${name}】\n課程名稱,學分,成績\n` +
      Array.from({ length: 12 }, (_, i) => `${name}${i},3,85`).join('\n') + '\n\n';
    const first = '\n\n\n' + sheet('甲') + '\n\n';
    const second = sheet('乙');
    const batches = assertLossless(first + second);
    let position = 0;
    for (const batch of batches) {
      assert.ok(batch.columnContext.includes(position < first.length ? '【甲】' : '【乙】'));
      if (position < first.length) assert.ok(position + batch.text.length <= first.length);
      position += batch.text.length;
    }
  });
  it('rejects a single huge quoted record instead of slicing inside its blank lines', () => {
    for (const delimiter of [',', '\t'] as const) {
      const source = ['課程名稱', '學分', '備註'].join(delimiter) + '\n' +
        ['課程', '3', quote('說明'.repeat(300) + '\n\n' + '附註'.repeat(300))].join(delimiter);
      assert.throws(() => plan(source), /無法安全拆開/u);
    }
  });
  it('rejects malformed quoted records and does not advertise retry boundaries for them', () => {
    for (const row of ['"課程,3,85', '課"程,3,85', '"課程"extra,3,85']) {
      const source = '課程名稱,學分,成績\n' + row;
      assert.equal(readImportDelimitedRecords(source, ','), null);
      const batch = plan(source)[0];
      assert.equal(batch.recordStarts, undefined);
      assert.equal(splitPersonalImportAiTextBatch(batch), null);
    }
  });
  it('refuses invalid retry boundaries and never cuts an opaque source', () => {
    const batch = { text: '原始文字\n保持完整', startLine: 3, columnContext: '' };
    assert.equal(splitPersonalImportAiTextBatch(batch), null);
    for (const recordStarts of [[1, 4], [0, 0], [0, -1], [0, 99], [0, 1.5], [0, NaN], [0]]) {
      assert.equal(splitPersonalImportAiTextBatch({ ...batch, recordStarts }), null);
    }
  });
  it('can reduce a table to individual records without inventing or dropping source characters', () => {
    const source = '課程名稱,學分,成績\r\n' + Array.from({ length: 8 }, (_, i) => `課${i},3,85`).join('\r\n');
    const splitAll = (batch: ReturnType<typeof plan>[number]): ReturnType<typeof plan> => {
      const parts = splitPersonalImportAiTextBatch(batch);
      return parts ? parts.flatMap(splitAll) : [batch];
    };
    const pieces = plan(source).flatMap(splitAll);
    assert.equal(pieces.length, 8);
    assert.equal(pieces.map((piece) => piece.text).join(''), source);
    assert.deepEqual(pieces.map((piece) => piece.startLine), [1, 3, 4, 5, 6, 7, 8, 9]);
    assert.ok(pieces.every((piece) => piece.columnContext === '課程名稱,學分,成績'));
  });
  it('keeps the old bounded prose path, including exact whitespace and no added context', () => {
    const text = ' 資料庫 3 學分 85 分\r\n';
    assert.deepEqual(plan(text), [{ text, startLine: 1, columnContext: '' }]);
  });
  it('preserves table records across 120 deterministic varied fixtures', () => {
    for (let sample = 0; sample < 120; sample++) {
      const delimiter = sample % 2 ? ',' : '\t';
      const newline = sample % 3 ? '\n' : '\r\n';
      const count = 9 + sample % 40;
      const rows = Array.from({ length: count }, (_, i) => [
        quote(`樣本${sample}課${i}${delimiter}"名稱"`), '3', quote(`附註${i}${newline}更多內容`),
      ].join(delimiter));
      const source = ['課程名稱' + delimiter + '學分' + delimiter + '備註', ...rows].join(newline);
      const batches = assertLossless(source);
      for (const row of rows) assert.equal(batches.filter((batch) => batch.text.includes(row)).length, 1);
    }
  });
});
