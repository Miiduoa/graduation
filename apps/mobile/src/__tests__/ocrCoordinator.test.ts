import { OcrCoordinator } from '../services/imports/ocrCoordinator';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('late success from a cancelled job cannot finish the next image', async () => {
  const inject = jest.fn();
  const ocr = new OcrCoordinator(inject);
  ocr.message(JSON.stringify({ ready: true }));
  const first = ocr.recognize('a', 'image/png').catch((error) => error.kind);
  const second = ocr.recognize('b', 'image/jpeg');
  let secondDone = false;
  void second.then(() => {
    secondDone = true;
  });
  ocr.message(JSON.stringify({ id: 1, ok: true, text: '舊圖' }));
  await Promise.resolve();
  expect(secondDone).toBe(false);
  expect(await first).toBe('cancelled');
  ocr.message(JSON.stringify({ id: 2, ok: true, text: '新圖' }));
  expect(await second).toBe('新圖');
  expect(inject.mock.calls.some(([script]) => script.includes('image/png'))).toBe(true);
});

test('abort cancels the worker and stale errors leave future jobs untouched', async () => {
  const inject = jest.fn();
  const ocr = new OcrCoordinator(inject);
  const abort = new AbortController();
  const first = ocr.recognize('a', 'image/png', abort.signal).catch((error) => error.kind);
  abort.abort();
  expect(await first).toBe('cancelled');
  const second = ocr.recognize('b', 'image/png');
  ocr.message(JSON.stringify({ id: 1, ok: false }));
  ocr.message(JSON.stringify({ ready: true }));
  ocr.message(JSON.stringify({ id: 2, ok: true, text: '可保存文字' }));
  expect(await second).toBe('可保存文字');
  expect(inject).toHaveBeenCalledWith(expect.stringContaining('cancelTimetable(1)'));
});

test('broken image errors keep the Chinese sentence and hide the original English', async () => {
  const ocr = new OcrCoordinator(jest.fn());
  ocr.message(JSON.stringify({ ready: true }));
  const failed = ocr.recognize('a', 'image/png').catch((error) => error.message);
  ocr.message(
    JSON.stringify({
      id: 1,
      ok: false,
      error: '這張圖片打不開，可能檔案壞了或格式不支援，請換一張截圖再試。',
    }),
  );
  expect(await failed).toBe('這張圖片打不開，可能檔案壞了或格式不支援，請換一張截圖再試。');
});

test('host disposal rejects pending recognition and timeout is bounded', async () => {
  const ocr = new OcrCoordinator(jest.fn());
  const first = ocr.recognize('a', 'image/png').catch((error) => error.kind);
  ocr.reset();
  expect(await first).toBe('cancelled');
  const second = ocr.recognize('b', 'image/png').catch((error) => error.message);
  jest.advanceTimersByTime(90_000);
  expect(await second).toContain('逾時');
});

test('uses locally reconstructed cells only for a current opted-in PNG with a safe original OCR source', async () => {
  const ocr = new OcrCoordinator(jest.fn());
  const original = '節次 星期一 星期二 星期三\n1 資料庫';
  const grid = '課程名稱,星期,開始節次,結束節次\n資料庫,星期一,1,1';
  const unsafe = '課程名稱 學生姓名 星期\n資料庫 測試同學 星期一';
  for (const [index, sample] of [
    { mime: 'image/png', readGrid: true, text: original, expected: grid },
    { mime: 'image/jpeg', readGrid: true, text: original, expected: original },
    { mime: 'image/png', readGrid: false, text: original, expected: original },
    { mime: 'image/png', readGrid: true, text: unsafe, expected: unsafe },
  ].entries()) {
    const pending = ocr.recognize('', sample.mime as 'image/png' | 'image/jpeg', undefined, sample.readGrid);
    ocr.message(JSON.stringify({ id: index + 1, ok: true, text: sample.text, grid }));
    await expect(pending).resolves.toBe(sample.expected);
  }
});

test('a cancelled grid candidate cannot replace the next screenshot', async () => {
  const ocr = new OcrCoordinator(jest.fn());
  const stale = ocr.recognize('', 'image/png', undefined, true).catch((error) => error.kind);
  const next = ocr.recognize('', 'image/png', undefined, true);
  ocr.message(JSON.stringify({ id: 1, ok: true, text: '原來的圖', grid: '過期的課表' }));
  ocr.message(JSON.stringify({ id: 2, ok: true, text: '新圖的文字', grid: null }));
  await expect(stale).resolves.toBe('cancelled');
  await expect(next).resolves.toBe('新圖的文字');
});
