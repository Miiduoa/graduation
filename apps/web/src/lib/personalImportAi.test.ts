import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePersonalImportAiModelCache,
  getPersonalImportAiAvailability,
  runLocalPersonalImportAi as runPersonalImportAi,
} from './personalImportAiLocal';
import { IMPORT_AI_CACHE_NAME } from './personalImportAiConfig';

class FakeWorker {
  static workers: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: { id: number; prompt: string; image?: File }[] = [];
  terminate = vi.fn();
  constructor(
    public url: URL,
    public options: { type: string },
  ) {
    FakeWorker.workers.push(this);
  }
  postMessage(message: { id: number; prompt: string; image?: File }) {
    this.sent.push(message);
  }
  receive(data: Record<string, unknown>) {
    this.onmessage?.({ data: { id: this.sent[0].id, ...data } } as MessageEvent);
  }
}
const text = '資料庫 星期三 第3至4節';
const options = {
  kind: 'timetable' as const,
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  periodProfile: 'pu' as const,
};
const response = JSON.stringify({
  complete: true,
  rows: [{ title: '資料庫', dayOfWeek: 3, startPeriod: '3', endPeriod: '4', evidence: text }],
});
const start = (signal = new AbortController().signal, input = { text }) =>
  runPersonalImportAi({ input, options, signal, onProgress: vi.fn() });

beforeEach(() => {
  FakeWorker.workers = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { gpu: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('personal import AI worker lifecycle', () => {
  it('checks availability without starting a worker or a download', () => {
    expect(getPersonalImportAiAvailability().available).toBe(true);
    expect(FakeWorker.workers).toHaveLength(0);
    vi.stubGlobal('navigator', {});
    expect(getPersonalImportAiAvailability()).toMatchObject({
      available: false,
      reason: expect.any(String),
    });
  });
  it('passes explicit requests to a module worker, validates output and releases resources', async () => {
    const result = start();
    const worker = FakeWorker.workers[0];
    expect(worker.options.type).toBe('module');
    expect(worker.sent[0].prompt).toContain(`SOURCE_DATA=${JSON.stringify(text)}`);
    worker.receive({ type: 'result', raw: response });
    expect((await result).rows[0]).toMatchObject({ title: '資料庫', schoolId: 'pu' });
    expect(worker.terminate).toHaveBeenCalled();
    expect(worker.onmessage).toBeNull();
  });
  it('delivers the actual image file to visual inference without using OCR text', async () => {
    const image = new File(['png'], 'week.png', { type: 'image/png' });
    const result = runPersonalImportAi({
      input: { image, text: '錯誤的 OCR' },
      options,
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    const worker = FakeWorker.workers[0];
    expect(worker.sent[0].image).toBe(image);
    expect(worker.sent[0].prompt).toContain('這張圖片');
    expect(worker.sent[0].prompt).not.toContain('錯誤的 OCR');
    worker.receive({ type: 'result', raw: response });
    expect((await result).rows[0].source.rawText).toContain('AI 辨讀片段');
  });
  it('kills downloads and computation on cancellation, ignoring a captured late handler', async () => {
    const controller = new AbortController();
    const first = start(controller.signal);
    const worker = FakeWorker.workers[0];
    const late = worker.onmessage;
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalled();
    const second = start();
    late?.({ data: { id: worker.sent[0].id, type: 'result', raw: response } } as MessageEvent);
    const next = FakeWorker.workers[1];
    next.receive({ type: 'result', raw: response });
    expect((await second).rows).toHaveLength(1);
  });
  it('rejects a pre-aborted request before allocating resources', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(start(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.workers).toHaveLength(0);
  });
  it('does not allow simultaneous model allocations or cache deletion during recognition', async () => {
    const first = start();
    await expect(start()).rejects.toThrow('另一份資料');
    await expect(deletePersonalImportAiModelCache()).rejects.toThrow('正在辨識');
    FakeWorker.workers[0].receive({ type: 'result', raw: response });
    await first;
  });
  it('ignores mismatched job IDs and forwards relevant progress only', async () => {
    const progress = vi.fn();
    const result = runPersonalImportAi({
      input: { text },
      options,
      signal: new AbortController().signal,
      onProgress: progress,
    });
    const worker = FakeWorker.workers[0];
    worker.receive({ id: -1, type: 'result', raw: response });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.receive({ type: 'progress', message: '下載中 50%' });
    expect(progress).toHaveBeenCalledWith('下載中 50%');
    worker.receive({ type: 'result', raw: response });
    await result;
  });
  it('keeps the captured school and source while a request is running', async () => {
    const mutable = { ...options, source: { type: 'paste' as const, name: '原始資料' } };
    const result = runPersonalImportAi({
      input: { text },
      options: mutable,
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    mutable.schoolId = 'other';
    mutable.source.name = '另一個帳號';
    FakeWorker.workers[0].receive({ type: 'result', raw: response });
    expect((await result).rows[0]).toMatchObject({ schoolId: 'pu', source: { name: '原始資料' } });
  });
  it.each(['crash', 'message', 'worker-error', 'bad-json'])(
    'rejects %s and allows a clean retry',
    async (type) => {
      const result = start();
      const worker = FakeWorker.workers[0];
      if (type === 'crash') worker.onerror?.();
      else if (type === 'message') worker.onmessageerror?.();
      else if (type === 'worker-error') worker.receive({ type: 'error', message: '記憶體不足' });
      else worker.receive({ type: 'result', raw: '{"complete":false}' });
      await expect(result).rejects.toThrow();
      expect(worker.terminate).toHaveBeenCalled();
      const retry = start();
      FakeWorker.workers[1].receive({ type: 'result', raw: response });
      await expect(retry).resolves.toHaveProperty('rows');
    },
  );
  it('ends a stalled download without holding the lock forever', async () => {
    vi.useFakeTimers();
    const result = start();
    const rejected = expect(result).rejects.toThrow('逾時');
    await vi.advanceTimersByTimeAsync(600_001);
    await rejected;
    expect(FakeWorker.workers[0].terminate).toHaveBeenCalled();
  });
  it('rejects unsupported or oversized images before model allocation', async () => {
    for (const image of [
      new File(['svg'], 'x.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ]) {
      await expect(
        runPersonalImportAi({
          input: { image },
          options,
          signal: new AbortController().signal,
          onProgress: vi.fn(),
        }),
      ).rejects.toThrow();
    }
    expect(FakeWorker.workers).toHaveLength(0);
  });
  it('removes only this feature cache and verifies that deletion completed', async () => {
    const cache = {
      delete: vi.fn().mockResolvedValue(true),
      has: vi.fn().mockResolvedValue(false),
    };
    vi.stubGlobal('caches', cache);
    await deletePersonalImportAiModelCache();
    expect(cache.delete).toHaveBeenCalledExactlyOnceWith(IMPORT_AI_CACHE_NAME);
    cache.has.mockResolvedValue(true);
    await expect(deletePersonalImportAiModelCache()).rejects.toThrow('尚未完全移除');
  });
  it('waits for cache removal to finish before permitting a new model load', async () => {
    let complete!: (value: boolean) => void;
    vi.stubGlobal('caches', {
      delete: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            complete = resolve;
          }),
      ),
      has: vi.fn().mockResolvedValue(false),
    });
    const removal = deletePersonalImportAiModelCache();
    await expect(start()).rejects.toThrow('正在移除模型快取');
    expect(FakeWorker.workers).toHaveLength(0);
    complete(true);
    await removal;
  });
});
