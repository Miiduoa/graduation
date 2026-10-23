import { existsSync } from 'node:fs';
import path from 'node:path';
import { PERSONAL_IMPORT_IMAGE_UNREADABLE } from '@campus/shared';
import { TIMETABLE_OCR_HTML, TimetableOcrError } from '../services/timetableOcr';

test('ocr page loads tesseract from bundled files', () => {
  expect(TIMETABLE_OCR_HTML).not.toMatch(/jsdelivr|tessdata\.projectnaptha|cdn\./);
  expect(TIMETABLE_OCR_HTML).toContain('tesseract.min.js');
  expect(TIMETABLE_OCR_HTML).toContain('worker.min.js');
  expect(TIMETABLE_OCR_HTML).toContain("langPath: 'lang'");
  expect(TIMETABLE_OCR_HTML).toContain('chi_tra+eng');
  expect(TIMETABLE_OCR_HTML).toContain('recognizeTimetable');
  expect(TIMETABLE_OCR_HTML).toContain(PERSONAL_IMPORT_IMAGE_UNREADABLE);
  expect(
    existsSync(path.resolve(__dirname, '../../assets/ocr/lang/chi_tra.traineddata.gz')),
  ).toBe(true);
  expect(existsSync(path.resolve(__dirname, '../../assets/ocr/lang/eng.traineddata.gz'))).toBe(
    true,
  );
  expect(existsSync(path.resolve(__dirname, '../../assets/ocr/tesseract.min.bin'))).toBe(true);
  expect(
    existsSync(path.resolve(__dirname, '../../assets/ocr/tesseract-core-simd-lstm.wasm.js.bin')),
  ).toBe(true);
});

test('ocr error keeps a kind so the screen can stay honest', () => {
  const error = new TimetableOcrError('辨識程式未能載入，請改貼文字。', 'unavailable');
  expect(error.kind).toBe('unavailable');
});
