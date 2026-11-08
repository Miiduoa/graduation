// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStudyTutorAvailability,
  runStudyTutor,
  STUDY_TUTOR_GENERATION_TIMEOUT_MS,
  STUDY_TUTOR_TIMEOUT_MS,
} from './studyTutorRuntime';
import type { StudyPassage, StudyTutorHistory, TutorExplanation } from './studyTutor';

const availability = vi.hoisted(() => vi.fn());
vi.mock('./personalImportAiLocal', () => ({ getPersonalImportAiAvailability: availability }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((data: { id: number; prompt: string }) => {
    if (FakeWorker.failPost) throw new Error('private contents from postMessage');
    this.request = data;
  });
  request?: { id: number; prompt: string };
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }
  emit(data: Record<string, unknown>) {
    this.onmessage?.({ data: { id: this.request?.id, ...data } } as MessageEvent);
  }
}

const passage = (): StudyPassage => ({
  id: 'page-1:part-1', label: '第 1 頁 · 第 1 段',
  text: '主鍵用來唯一識別一筆紀錄。外鍵連接資料表。',
});
const lesson = (): TutorExplanation => ({
  title: '主鍵', explanation: '主鍵用來區分每一筆紀錄。',
  sourceQuote: '主鍵用來唯一識別一筆紀錄。',
  question: '主鍵用來識別什麼？', answer: '每一筆紀錄。',
});
const history = (): StudyTutorHistory => ({
  passageId: passage().id, sourceText: passage().text, mode: 'understand',
  turns: [{ question: '上一輪的問題', response: lesson() }],
});
const lastWorker = () => FakeWorker.instances.at(-1)!;

beforeEach(() => {
  availability.mockReturnValue({ available: true, downloadLabel: '約 1.9 GB，建議使用 Wi-Fi' });
  FakeWorker.instances = [];
  FakeWorker.failPost = false;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('explicit local study generation', () => {
  it('checking availability never starts a worker and unsupported devices do not download', async () => {
    expect(getStudyTutorAvailability().available).toBe(true);
    expect(FakeWorker.instances).toHaveLength(0);
    availability.mockReturnValue({ available: false, reason: 'import-only wording', downloadLabel: '約 1.9 GB' });
    expect(getStudyTutorAvailability().reason).toContain('仍可閱讀原文');
    await expect(runStudyTutor({ passage: passage(), mode: 'understand', signal: new AbortController().signal }))
      .rejects.toThrow('仍可閱讀原文');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('posts only the chosen passage to the existing module worker and cleans up on completion', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const progress = vi.fn();
    const controller = new AbortController();
    const pending = runStudyTutor({ passage: passage(), mode: 'understand', signal: controller.signal, onProgress: progress });
    const worker = lastWorker();
    expect(worker.url.pathname).toContain('personalImportAi.worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage.mock.calls[0][0]).toEqual({
      type: 'recognize', id: expect.any(Number), prompt: expect.stringContaining(passage().text),
    });
    worker.emit({ type: 'progress', message: '正在下載辨識模型（已接收 240 MB）' });
    worker.emit({ type: 'progress', phase: 'generating', message: 'AI 正在整理欄位、日期與內容' });
    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(progress.mock.calls.map(([message]) => message)).toContain('正在下載講解模型（已接收 240 MB）');
    expect(progress.mock.calls.map(([message]) => message).join('\n')).not.toContain('欄位');
    expect(fetcher).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('measures local worker preparation and generation without claiming a cold or warm start', async () => {
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'progress', phase: 'generating' });
    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(onTiming).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'success', preparationMs: expect.any(Number),
      generationMs: expect.any(Number), totalMs: expect.any(Number),
    }));
    const measured = onTiming.mock.calls[0][0];
    expect(measured.preparationMs).toBeGreaterThanOrEqual(0);
    expect(measured.generationMs).toBeGreaterThanOrEqual(0);
    expect(measured.totalMs).toBeGreaterThanOrEqual(measured.preparationMs);
    expect(measured.totalMs).toBeGreaterThanOrEqual(measured.generationMs);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('records startup failure timing before the model can generate and allows a later retry', async () => {
    const onTiming = vi.fn();
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('private worker path and lesson contents'); }
    });
    await expect(runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    })).rejects.toThrow('無法啟動裝置端 AI');
    expect(onTiming).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith({
      preparationMs: expect.any(Number), generationMs: null,
      totalMs: expect.any(Number), outcome: 'failed',
    });
    const result = onTiming.mock.calls[0][0];
    expect(result.preparationMs).toBeGreaterThanOrEqual(0);
    expect(result.preparationMs).toBe(result.totalMs);
    expect(FakeWorker.instances).toHaveLength(0);

    vi.stubGlobal('Worker', FakeWorker);
    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('keeps a worker startup error authoritative even if the timing callback throws', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('private source location'); }
    });
    await expect(runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
      onTiming: () => { throw new Error('timing display failure'); },
    })).rejects.toThrow('無法啟動裝置端 AI');
  });

  it('includes failed and stopped local AI attempts without inventing a generation phase', async () => {
    const failedTiming = vi.fn();
    const failed = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
      onTiming: failedTiming,
    });
    lastWorker().emit({ type: 'error', code: 'memory' });
    await expect(failed).rejects.toThrow('記憶體不足');
    expect(failedTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', generationMs: null,
    }));

    const controller = new AbortController();
    const stoppedTiming = vi.fn();
    const stopped = runStudyTutor({
      passage: passage(), mode: 'exam', signal: controller.signal, onTiming: stoppedTiming,
    });
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    expect(stoppedTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'cancelled', generationMs: null,
    }));
    expect(FakeWorker.instances).toHaveLength(2);
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects invalid source input before creating a worker', async () => {
    await expect(runStudyTutor({ passage: { ...passage(), text: '字'.repeat(1_601) }, mode: 'understand', signal: new AbortController().signal }))
      .rejects.toThrow('過長');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('dispatches a snapshot of same-passage history with the full new question', async () => {
    const previous = history();
    const expected = JSON.parse(JSON.stringify(previous.turns)) as StudyTutorHistory['turns'];
    const question = '剛才你提到的「區分」是什麼意思？\n請用這段原文回答。';
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', question, history: previous, signal: new AbortController().signal,
    });
    previous.turns[0].question = '送出之後才改的問題';
    previous.turns[0].response.explanation = '送出之後才改的回覆';
    previous.sourceText = '另一份教材';
    const prompt = lastWorker().request!.prompt;
    const historyLine = prompt.split('\n').find((line) => line.startsWith('HISTORY_DATA='))!;
    const questionLine = prompt.split('\n').find((line) => line.startsWith('STUDENT_QUESTION='))!;
    expect(JSON.parse(historyLine.slice('HISTORY_DATA='.length))).toEqual(expected);
    expect(JSON.parse(questionLine.slice('STUDENT_QUESTION='.length))).toBe(question);
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it.each([
    () => ({ ...history(), passageId: 'page-2:part-1' }),
    () => ({ ...history(), mode: 'exam' as const }),
    () => ({ ...history(), turns: [{ question: '', response: { ...lesson(), sourceQuote: '另一頁原文' } }] }),
    () => ({ ...history(), turns: Array.from({ length: 3 }, () => ({ question: '', response: lesson() })) }),
  ])('rejects invalid follow-up context before allocating or downloading a worker (%#)', async (invalidHistory) => {
    await expect(runStudyTutor({
      passage: passage(), mode: 'understand', history: invalidHistory(), signal: new AbortController().signal,
    })).rejects.toThrow();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects an ungrounded lesson and validates against the request snapshot', async () => {
    const source = passage();
    const pending = runStudyTutor({ passage: source, mode: 'understand', signal: new AbortController().signal });
    source.text = '改選另一門課的教材。';
    lastWorker().emit({ type: 'result', raw: JSON.stringify({ ...lesson(), sourceQuote: source.text }) });
    await expect(pending).rejects.toThrow('不在這段原文');
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'null data', data: null },
    { label: 'array data', data: [] },
    { label: 'missing id', data: { type: 'result', raw: JSON.stringify(lesson()) } },
    { label: 'non-numeric id', data: { id: 'other', type: 'progress', phase: 'generating' } },
  ])('fails fast on malformed worker envelopes ($label) and can retry', async ({ data }) => {
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.onmessage?.({ data } as MessageEvent<unknown>);
    await expect(pending).rejects.toThrow('無法對照原文');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', generationMs: null,
    }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('ignores another request id without exposing its progress or explanation', async () => {
    const progress = vi.fn();
    const pending = runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal, onProgress: progress });
    const worker = lastWorker();
    progress.mockClear();
    worker.emit({ id: worker.request!.id + 1, type: 'progress', message: '私人內容' });
    worker.emit({ id: worker.request!.id + 1, type: 'result', raw: JSON.stringify(lesson()) });
    expect(progress).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
  });
});

describe('study cancellation and failure isolation', () => {
  it('pre-aborted calls allocate nothing; mid-run abort terminates and stale callbacks cannot affect a later run', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(runStudyTutor({ passage: passage(), mode: 'understand', signal: cancelled.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);

    const firstController = new AbortController();
    const first = runStudyTutor({ passage: passage(), mode: 'understand', history: history(), signal: firstController.signal });
    const firstWorker = lastWorker();
    const stale = firstWorker.onmessage!;
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const next = runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal });
    const nextWorker = lastWorker();
    expect(nextWorker.request!.prompt).toContain('HISTORY_DATA=[]');
    expect(nextWorker.request!.prompt).not.toContain('上一輪的問題');
    stale({ data: { id: firstWorker.request!.id, type: 'result', raw: JSON.stringify(lesson()) } } as MessageEvent);
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(nextWorker.terminate).not.toHaveBeenCalled();
    nextWorker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(next).resolves.toEqual(lesson());
  });

  it('a second concurrent request cannot allocate another model worker', async () => {
    const controller = new AbortController();
    const first = runStudyTutor({ passage: passage(), mode: 'understand', signal: controller.signal });
    await expect(runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal }))
      .rejects.toThrow('另一段講解');
    expect(FakeWorker.instances).toHaveLength(1);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps worker failures to study wording without showing the underlying private message', async () => {
    const pending = runStudyTutor({ passage: passage(), mode: 'practice', signal: new AbortController().signal });
    const worker = lastWorker();
    worker.emit({ type: 'error', code: 'memory', message: 'private student ID and source contents' });
    await expect(pending).rejects.toThrow('記憶體不足');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('keeps the worker token limit authoritative and offers a clear retry without history', async () => {
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', history: history(), signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'error', code: 'input_limit', message: 'private tokenizer diagnostics' });
    await expect(pending).rejects.toThrow('不帶追問紀錄重新講解');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = runStudyTutor({ passage: passage(), mode: 'understand', signal: new AbortController().signal });
    expect(lastWorker().request!.prompt).toContain('HISTORY_DATA=[]');
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it('cleans up a synchronous dispatch failure and allows a subsequent session', async () => {
    FakeWorker.failPost = true;
    await expect(runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal }))
      .rejects.toThrow('無法把本段');
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
    FakeWorker.failPost = false;
    const pending = runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
  });

  it('does not dispatch after progress delivery aborts the session or throws', async () => {
    const controller = new AbortController();
    await expect(runStudyTutor({
      passage: passage(), mode: 'exam', signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(lastWorker().postMessage).not.toHaveBeenCalled();
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
    await expect(runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
      onProgress: () => { throw new Error('private render failure'); },
    })).rejects.toThrow('工作已停止');
    expect(lastWorker().postMessage).not.toHaveBeenCalled();
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('times out the actual loading worker', async () => {
    vi.useFakeTimers();
    const failure = runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal })
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(STUDY_TUTOR_TIMEOUT_MS);
    expect(await failure).toMatchObject({ message: expect.stringContaining('模型準備逾時') });
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('bounds generation time even if the worker repeatedly reports progress', async () => {
    vi.useFakeTimers();
    const failure = runStudyTutor({ passage: passage(), mode: 'exam', signal: new AbortController().signal })
      .catch((error: Error) => error);
    const worker = lastWorker();
    worker.emit({ type: 'progress', phase: 'generating' });
    await vi.advanceTimersByTimeAsync(STUDY_TUTOR_GENERATION_TIMEOUT_MS - 1);
    worker.emit({ type: 'progress', phase: 'generating' });
    await vi.advanceTimersByTimeAsync(1);
    expect(await failure).toMatchObject({ message: expect.stringContaining('這段講解逾時') });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
