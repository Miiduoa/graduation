import * as XLSX from 'xlsx';
import { Unzip, UnzipInflate } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import embeddedAssets from 'document-pdf-assets';
import {
  PERSONAL_IMPORT_DOCUMENT_LIMITS as LIMIT,
  PersonalImportDocumentError as DocumentError,
  validatePersonalImportDocumentFile,
  validatePersonalImportDocument,
  normalizePersonalImportPdfText,
  type PersonalImportDocument,
  type PersonalImportDocumentSection,
} from '../../packages/shared/src/imports/documents';

// Run the parser inside a disposable iframe/WebView, including PDF's worker handler.
// This avoids external worker/CDN requests and supports bundled file:// assets on App.
(globalThis as any).pdfjsWorker = { WorkerMessageHandler };
const fail = (message: string, code = 'unreadable'): never => {
  throw new DocumentError(message, code);
};
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) fail('已取消讀取。', 'cancelled');
};
const limit = () => fail('檔案內容太多，請縮小工作表或將 PDF 拆頁後再匯入。', 'limit');
const corrupt = () => fail('檔案已損毀或格式不符，請從原始系統重新匯出 PDF／XLSX。', 'unreadable');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});

/** Inspect the central directory, then stream every entry to verify actual expansion and CRC. */
export function validateWorkbookArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  if (bytes.length < 22 || u32(0) !== 0x04034b50) corrupt();
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) corrupt();
  const count = u16(end + 10);
  if (!count || count > LIMIT.zipEntries) limit();
  const directory = u32(end + 16);
  if (directory + u32(end + 12) !== end) corrupt();
  const entries = new Map<string, { size: number; crc: number; seen: boolean }>();
  let at = directory;
  let declared = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) corrupt();
    const flags = u16(at + 8),
      method = u16(at + 10),
      compressed = u32(at + 20),
      size = u32(at + 24);
    const nameLength = u16(at + 28),
      extra = u16(at + 30),
      comment = u16(at + 32),
      local = u32(at + 42);
    if (flags & 1) fail('檔案有密碼保護，請先另存為沒有密碼的檔案。', 'password');
    if (
      ![0, 8].includes(method) ||
      at + 46 + nameLength + extra + comment > end ||
      local + 30 > directory ||
      u32(local) !== 0x04034b50
    )
      corrupt();
    if (local + 30 + u16(local + 26) + u16(local + 28) + compressed > directory) corrupt();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    if (
      !name ||
      entries.has(name) ||
      name.includes('..') ||
      name.startsWith('/') ||
      name.includes('\\')
    )
      corrupt();
    if (/vbaProject|externalLinks|\.bin$/i.test(name))
      fail('請將巨集或外部連結另存為一般 XLSX 後再匯入。', 'format');
    declared += size;
    if (declared > LIMIT.expandedBytes || size > LIMIT.expandedBytes) limit();
    entries.set(name, { size, crc: u32(at + 16), seen: false });
    at += 46 + nameLength + extra + comment;
  }
  if (at !== end || !entries.has('[Content_Types].xml') || !entries.has('xl/workbook.xml'))
    corrupt();
  let expanded = 0,
    completed = 0;
  const unzip = new Unzip((file) => {
    const expected = entries.get(file.name);
    if (!expected || expected.seen) corrupt();
    expected.seen = true;
    let size = 0,
      crc = -1;
    file.ondata = (error, data, final) => {
      if (error) corrupt();
      size += data.length;
      expanded += data.length;
      if (size > expected.size || expanded > LIMIT.expandedBytes) limit();
      for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      if (final) {
        if (size !== expected.size || (crc ^ -1) >>> 0 !== expected.crc) corrupt();
        completed++;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks bound each inflater allocation even if ZIP sizes are dishonest.
  for (let offset = 0; offset < bytes.length; offset += 1024)
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (completed !== count) corrupt();
}

export function readWorkbook(bytes: Uint8Array, name: string): PersonalImportDocument {
  validateWorkbookArchive(bytes);
  const workbook = XLSX.read(bytes, {
    type: 'array',
    cellText: true,
    cellNF: true,
    cellFormula: true,
    cellHTML: false,
    cellDates: false,
    nodim: true,
    WTF: true,
  });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > LIMIT.sheets) limit();
  let totalCells = 0,
    characters = 0;
  const sections = workbook.SheetNames.map((label, sheetIndex): PersonalImportDocumentSection => {
    const sheet = workbook.Sheets[label];
    const warnings: string[] = [];
    if (workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden)
      warnings.push('這是原檔隱藏的工作表，請確認是否要匯入。');
    if (sheet['!merges']?.length) warnings.push('表格有合併儲存格；未自動填滿空格，請核對每一列。');
    let formulas = false,
      missingFormulaValues = false;
    const rows = [];
    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.r >= LIMIT.rowsPerSection || range.e.c >= LIMIT.columns) limit();
      totalCells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (totalCells > LIMIT.cells) limit();
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cells: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })];
          if (cell?.f) {
            formulas = true;
            if (cell.v == null) missingFormulaValues = true;
          }
          const value =
            !cell || cell.v == null ? '' : String(cell.w ?? XLSX.utils.format_cell(cell));
          characters += value.length;
          if (characters > LIMIT.textCharacters) limit();
          cells.push(value);
        }
        if (cells.some((cell) => cell.trim())) rows.push({ line: r + 1, cells });
      }
    }
    if (formulas) warnings.push('公式未執行；只讀取原檔儲存的顯示結果，請確認它是最新的。');
    if (missingFormulaValues)
      warnings.push('部分公式沒有儲存結果，該儲存格保留空白，請先在 Excel 重新計算並儲存。');
    return { id: `sheet-${sheetIndex + 1}`, label, rows, needsOcr: false, warnings };
  });
  return validatePersonalImportDocument({ format: 'xlsx', name, sections, warnings: [] });
}

class LocalPdfAssets {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const content = (embeddedAssets as Record<string, string>)[`${kind}/${filename}`];
    if (!content) fail('PDF 使用的字型或影像格式目前無法讀取，請改用截圖。', 'unsupported');
    return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  }
}

export async function readDocumentBytes(
  bytes: Uint8Array,
  name: string,
  options: { signal?: AbortSignal; ocrAssetBase?: string } = {},
): Promise<PersonalImportDocument> {
  const format = validatePersonalImportDocumentFile(name, bytes.length);
  check(options.signal);
  if (format === 'xlsx') return readWorkbook(bytes, name);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') corrupt();
  const loading = getDocument({
    data: bytes,
    BinaryDataFactory: LocalPdfAssets,
    useWorkerFetch: false,
    cMapUrl: '/',
    standardFontDataUrl: '/',
    wasmUrl: '/',
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: 12_000_000,
    canvasMaxAreaInBytes: 48_000_000,
    useSystemFonts: false,
    disableAutoFetch: true,
  } as any);
  let ocr: any = null;
  const abort = () => {
    void loading.destroy();
    if (ocr) void ocr.terminate();
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > LIMIT.pages) limit();
    const sections: PersonalImportDocumentSection[] = [];
    let characterCount = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      check(options.signal);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      if (content.items.length > LIMIT.cells) limit();
      const items = content.items
        .filter((item: any) => typeof item.str === 'string')
        .map((item: any) => ({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        }));
      let rows = normalizePersonalImportPdfText(items);
      const warnings = [
        'PDF 的空白欄位與跨欄排版可能影響對齊，請核對原檔；週格課表不會自動猜測節次。',
      ];
      if (!rows.length) {
        if (typeof document === 'undefined' || !(globalThis as any).Tesseract) {
          warnings.push('這一頁是掃描影像，需要以截圖辨識後才能匯入。');
        } else {
          const base = options.ocrAssetBase ?? '../ocr/';
          if (!ocr)
            ocr = await (globalThis as any).Tesseract.createWorker('chi_tra+eng', 1, {
              workerPath: `${base}worker.min.js`,
              corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
              langPath: `${base}lang`,
              workerBlobURL: false,
            });
          check(options.signal);
          await ocr.setParameters({ preserve_interword_spaces: '1' });
          const raw = page.getViewport({ scale: 2 });
          const scale = Math.min(2, 2 * Math.sqrt(8_000_000 / (raw.width * raw.height)));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
              .promise;
            check(options.signal);
            const result = await ocr.recognize(canvas);
            rows = String(result.data.text || '')
              .split(/\r?\n/)
              .map((text, line) => ({ line: line + 1, cells: text.trim().split(/\t| {2,}/) }))
              .filter((row) => row.cells.some(Boolean));
            warnings.push(
              '這一頁使用本機文字辨識，請逐列核對文字、數字與欄位；未自動判讀週格課表。',
            );
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
      characterCount += rows.reduce((sum, row) => sum + row.cells.join('').length, 0);
      if (characterCount > LIMIT.textCharacters || rows.length > LIMIT.rowsPerSection) limit();
      sections.push({
        id: `page-${number}`,
        label: `第 ${number} 頁`,
        rows,
        needsOcr: !rows.length,
        warnings,
      });
      page.cleanup();
    }
    return validatePersonalImportDocument({ format: 'pdf', name, sections, warnings: [] });
  } catch (error) {
    check(options.signal);
    if (error instanceof DocumentError) throw error;
    if ((error as Error)?.name === 'PasswordException')
      fail('PDF 有密碼保護，請先另存為沒有密碼的檔案。', 'password');
    throw new DocumentError('PDF 讀取失敗，請重新匯出；掃描檔也可改以單頁截圖辨識。');
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (ocr) await ocr.terminate();
    await loading.destroy();
  }
}
