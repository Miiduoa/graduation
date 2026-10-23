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
