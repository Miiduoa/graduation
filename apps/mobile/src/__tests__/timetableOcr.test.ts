import { TIMETABLE_OCR_HTML, TimetableOcrError } from '../services/timetableOcr';

test('ocr page loads tesseract from the public cdn', () => {
  expect(TIMETABLE_OCR_HTML).toContain('tesseract.js@5');
  expect(TIMETABLE_OCR_HTML).toContain('chi_tra+eng');
  expect(TIMETABLE_OCR_HTML).toContain('recognizeTimetable');
});

test('ocr error keeps a kind so the screen can stay honest', () => {
  const error = new TimetableOcrError('截圖辨識需要連上網路下載字庫，這次沒連上', 'network');
  expect(error.kind).toBe('network');
});
