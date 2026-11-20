import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_OCR_CORE,
  PERSONAL_IMPORT_OCR_LANG,
  PERSONAL_IMPORT_OCR_LANGUAGES,
  PERSONAL_IMPORT_OCR_SCRIPT,
  PERSONAL_IMPORT_OCR_WORKER,
} from '@campus/shared';
import { recognizePersonalImportImage } from './personalImportOcr';

const ocrDir = path.resolve(__dirname, '../../public/ocr');
const source = readFileSync(path.resolve(__dirname, './personalImportOcr.ts'), 'utf8');
const csp = readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('serves the recognizer and language files from this site', () => {
  expect(source).not.toMatch(/jsdelivr|tessdata\.projectnaptha|cdn\./);
  expect(source).toContain('PERSONAL_IMPORT_OCR_SCRIPT');
  expect(source).toContain('PERSONAL_IMPORT_OCR_WORKER');
  expect(source).toContain('PERSONAL_IMPORT_OCR_CORE');
  expect(source).toContain('PERSONAL_IMPORT_OCR_LANG');
  expect(PERSONAL_IMPORT_OCR_SCRIPT).toBe('/ocr/tesseract.min.js');
  expect(PERSONAL_IMPORT_OCR_WORKER).toBe('/ocr/worker.min.js');
  expect(PERSONAL_IMPORT_OCR_CORE).toBe('/ocr/tesseract-core-simd-lstm.wasm.js');
  expect(PERSONAL_IMPORT_OCR_LANG).toBe('/ocr/lang');
  expect(PERSONAL_IMPORT_OCR_LANGUAGES).toBe('chi_tra+eng');
  expect(existsSync(path.join(ocrDir, 'tesseract.min.js'))).toBe(true);
  expect(existsSync(path.join(ocrDir, 'worker.min.js'))).toBe(true);
  expect(existsSync(path.join(ocrDir, 'tesseract-core-simd-lstm.wasm.js'))).toBe(true);
  expect(existsSync(path.join(ocrDir, 'lang/chi_tra.traineddata.gz'))).toBe(true);
  expect(existsSync(path.join(ocrDir, 'lang/eng.traineddata.gz'))).toBe(true);
});

it('does not add an external OCR host to the content security policy', () => {
  expect(csp).not.toMatch(/jsdelivr/);
  expect(csp).toMatch(/script-src 'self'/);
  expect(csp).toMatch(/connect-src 'self'/);
});

it('maps an undecodable image to a Chinese notice', async () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockRejectedValue(new Error('The source image could not be decoded.')),
  );
  const file = new File(['xxxx'], 'broken.png', { type: 'image/png' });
  await expect(
    recognizePersonalImportImage(file, new AbortController().signal, () => {}),
  ).rejects.toThrow(PERSONAL_IMPORT_IMAGE_UNREADABLE);
});

it('keeps the original OCR when grid extraction would discard an unsafe personal-data heading', async () => {
  const raw = '姓名  未知欄位\n測試學生  其他值\n節次  星期一  星期二  星期三';
  const bitmap = { width: 640, height: 480, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const worker = {
    setParameters: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue({ data: { text: raw, tsv: 'pixel coordinates' } }),
  };
  vi.stubGlobal('Tesseract', { createWorker: vi.fn().mockResolvedValue(worker) });
  vi.spyOn(document.head, 'append').mockImplementation((script) => {
    (script as HTMLScriptElement).dispatchEvent(new Event('load'));
  });
  const file = new File(['pixels'], 'weekly.png', { type: 'image/png' });
  await expect(
    recognizePersonalImportImage(file, new AbortController().signal, () => {}, 'timetable'),
  ).resolves.toBe(raw);
  expect(worker.recognize).toHaveBeenCalledWith(file, {}, { text: true, tsv: true });
  expect(getContext).not.toHaveBeenCalled();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
