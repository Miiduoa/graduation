import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { bundleDocumentReader } from './build.mjs';
import { makePdf, textPage } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const built = await bundleDocumentReader('reader.ts', 'node');
const module = new Module(import.meta.filename, null);
module.filename = import.meta.filename;
module.paths = require.resolve.paths('xlsx');
module._compile(Buffer.from(built.outputFiles[0].contents).toString(), import.meta.filename);
const { readDocumentBytes, validateWorkbookArchive } = module.exports;
const fixture = async (name) =>
  new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
test('real XLSX preserves all sheets, row provenance, leading zero displays and cached formulas', async () => {
  const doc = await readDocumentBytes(await fixture('multi-sheet.xlsx'), '成績.xlsx');
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].label, '本學期');
  assert.deepEqual(doc.sections[0].rows.find((row) => row.line === 4).cells, [
    '英文',
    '00042',
    '3',
    'A',
  ]);
  assert.deepEqual(doc.sections[0].rows.find((row) => row.line === 5).cells, [
    '微積分',
    '00007',
    '2',
    '90',
  ]);
  assert.equal(doc.sections[0].rows.find((row) => row.line === 6).cells[3], '');
  assert(doc.sections[0].warnings.some((text) => text.includes('公式未執行')));
  assert(doc.sections[0].warnings.some((text) => text.includes('沒有儲存結果')));
});
test('real PDF extracts separate pages and positioned table cells using bundled font assets', async () => {
  const doc = await readDocumentBytes(await fixture('text-two-pages.pdf'), 'grades.pdf');
  assert.equal(doc.sections.length, 2);
  assert.deepEqual(doc.sections[0].rows, [
    { line: 1, cells: ['title', 'credits', 'grade'] },
    { line: 2, cells: ['English', '3', 'A'] },
  ]);
  assert.equal(doc.sections[1].rows[1].cells[0], 'History');
  assert.equal(doc.sections[0].needsOcr, false);
});
test('image-only PDF does not invent successful text when no local OCR host is available', async () => {
  const doc = await readDocumentBytes(await fixture('scanned-table.pdf'), 'scan.pdf');
  assert.deepEqual(doc.sections[0].rows, []);
  assert.equal(doc.sections[0].needsOcr, true);
});
test('PDF page limit and cancelled input fail before returning partial records', async () => {
  await assert.rejects(
    readDocumentBytes(new Uint8Array(makePdf(Array(21).fill(textPage))), 'long.pdf'),
    (error) => error.code === 'limit',
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readDocumentBytes(await fixture('multi-sheet.xlsx'), 'grades.xlsx', {
      signal: controller.signal,
    }),
    (error) => error.code === 'cancelled',
  );
});
test('wrong extensions, corrupt PDF/ZIP, renamed CSV and truncated archives fail', async () => {
  for (const [bytes, name] of [
    [new TextEncoder().encode('a,b,c'), 'a.xlsx'],
    [new TextEncoder().encode('%PDF-1.7\nbroken'), 'a.pdf'],
    [new Uint8Array(4), 'a.xls'],
    [(await fixture('multi-sheet.xlsx')).slice(0, -12), 'a.xlsx'],
  ])
    await assert.rejects(readDocumentBytes(bytes, name));
});
test('ZIP size declarations cannot hide actual expansion or corrupted contents', async () => {
  const bytes = await fixture('multi-sheet.xlsx');
  const altered = bytes.slice();
  const view = new DataView(altered.buffer);
  let central = -1;
  for (let at = 0; at < altered.length - 46; at++)
    if (view.getUint32(at, true) === 0x02014b50) {
      central = at;
      break;
    }
  assert(central >= 0);
  view.setUint32(central + 24, 0, true);
  assert.throws(
    () => validateWorkbookArchive(altered),
    (error) => ['limit', 'unreadable'].includes(error.code),
  );
  const badCrc = bytes.slice();
  new DataView(badCrc.buffer).setUint32(central + 16, 123, true);
  assert.throws(
    () => validateWorkbookArchive(badCrc),
    (error) => error.code === 'unreadable',
  );
});
