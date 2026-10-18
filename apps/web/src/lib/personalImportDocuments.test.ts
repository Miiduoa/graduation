import { afterEach, expect, it, vi } from 'vitest';
import {
  parsePersonalImportDocument,
  validatePersonalImportDocument,
  normalizePersonalImportPdfText,
  type PersonalImportDocument,
} from '@campus/shared';
import { readPersonalImportDocumentFile } from './personalImportDocuments';
const options = { kind: 'grades' as const, schoolId: 'pu', academicYear: '115', semester: '1' };
const documentFixture = (): PersonalImportDocument => ({
  format: 'xlsx',
  name: 'grades.xlsx',
  warnings: [],
  sections: [
    {
      id: 'sheet-1',
      label: '本學期',
      needsOcr: false,
      warnings: ['公式未執行'],
      rows: [
        { line: 1, cells: ['成績報表'] },
        { line: 3, cells: ['課程名稱', '課程代碼', '學分', '成績'] },
        { line: 4, cells: ['英文', '00042', '3', 'A'] },
      ],
    },
  ],
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});
it('selected original header and worksheet are carried through normal import validation', () => {
  const parsed = parsePersonalImportDocument(documentFixture(), 'sheet-1', 3, options);
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]).toMatchObject({
    title: '英文',
    courseCode: '00042',
    credits: 3,
    grade: 'A',
    source: { type: 'file', name: 'grades.xlsx · 本學期', line: 4 },
  });
  expect(parsed.issues.some((issue) => issue.message.includes('公式未執行'))).toBe(true);
  expect(parsed.issues.some((issue) => issue.message.includes('略過'))).toBe(true);
});
it('a wrong header or unreadable page cannot silently turn into natural-language records', () => {
  expect(() => parsePersonalImportDocument(documentFixture(), 'sheet-1', 1, options)).toThrow(
    '欄位名稱',
  );
  const doc = documentFixture();
  doc.sections[0].needsOcr = true;
  doc.sections[0].rows = [];
  expect(() => parsePersonalImportDocument(doc, 'sheet-1', 1, options)).toThrow('沒有可讀取的文字');
});
it('multiline cells retain original worksheet provenance and schema mismatches remain errors', () => {
  const doc = documentFixture();
  doc.sections[0].rows[2].cells[0] = '英文\n會話';
  doc.sections[0].rows.push({ line: 8, cells: ['歷史', '00123', '2'] });
  const parsed = parsePersonalImportDocument(doc, 'sheet-1', 3, options);
  expect(parsed.rows.map((row) => row.source.line)).toEqual([4, 8]);
  expect(
    parsed.issues.some((issue) => issue.code === 'column-count' && issue.severity === 'error'),
  ).toBe(true);
});
it('boundary rejects fake successful OCR and excessive cells before they reach a draft', () => {
  const doc = documentFixture();
  doc.sections[0].needsOcr = true;
  expect(() => validatePersonalImportDocument(doc)).toThrow();
  doc.sections[0].needsOcr = false;
  doc.sections[0].rows[0].cells = Array(65).fill('a');
  expect(() => validatePersonalImportDocument(doc)).toThrow();
});
it('PDF coordinates preserve reading order and explicit gaps without inventing empty columns', () => {
  expect(
    normalizePersonalImportPdfText([
      { str: 'A', x: 200, y: 100, width: 10, height: 12 },
      { str: 'English', x: 20, y: 100, width: 50, height: 12 },
      { str: '3', x: 100, y: 100, width: 8, height: 12 },
    ]),
  ).toEqual([{ line: 1, cells: ['English', '3', 'A'] }]);
});
it('abort disposes the actual iframe and ignores late cross-origin results', async () => {
  const abort = new AbortController();
  const pending = readPersonalImportDocumentFile(
    new File(['xlsx'], 'grades.xlsx'),
    abort.signal,
  ).catch((error) => error.code);
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://untrusted.example',
      data: { channel: 'campus-document', ok: true, document: documentFixture() },
    }),
  );
  abort.abort();
  expect(await pending).toBe('cancelled');
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
});
it('full-page OCR reaches only the owned reader and wrong sources or request IDs cannot complete it', async () => {
  const file = new File(['%PDF-'], 'grades.pdf');
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
  });
  const pending = readPersonalImportDocumentFile(file, undefined, { pdfMode: 'ocr' });
  const frame = document.querySelector('iframe')!;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const dispatch = (data: unknown, source: Window | null = frame.contentWindow) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source,
        data,
      }),
    );
  dispatch({ channel: 'campus-document', ready: true }, window);
  expect(send).not.toHaveBeenCalled();
  dispatch({ channel: 'campus-document', ready: true });
  await Promise.resolve();
  expect(send).toHaveBeenCalledOnce();
  const input = send.mock.calls[0][0];
  expect(input).toMatchObject({ name: 'grades.pdf', pdfMode: 'ocr' });
  const result = { ...documentFixture(), name: 'grades.pdf', format: 'pdf' };
  dispatch({ channel: 'campus-document', id: input.id + 1, ok: true, document: result });
  expect(document.querySelector('iframe')).toBe(frame);
  dispatch({ channel: 'campus-document', id: input.id, ok: true, document: result }, window);
  expect(document.querySelector('iframe')).toBe(frame);
  dispatch({ channel: 'campus-document', id: input.id, ok: true, document: result });
  await expect(pending).resolves.toEqual(result);
  expect(document.querySelector('iframe')).toBeNull();
});
it('timeout disposes a reader that never starts and pre-aborted/oversize files do not mount it', async () => {
  vi.useFakeTimers();
  const pending = readPersonalImportDocumentFile(new File(['xlsx'], 'grades.xlsx')).catch(
    (error) => error.code,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toBe('timeout');
  expect(document.querySelector('iframe')).toBeNull();
  const abort = new AbortController();
  abort.abort();
  await expect(
    readPersonalImportDocumentFile(new File(['xlsx'], 'grades.xlsx'), abort.signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
  await expect(
    readPersonalImportDocumentFile(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.pdf')),
  ).rejects.toMatchObject({ code: 'limit' });
  expect(document.querySelector('iframe')).toBeNull();
});
