import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPersonalImportAi, getPersonalImportAiAvailability } from './personalImportAi';
import {
  getPersonalImportAiAvailability as localAvailability,
  runLocalPersonalImportAi,
} from './personalImportAiLocal';
import { recognizePersonalImportImage } from './personalImportOcr';
import { parsePersonalImportAiResponse } from '@campus/shared/src/imports/aiRecognition';

vi.mock('./personalImportAiLocal', () => ({
  getPersonalImportAiAvailability: vi.fn(),
  runLocalPersonalImportAi: vi.fn(),
  deletePersonalImportAiModelCache: vi.fn(),
}));
vi.mock('./personalImportOcr', () => ({ recognizePersonalImportImage: vi.fn() }));
const options = { kind: 'grades' as const, schoolId: 'pu', academicYear: '115', semester: '1' };
const source = '課程名稱,學分,成績\n資料庫,3,85';
const record = { title: '資料庫', credits: 3, grade: '85', evidence: '資料庫,3,85' };
const raw = JSON.stringify({ complete: true, rows: [record] });
const fetcher = vi.fn();
const run = (text = source, extra: Partial<Parameters<typeof runPersonalImportAi>[0]> = {}) =>
  runPersonalImportAi({
    input: { text },
    options,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...extra,
  });
const success = (text: string, output = raw, columnContext = '') =>
  new Response(JSON.stringify({ output, sourceText: text, columnContext }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
  vi.mocked(localAvailability).mockReturnValue({ available: true, downloadLabel: '約 1.9 GB' });
  vi.mocked(runLocalPersonalImportAi).mockImplementation(async () =>
    parsePersonalImportAiResponse(raw, source, options),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('uses cloud before loading a local model and preserves source validation', async () => {
  fetcher.mockResolvedValue(success(source));
  const result = await run();
  expect(result.rows[0]).toMatchObject({ title: '資料庫', credits: 3, grade: '85' });
  expect(runLocalPersonalImportAi).not.toHaveBeenCalled();
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: 'import-provider', message: expect.stringContaining('雲端') }),
  );
});

it.each([429, 503, 504, 500, 401])(
  'falls back to local for cloud status %s without losing the input',
  async (status) => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ code: status === 503 ? 'disabled' : 'unavailable' }), {
        status,
      }),
    );
    const progress = vi.fn();
    const result = await run(source, { onProgress: progress });
    expect(result.rows).toHaveLength(1);
    expect(runLocalPersonalImportAi).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: source } }),
    );
    expect(progress.mock.calls.flat().join(' ')).toContain('本機');
  },
);

it('times out a hung cloud request and proceeds locally', async () => {
  vi.useFakeTimers();
  fetcher.mockReturnValue(new Promise(() => {}));
  const task = run();
  await vi.advanceTimersByTimeAsync(25_001);
  expect((await task).rows).toHaveLength(1);
  expect(runLocalPersonalImportAi).toHaveBeenCalledOnce();
});

it('masks private data before any network call', async () => {
  fetcher.mockImplementation(async (_url, init) => {
    const payload = JSON.parse(init.body as string);
    expect(init.body).not.toMatch(/王小明|s12345678|A123456789/);
    return success(payload.text);
  });
  await run('姓名：王小明 學號：s12345678\n身分證：A123456789\n資料庫,3,85');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('uses rules on unsupported browsers while leaving cloud available', async () => {
  vi.mocked(localAvailability).mockReturnValue({
    available: false,
    downloadLabel: '',
    reason: '不支援圖形加速',
  });
  fetcher.mockResolvedValue(new Response('{"code":"disabled"}', { status: 503 }));
  expect(getPersonalImportAiAvailability().available).toBe(true);
  const result = await run();
  expect(result.rows[0].title).toBe('資料庫');
  expect(runLocalPersonalImportAi).not.toHaveBeenCalled();
  expect(result.issues).toContainEqual(
    expect.objectContaining({ message: expect.stringContaining('規則解析') }),
  );
});

it('retains the completed first batch when the next JSON/local generation fails, then retries only that batch', async () => {
  const records = Array.from({ length: 9 }, (_, i) => ({
    title: `課程${i}`,
    credits: 3,
    grade: '85',
    evidence: `課程${i},3,85`,
  }));
  const text = '課程名稱,學分,成績\n' + records.map((r) => r.evidence).join('\n');
  fetcher.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body as string);
    return success(
      body.text,
      body.text.includes('課程0')
        ? JSON.stringify({ complete: true, rows: records.slice(0, 8) })
        : '{"rows":[',
      body.columnContext,
    );
  });
  vi.mocked(runLocalPersonalImportAi).mockRejectedValue(new Error('這段記憶體不足'));
  const partial = vi.fn();
  const first = await run(text, { onPartial: partial });
  expect(first.rows).toHaveLength(9);
  expect(partial.mock.calls[0][0].rows).toHaveLength(8);
  expect(first.retry?.batches).toHaveLength(1);
  expect(first.retry?.completed.rows).toHaveLength(8);
  const stableIds = first.rows.slice(0, 8).map((r) => r.id);
  fetcher.mockClear().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body as string);
    expect(body.text).not.toContain('課程0');
    return success(
      body.text,
      JSON.stringify({ complete: true, rows: [records[8]] }),
      body.columnContext,
    );
  });
  const retried = await run(text, { retry: first.retry });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(retried.retry).toBeUndefined();
  expect(retried.rows).toHaveLength(9);
  expect(retried.rows.slice(0, 8).map((r) => r.id)).toEqual(stableIds);
  expect(retried.rows[8].source.line).toBe(10);
});

it('uses local OCR before cloud and never sends the original image', async () => {
  vi.mocked(recognizePersonalImportImage).mockResolvedValue(source);
  fetcher.mockResolvedValue(success(source));
  await run('', { input: { image: new File(['pixels'], '成績.png', { type: 'image/png' }) } });
  expect(recognizePersonalImportImage).toHaveBeenCalledOnce();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ text: source });
  expect(fetcher.mock.calls[0][1].body).not.toContain('pixels');
});

it('cancellation fences a late cloud response and starts no local work', async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const onPartial = vi.fn();
  const task = run(source, { signal: controller.signal, onPartial });
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  finish(success(source));
  await Promise.resolve();
  expect(onPartial).not.toHaveBeenCalled();
  expect(runLocalPersonalImportAi).not.toHaveBeenCalled();
});

it('falls back to the local visual model when image OCR cannot finish', async () => {
  const image = new File(['pixels'], '成績.png', { type: 'image/png' });
  vi.mocked(recognizePersonalImportImage).mockRejectedValue(new Error('文字辨識逾時'));
  const result = await run('', { input: { image } });
  expect(result.rows).toHaveLength(1);
  expect(runLocalPersonalImportAi).toHaveBeenCalledWith(
    expect.objectContaining({ input: { image } }),
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.issues).toContainEqual(
    expect.objectContaining({ message: expect.stringContaining('本機視覺模型') }),
  );
});
