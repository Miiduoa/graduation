// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStudyTutorAvailability,
  runStudyTutor,
  STUDY_TUTOR_GENERATION_TIMEOUT_MS,
  STUDY_TUTOR_TIMEOUT_MS,
} from './studyTutorRuntime';
import { parseTutorExplanation, type StudyPassage, type StudyTutorHistory, type TutorExplanation } from './studyTutor';

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
  steps: [
    { title: '看主鍵', explanation: '辨識唯一的紀錄。', sourceQuote: '主鍵用來唯一識別一筆紀錄。' },
    { title: '看外鍵', explanation: '連接不同資料表。', sourceQuote: '外鍵連接資料表。' },
  ],
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

  it('settles the lesson and permits retry even if a crashed worker throws on termination', async () => {
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.terminate.mockImplementationOnce(() => {
      throw new Error('private worker crash details');
    });
    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();

    const retry = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
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

  it.each(['ကါ', '主\u200e鍵'])('accepts a readable Unicode citation in the main reply and a step (%#)', async (quote) => {
    const original = passage();
    const pending = runStudyTutor({
      passage: { ...original, text: original.text + '\n' + quote },
      mode: 'exam', signal: new AbortController().signal,
    });
    const response = lesson();
    response.sourceQuote = quote;
    response.steps![0].sourceQuote = quote;
    lastWorker().emit({ type: 'result', raw: JSON.stringify(response) });
    await expect(pending).resolves.toEqual(response);
  });

  it('rejects punctuation-only citations in newly generated lessons and still allows retry', async () => {
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    // The punctuation is literally in the source, so a substring-only check
    // would incorrectly treat it as meaningful evidence for the whole answer.
    worker.emit({ type: 'result', raw: JSON.stringify({ ...lesson(), sourceQuote: '。' }) });
    await expect(pending).rejects.toThrow('引句只有標點或符號');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects a punctuation-only individual step even if the main citation is meaningful', async () => {
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({
      type: 'result',
      raw: JSON.stringify({
        ...lesson(),
        steps: [
          { title: '核對主鍵', explanation: '先核對主鍵的用途。', sourceQuote: '主鍵用來唯一識別一筆紀錄。' },
          { title: '核對關聯', explanation: '檢查來源是否足以支援此步。', sourceQuote: '。' },
        ],
      }),
    });
    await expect(pending).rejects.toThrow('引句只有標點或符號');
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('requires 2–4 grounded steps for NEW lessons without breaking older saved replies', async () => {
    // Backward compatibility is a separate contract: old v1/v2 replies had
    // no steps, so restoring them must not be tightened by this worker rule.
    const legacy = { ...lesson(), steps: undefined };
    const parsed = parseTutorExplanation(JSON.stringify(legacy), passage());
    expect(parsed.steps).toBeUndefined();

    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(legacy) });
    await expect(pending).rejects.toThrow('缺少分步步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects cosmetic re-titling of the same step while retaining old saved lessons', async () => {
    const duplicated = {
      ...lesson(),
      steps: [
        lesson().steps![0],
        { ...lesson().steps![0], title: '換個名稱，但內容與引句相同' },
      ],
    };
    // The original parser still accepts old offline backups and validates
    // the cited source; only a NEW worker response must have distinct steps.
    expect(parseTutorExplanation(JSON.stringify(duplicated), passage()).steps).toHaveLength(2);

    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(duplicated) });
    await expect(pending).rejects.toThrow('重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects repeated explanations despite different citations and internal whitespace', async () => {
    const first = { ...lesson().steps![0], explanation: '先 辨識唯一的紀錄。' };
    const duplicated = {
      ...lesson(),
      steps: [
        first,
        {
          ...lesson().steps![1],
          title: '第二步：換來源但沒教新內容',
          explanation: '先 \n辨識唯一的紀錄。',
        },
      ],
    };
    // The citations both match this passage, and old saved lessons remain
    // readable. Only newly generated tutorials need distinct teaching steps.
    expect(parseTutorExplanation(JSON.stringify(duplicated), passage()).steps).toHaveLength(2);
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(duplicated) });
    await expect(pending).rejects.toThrow('重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it.each([
    { label: 'Chinese full stop to exclamation', punctuation: '！' },
    { label: 'Chinese full stop to ASCII question mark', punctuation: '?' },
    { label: 'Chinese full stop to trailing punctuation sequence', punctuation: '！？' },
  ])('rejects cosmetic $label in NEW steps while keeping old lessons readable', async ({ punctuation }) => {
    const repeated = {
      ...lesson(),
      steps: [
        lesson().steps![0],
        {
          ...lesson().steps![1],
          title: '改標題與引句，卻沒教新內容',
          explanation: '辨識唯一的紀錄' + punctuation,
        },
      ],
    };
    // Saved v1/v2 lessons retain their original permissive parser.
    expect(parseTutorExplanation(JSON.stringify(repeated), passage()).steps).toHaveLength(2);
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(repeated) });
    await expect(pending).rejects.toThrow('重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it('does not confuse distinct mathematical operations with punctuation-only duplicates', async () => {
    const equations = {
      ...lesson(),
      steps: [
        { ...lesson().steps![0], explanation: 'x - 1 = 2。' },
        { ...lesson().steps![1], explanation: 'x + 1 = 2！' },
      ],
    };
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(equations) });
    await expect(pending).resolves.toEqual(equations);
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects invisible Unicode changes that disguise a duplicate lesson step', async () => {
    const original = lesson().steps![0];
    const duplicated = {
      ...lesson(),
      steps: [
        original,
        {
          ...lesson().steps![1],
          title: '只加了不可見字元的第二步',
          explanation: '辨\u200b識唯一的紀錄。',
        },
      ],
    };
    // The saved-lesson parser remains backward compatible; only freshly
    // generated worker replies must have distinct visible teaching content.
    const saved = parseTutorExplanation(JSON.stringify(duplicated), passage());
    expect(saved.steps).toHaveLength(2);
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(duplicated) });
    await expect(pending).rejects.toThrow('重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it.each([
    { label: 'left-to-right mark', marker: '\u200e' },
    { label: 'right-to-left override', marker: '\u202e' },
    { label: 'bidi isolate', marker: '\u2066' },
    { label: 'combining grapheme joiner', marker: '\u034f' },
  ])('rejects a duplicate step disguised with $label without changing saved lessons', async ({ marker }) => {
    const duplicate = {
      ...lesson(),
      steps: [
        lesson().steps![0],
        {
          ...lesson().steps![1],
          title: '換標題與引句',
          explanation: '辨' + marker + '識唯一的紀錄。',
        },
      ],
    };
    expect(parseTutorExplanation(JSON.stringify(duplicate), passage()).steps).toHaveLength(2);
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(duplicate) });
    await expect(pending).rejects.toThrow('重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it.each([
    { label: 'zero-width space', explanation: '\u200b' },
    { label: 'bidi isolates', explanation: '\u2066\u2069' },
  ])('rejects a visually blank new step ($label) while retaining the original lesson', async ({ explanation }) => {
    const blank = {
      ...lesson(),
      steps: [lesson().steps![0], { ...lesson().steps![1], explanation }],
    };
    // Legacy offline progress remains parseable; only a NEW worker result is rejected.
    expect(parseTutorExplanation(JSON.stringify(blank), passage()).steps).toHaveLength(2);
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(blank) });
    await expect(pending).rejects.toThrow('空白或重複相同的教學步驟');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it.each([
    {
      label: 'summary contains only punctuation',
      mutate: (valid: TutorExplanation): TutorExplanation => ({
        ...valid, explanation: '。！？…',
      }),
    },
    {
      label: 'step contains only operators and punctuation',
      mutate: (valid: TutorExplanation): TutorExplanation => ({
        ...valid,
        steps: [
          valid.steps![0],
          { ...valid.steps![1], explanation: '＋÷＝！？' },
        ],
      }),
    },
    {
      label: 'invisible direction marks hide punctuation-only content',
      mutate: (valid: TutorExplanation): TutorExplanation => ({
        ...valid, explanation: '\u2066。！？\u2069',
      }),
    },
  ])('rejects a new lesson whose $label while preserving older backups and retry', async ({ mutate }) => {
    const invalid = mutate(lesson());
    // Saved v1/v2 lessons must remain readable, even when old AI quality is weak.
    expect(parseTutorExplanation(JSON.stringify(invalid), passage())).toEqual(invalid);
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(invalid) });
    await expect(pending).rejects.toThrow('說明只有標點或符號');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('rejects an overlong exact main citation rather than treating a whole paragraph as evidence', async () => {
    const longQuote = '主鍵用來唯一識別一筆紀錄。'.repeat(6);
    const source = { ...passage(), text: longQuote + '外鍵連接資料表。' };
    const pending = runStudyTutor({
      passage: source, mode: 'understand', signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify({ ...lesson(), sourceQuote: longQuote }) });
    await expect(pending).rejects.toThrow('引句超過 60 字');
    expect(worker.terminate).toHaveBeenCalledOnce();

    const retry = runStudyTutor({
      passage: source, mode: 'understand', signal: new AbortController().signal,
    });
    const valid = { ...lesson(), sourceQuote: '主鍵用來唯一識別一筆紀錄。' };
    lastWorker().emit({ type: 'result', raw: JSON.stringify(valid) });
    await expect(retry).resolves.toEqual(valid);
  });

  it('rejects an overlong exact step citation even when the main citation is short', async () => {
    const longQuote = '主鍵用來唯一識別一筆紀錄。'.repeat(6);
    const source = { ...passage(), text: longQuote + '外鍵連接資料表。' };
    const pending = runStudyTutor({
      passage: source, mode: 'exam', signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify({
      ...lesson(),
      steps: [
        { title: '核對主鍵', explanation: '對照主鍵定義。', sourceQuote: '主鍵用來唯一識別一筆紀錄。' },
        { title: '核對全文', explanation: '這段引文過長。', sourceQuote: longQuote },
      ],
    }) });
    await expect(pending).rejects.toThrow('引句超過 60 字');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('counts generated quote length by Unicode code point, not UTF-16 units', async () => {
    const quote = '😀'.repeat(59) + '甲';
    const source = { ...passage(), text: quote + passage().text };
    const pending = runStudyTutor({
      passage: source, mode: 'practice', signal: new AbortController().signal,
    });
    const valid = { ...lesson(), sourceQuote: quote };
    lastWorker().emit({ type: 'result', raw: JSON.stringify(valid) });
    await expect(pending).resolves.toEqual(valid);
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
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
    { label: 'zero id', data: { id: 0, type: 'progress', phase: 'generating' } },
    { label: 'negative id', data: { id: -1, type: 'error', code: 'runtime' } },
    { label: 'fractional id', data: { id: 1.5, type: 'result', raw: JSON.stringify(lesson()) } },
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

  it.each([
    { label: 'unknown loading phase', before: false, invalid: 'decoding' },
    { label: 'loading after generation begins', before: true, invalid: 'loading' },
  ])('fails fast on inconsistent worker progress ($label) and retries safely', async ({ before, invalid }) => {
    const onTiming = vi.fn();
    const progress = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onProgress: progress, onTiming,
    });
    const worker = lastWorker();
    if (before) worker.emit({ type: 'progress', phase: 'generating' });
    const delivered = progress.mock.calls.length;
    worker.emit({ type: 'progress', phase: invalid, message: 'private worker details' });
    await expect(pending).rejects.toThrow('無法對照原文');
    expect(progress).toHaveBeenCalledTimes(delivered);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', generationMs: before ? expect.any(Number) : null,
    }));
    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('keeps unphased legacy progress in the generation stage after generation begins', async () => {
    const onProgress = vi.fn();
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onProgress, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'progress', message: '正在下載辨識模型（已接收 12 MB）' });
    expect(onProgress).toHaveBeenLastCalledWith('正在下載講解模型（已接收 12 MB）');

    worker.emit({ type: 'progress', phase: 'generating' });
    worker.emit({ type: 'progress', message: '正在下載辨識模型（已接收 99 MB）' });
    expect(onProgress).toHaveBeenLastCalledWith('正在依本段原文準備講解與自我檢查題…');

    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'success', generationMs: expect.any(Number),
    }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not restart the generation deadline for unphased late progress', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand',
      signal: new AbortController().signal, onProgress,
    }).catch((error: Error) => error);
    const worker = lastWorker();
    worker.emit({ type: 'progress', phase: 'generating' });
    await vi.advanceTimersByTimeAsync(STUDY_TUTOR_GENERATION_TIMEOUT_MS / 2);
    worker.emit({ type: 'progress', message: '正在下載辨識模型（已接收 101 MB）' });
    expect(onProgress).toHaveBeenLastCalledWith('正在依本段原文準備講解與自我檢查題…');
    await vi.advanceTimersByTimeAsync(STUDY_TUTOR_GENERATION_TIMEOUT_MS / 2);
    expect(await pending).toMatchObject({ message: expect.stringContaining('這段講解逾時') });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects an impossible future request id immediately and permits retry', async () => {
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ id: worker.request!.id + 1, type: 'progress', phase: 'generating', message: '私人內容' });
    await expect(pending).rejects.toThrow('無法對照原文');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', generationMs: null,
    }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it('ignores an earlier completed request id without exposing stale progress', async () => {
    const earlier = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    const previousWorker = lastWorker();
    const earlierId = previousWorker.request!.id;
    previousWorker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(earlier).resolves.toEqual(lesson());

    const progress = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal, onProgress: progress,
    });
    const worker = lastWorker();
    expect(earlierId).toBeLessThan(worker.request!.id);
    progress.mockClear();
    worker.emit({ id: earlierId, type: 'progress', message: '私人內容' });
    worker.emit({ id: earlierId, type: 'result', raw: JSON.stringify(lesson()) });
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

  it('does not dispatch after progress delivery explicitly aborts the session', async () => {
    const controller = new AbortController();
    await expect(runStudyTutor({
      passage: passage(), mode: 'exam', signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(lastWorker().postMessage).not.toHaveBeenCalled();
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('preserves a valid local lesson when progress rendering throws at startup or later phases', async () => {
    const onProgress = vi.fn(() => { throw new Error('private render failure'); });
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
      onProgress, onTiming,
    });
    const worker = lastWorker();
    expect(worker.postMessage).toHaveBeenCalledOnce();
    worker.emit({ type: 'progress', phase: 'loading', message: 'received 20 MB' });
    worker.emit({ type: 'progress', phase: 'generating' });
    worker.emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(pending).resolves.toEqual(lesson());
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it('keeps real worker failures authoritative when the progress callback also throws', async () => {
    const onProgress = vi.fn(() => { throw new Error('private render failure'); });
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal, onProgress,
    });
    const worker = lastWorker();
    worker.emit({ type: 'error', code: 'memory' });
    await expect(pending).rejects.toThrow('裝置記憶體不足');
    expect(worker.terminate).toHaveBeenCalledOnce();
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


describe('new local lesson source-copy teaching boundary', () => {
  it.each([
    {
      label: 'main explanation copies its citation',
      mutate: (original: TutorExplanation) => ({ ...original, explanation: original.sourceQuote }),
    },
    {
      label: 'step repeats its quote with a different sentence ending',
      mutate: (original: TutorExplanation) => ({
        ...original,
        steps: [
          original.steps![0],
          { ...original.steps![1], explanation: '外鍵連接資料表！' },
        ],
      }),
    },
    {
      label: 'step copies a quotation with invisible direction marks',
      mutate: (original: TutorExplanation) => ({
        ...original,
        steps: [
          { ...original.steps![0], explanation: '\u2066主鍵用來唯一識別一筆紀錄。\u2069' },
          original.steps![1],
        ],
      }),
    },
  ])('rejects $label only for NEW generation, keeps saved lessons and retries', async ({ mutate }) => {
    const repeated = mutate(lesson());
    // Old locally saved explanations still decode without any migration.
    expect(parseTutorExplanation(JSON.stringify(repeated), passage()).steps).toHaveLength(2);
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(repeated) });
    await expect(pending).rejects.toThrow('只是照抄原文引句');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'understand', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });

  it('retains a new lesson when its source quote supports a genuinely different explanation', async () => {
    const valid = { ...lesson(), steps: [
      { ...lesson().steps![0], explanation: '主鍵是資料列的識別依據。' },
      { ...lesson().steps![1], explanation: '藉由外鍵把兩個資料表建立關聯。' },
    ] };
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(valid) });
    await expect(pending).resolves.toEqual(valid);
    expect(lastWorker().terminate).toHaveBeenCalledOnce();
  });
});

describe('new lesson self-check quality boundary', () => {
  it.each([
    { field: 'question', label: 'punctuation-only question', content: '？？？' },
    { field: 'answer', label: 'operator-only answer', content: '＋÷＝' },
    { field: 'answer', label: 'invisible direction marks hiding punctuation', content: '\u2066！？\u2069' },
  ] as const)('rejects $label without breaking legacy saved lessons or retries', async ({ field, content }) => {
    const invalid = { ...lesson(), [field]: content };
    expect(parseTutorExplanation(JSON.stringify(invalid), passage())[field]).toBe(content);

    const timing = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'practice',
      signal: new AbortController().signal, onTiming: timing,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(invalid) });
    await expect(pending).rejects.toThrow('複習題或參考回答只有標點或符號');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'practice', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify({ ...lesson(), answer: 'x = 2' }) });
    await expect(retry).resolves.toMatchObject({ answer: 'x = 2' });
  });

  it.each([
    { label: 'a decimal point', question: 'x = 1.2？', answer: 'x = 12' },
    { label: 'parenthesized arithmetic', question: '(a+b) * c？', answer: 'a+b * c' },
    { label: 'numeric grouping punctuation', question: '1,000？', answer: '1000' },
    { label: 'outer parentheses affect grouping', question: '(a+b)？', answer: 'a+b' },
    { label: 'square brackets denote a collection', question: '[a,b]？', answer: 'a,b' },
    { label: 'leading decimal point is a number', question: '.5？', answer: '5' },
    { label: 'full-width expression brackets', question: '（a+b）？', answer: 'a+b' },
  ])('retains a NEW mathematical self-check when only its INTERNAL punctuation differs ($label)', async ({ question, answer }) => {
    const mathematical = { ...lesson(), question, answer };
    // The question and answer are not the same mathematical expression.
    // Legacy v1/v2 study progress parsing remains untouched.
    expect(parseTutorExplanation(JSON.stringify(mathematical), passage()))
      .toMatchObject({ question, answer });
    const onTiming = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam',
      signal: new AbortController().signal, onTiming,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(mathematical) });
    await expect(pending).resolves.toEqual(mathematical);
    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'exact repetition', question: '主鍵', answer: '主鍵' },
    { label: 'punctuation and direction marks', question: '\u2066主鍵？', answer: '主鍵。' },
    { label: 'case and whitespace', question: 'SQL ? ', answer: 'sql' },
    { label: 'cosmetic Chinese quote marks', question: '「主鍵？」', answer: '主鍵。' },
    { label: 'English sentence punctuation', question: 'SQL!', answer: 'sql' },
  ])('rejects a tautological self-check ($label) while preserving saved formats and retry', async ({ question, answer }) => {
    const repeated = { ...lesson(), question, answer };
    // Legacy v1/v2 lesson decoding is deliberately unchanged.
    expect(parseTutorExplanation(JSON.stringify(repeated), passage())).toMatchObject({ question: question.trim(), answer: answer.trim() });
    const timing = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam',
      signal: new AbortController().signal, onTiming: timing,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(repeated) });
    await expect(pending).rejects.toThrow('複習題和參考回答內容相同');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });
});


describe('new local self-check answer disclosure boundary', () => {
  it.each([
    { label: 'short Chinese answer key', question: '哪個欄位？\n答：主鍵', answer: '主鍵' },
    { label: 'short 答 Markdown heading', question: '哪個欄位？\n## 答\n主鍵', answer: '主鍵' },
    { label: 'bold 答 Markdown heading with CR-only lines', question: '哪個欄位？\r### **答**\r主鍵', answer: '主鍵' },
    { label: 'standalone 答 line', question: '哪個欄位？\n答\n主鍵', answer: '主鍵' },
    { label: 'blockquote 答 key line', question: '哪個欄位？\n> 答\n> 主鍵', answer: '主鍵' },
    { label: 'short Chinese answer key with equals', question: '哪個欄位？ 答 = 主鍵', answer: '主鍵' },
    { label: 'bold short Chinese answer label', question: '哪個欄位？ **答**：主鍵', answer: '主鍵' },
    { label: 'short Chinese Markdown answer column', question: '選哪個？\n| 題目 | 答 |\n| --- | --- |\n| A | 主鍵 |', answer: '主鍵' },
    { label: 'CR-only Markdown answer column', question: 'Which language?\r| Prompt | Answer |\r| --- | --- |\r| DB | SQL |', answer: 'SQL' },
    { label: 'answer key inline disclosure', question: 'Which language? Answer key: SQL', answer: 'SQL' },
    { label: 'emphasized answer key label', question: 'Which language? **Answer Key**：SQL', answer: 'SQL' },
    { label: 'answer-key Markdown column', question: 'Which language?\n| Prompt | Answer Key |\n| --- | --- |\n| DB | SQL |', answer: 'SQL' },
    { label: 'Ans. abbreviated column with CR-only lines', question: 'Which language?\r| Prompt | Ans. |\r| --- | --- |\r| DB | SQL |', answer: 'SQL' },
    { label: 'standalone abbreviated answer label', question: 'Which language?\nAns.\nSQL', answer: 'SQL' },
    { label: 'Markdown answer key heading', question: 'Which language?\n### Answer Key\nSQL', answer: 'SQL' },
    { label: 'standalone Answer Key line', question: 'Which language?\nAnswer Key\nSQL', answer: 'SQL' },
    { label: 'emphasized Answer Key heading', question: 'Which language?\n### **Answer Key**\nSQL', answer: 'SQL' },
    { label: 'Answer Key heading with trailing hashes', question: 'Which language?\n## Answer Key ##\nSQL', answer: 'SQL' },
    { label: 'CR-only Chinese answer heading', question: '哪個欄位？\r## 答案\r主鍵', answer: '主鍵' },
    { label: 'CR-only unpunctuated English answer list', question: 'Which language?\rAnswer\r> - SQL', answer: 'SQL' },
    { label: 'CR-only fenced answer', question: 'Which language? Answer:\r~~~txt\rSQL\r~~~', answer: 'SQL' },
    { label: 'mixed LF and CR answer heading', question: 'Which language?\n### Answer\rSQL', answer: 'SQL' },
    { label: 'English answer followed by teaching words', question: 'Which language? Answer: SQL is a database language.', answer: 'SQL' },
    { label: 'Latin answer followed by tabs', question: 'What is used? Answer: SQL\tcan query tables.', answer: 'SQL' },
    { label: 'Markdown link visibly spells out answer', question: 'Which query language? Answer: [SQL](https://example.test/reference)', answer: 'SQL' },
    { label: 'Markdown image alt reveals answer to screen readers', question: 'Which term? 答案：![主鍵](diagram.png)', answer: '主鍵' },
    { label: 'emphasized Markdown link reveals fullwidth key', question: 'Which term? Answer: **[ＳＱＬ](reference.md)**', answer: 'SQL' },
    { label: 'fullwidth Latin answer key', question: '哪個語言？Ａｎｓｗｅｒ：ＳＱＬ', answer: 'SQL' },
    { label: 'fullwidth decimal answer key', question: '計算結果？正解：１．２', answer: '1.2' },
    { label: 'mixed width key', question: '資料庫題。答案：ＳQＬ', answer: 'SQL' },
    { label: 'reference answer uses fullwidth letters', question: '資料庫題。答案：SQL', answer: 'ＳＱＬ' },
    { label: 'fullwidth Markdown-looking table key', question: '哪個指令？\n｜ 題目 ｜ Ａｎｓｗｅｒ ｜\n｜ --- ｜ --- ｜\n｜ 範例 ｜ ＳＱＬ ｜', answer: 'SQL' },
    { label: 'a short Chinese answer in parentheses', question: '哪個欄位？（參考回答：學號）', answer: '學號' },
    { label: 'an English answer key', question: '哪個指令？ 標準答案: SQL。', answer: 'SQL' },
    { label: 'a numeric answer after an answer label', question: '計算結果？答案：1.2', answer: '1.2' },
    { label: 'a quoted answer with spaces', question: '哪種欄位？解答：「外鍵 連接」', answer: '外鍵連接' },
    { label: 'an answer described with 是', question: '教材的解答是：資料表', answer: '資料表' },
    { label: 'a key described with 為', question: '這題正解為「主鍵」', answer: '主鍵' },
    { label: 'Markdown fenced Chinese answer', question: '請解釋。答案：\n```text\n主鍵\n```', answer: '主鍵' },
    { label: 'Markdown fenced SQL key', question: 'Which statement? Answer:\n```sql\nSQL\n```', answer: 'SQL' },
    { label: 'tilde fenced decimal answer', question: '請計算。解答：\n~~~\n1.2\n~~~', answer: '1.2' },
    { label: 'fenced answer following blank line', question: '請選擇。正解：\n\n```txt\nB\n```', answer: 'B' },
    { label: 'CRLF fenced Chinese answer', question: '請回答。參考回答：\r\n```txt\r\n外鍵連接\r\n```', answer: '外鍵連接' },
    { label: 'blockquote fenced Chinese key', question: '請回答。答案：\n> ```txt\n> 主鍵\n> ```', answer: '主鍵' },
    { label: 'nested blockquote fenced SQL key', question: 'What? Answer:\r\n>> ~~~sql\r\n>> SQL\r\n>> ~~~', answer: 'SQL' },
    { label: 'blockquote fenced numeric key', question: '請計算。正解：\n> ```\n> 1.2\n> ```', answer: '1.2' },
    { label: 'blockquote fenced key with blank line', question: '請選擇。參考回答：\n\n> ```text\n> B\n> ```', answer: 'B' },
    { label: 'a plain English key', question: 'Expected answer: SQL', answer: 'SQL' },
    { label: 'an equal-sign answer key', question: '結果為何？答案＝1.2', answer: '1.2' },
    { label: 'a numerical answer without punctuation', question: '複習：答案為 2', answer: '2' },
    { label: 'a Chinese reference solution', question: '考試提示：參考解答：主鍵', answer: '主鍵' },
    { label: 'a multiple-choice answer key', question: '請寫出結果。正確選項：B', answer: 'B' },
    { label: 'a Chinese 就是 answer key', question: '請回答？答案就是資料表', answer: '資料表' },
    { label: 'an English is answer key', question: 'How? Answer is SQL', answer: 'SQL' },
    { label: 'an English correct answer key', question: 'What? Correct answer: SQL', answer: 'SQL' },
    { label: 'an English solution key', question: 'What? Solution = SQL', answer: 'SQL' },
    { label: 'an English reference answer', question: 'What? Reference answer is SQL', answer: 'SQL' },
    { label: 'Markdown inline code answer', question: 'What? Answer: `SQL`', answer: 'SQL' },
    { label: 'bold answer-key label with colon', question: '哪個欄位？**答案**：主鍵', answer: '主鍵' },
    { label: 'underscored answer-key label with equal sign', question: '選哪一項？__正解__＝B', answer: 'B' },
    { label: 'italic English solution label', question: 'Which language? *Solution*: SQL', answer: 'SQL' },
    { label: 'inline code answer-key label', question: 'Which language? `Answer`: SQL', answer: 'SQL' },
    { label: 'bold English correct-answer label', question: 'Which language? **Correct answer**: SQL', answer: 'SQL' },
    { label: 'bold Chinese key followed by 就是', question: '哪個欄位？**答案**就是主鍵', answer: '主鍵' },
    { label: 'Markdown bold Chinese answer', question: '複習題。答案：**主鍵**', answer: '主鍵' },
    { label: 'Markdown bold English answer', question: 'What? Correct answer: **SQL**', answer: 'SQL' },
    { label: 'nested quote and code marker', question: '參考答案：「`SQL`」', answer: 'SQL' },
    { label: 'single underscore emphasis', question: 'What? Solution: _SQL_', answer: 'SQL' },
    { label: 'double underscore emphasis', question: 'What? Solution: __SQL__', answer: 'SQL' },
    { label: 'underscore emphasis inside Chinese quotes', question: '參考答案：「_SQL_」', answer: 'SQL' },
    { label: 'Markdown emphasis on decimal', question: '解答：*1.2*', answer: '1.2' },
    { label: 'GFM strikethrough English answer', question: 'Which language? Answer: ~~SQL~~', answer: 'SQL' },
    { label: 'GFM strikethrough Chinese answer', question: '哪個欄位？答案：~~主鍵~~', answer: '主鍵' },
    { label: 'GFM strikethrough decimal answer', question: '結果為何？解答：~~1.2~~', answer: '1.2' },
    { label: 'bold nested GFM strikethrough answer', question: 'Which language? Answer: **~~SQL~~**', answer: 'SQL' },
    { label: 'same-line Markdown bullet with English key', question: 'Answer: - SQL', answer: 'SQL' },
    { label: 'same-line Chinese bullet with Chinese key', question: '答案：• 主鍵', answer: '主鍵' },
    { label: 'same-line numbered choice key', question: '正解：1. B', answer: 'B' },
    { label: 'same-line quoted Markdown answer key', question: 'Answer: > * SQL', answer: 'SQL' },
    { label: 'same-line plus bullet key', question: '答案：+ SQL', answer: 'SQL' },
    { label: 'Markdown unordered answer list', question: 'Answer:\n- SQL', answer: 'SQL' },
    { label: 'Chinese bullet answer list', question: '答案：\n• 主鍵', answer: '主鍵' },
    { label: 'Numbered answer item with inline code', question: '解答：\n1. `SQL`', answer: 'SQL' },
    { label: 'Markdown list plus bold answer', question: 'Correct answer:\n* **SQL**', answer: 'SQL' },
    { label: 'CRLF answer list with indentation', question: 'Answer:\r\n\t- SQL', answer: 'SQL' },
    { label: 'two-digit numbered answer list', question: '答案：\n12. 主鍵', answer: '主鍵' },
    { label: 'blank line before Markdown bullet', question: 'Answer:\n\n- SQL', answer: 'SQL' },
    { label: 'indented blank line and numbered key', question: '解答：\n  \n  1. 主鍵', answer: '主鍵' },
    { label: 'quoted Markdown bullet', question: 'Answer:\n> - SQL', answer: 'SQL' },
    { label: 'CRLF blank lines and nested quote', question: '答案：\r\n\r\n>> * 主鍵', answer: '主鍵' },
    { label: 'literal HTML strong answer', question: 'What? Answer: <strong>SQL</strong>', answer: 'SQL' },
    { label: 'literal HTML nested answer', question: '參考答案：<strong><code>主鍵</code></strong>', answer: '主鍵' },
    { label: 'literal HTML code and Markdown', question: 'What? Solution: **<code>SQL</code>**', answer: 'SQL' },
    { label: 'literal HTML span on a numeric answer', question: '解答：<span>1.2</span>', answer: '1.2' },
    { label: 'HTML strong with a class attribute', question: 'What? Answer: <strong class="key">SQL</strong>', answer: 'SQL' },
    { label: 'HTML code language attribute', question: '參考答案：<code lang="zh-TW">主鍵</code>', answer: '主鍵' },
    { label: 'nested HTML tags with attributes', question: 'What? Answer: <span class="hint"><em data-key=answer>SQL</em></span>', answer: 'SQL' },
    { label: 'single-quoted HTML title attribute', question: "參考答案：<span title='要複習'>主鍵</span>", answer: '主鍵' },
    { label: 'numeric answer with HTML attributes', question: "解答：<span class='value'>1.2</span>", answer: '1.2' },
    { label: 'HTML entity strong answer', question: 'What? Answer: &lt;strong&gt;SQL&lt;/strong&gt;', answer: 'SQL' },
    { label: 'decimal HTML entity code answer', question: '參考答案：&#60;code&#62;主鍵&#60;/code&#62;', answer: '主鍵' },
    { label: 'hex HTML entity answer', question: '解答：&#x3C;span class="value"&#x3E;1.2&#x3C;/span&#x3E;', answer: '1.2' },
    { label: 'Chinese book title brackets', question: '答案：《主鍵》', answer: '主鍵' },
    { label: 'Chinese angle quote brackets', question: 'Answer: 〈SQL〉', answer: 'SQL' },
    { label: 'Markdown table Chinese answer cell', question: '| 題型 | 答案 | 主鍵 |', answer: '主鍵' },
    { label: 'Markdown table English inline code answer cell', question: '| Answer | `SQL` |', answer: 'SQL' },
    { label: 'Markdown table Chinese bold key', question: '| 正解 | **主鍵** |', answer: '主鍵' },
    { label: 'Markdown table numeric key', question: '| 參考回答 | 1.2 |', answer: '1.2' },
    { label: 'aligned Chinese answer column', question: '哪個欄位？\n| 題目 | 答案 |\n| --- | --- |\n| 識別紀錄 | 主鍵 |', answer: '主鍵' },
    { label: 'English answer column in CRLF table', question: 'Which term?\r\n| Prompt | Answer |\r\n| :--- | ---: |\r\n| DB | `SQL` |', answer: 'SQL' },
    { label: 'escaped pipe before answer column', question: '哪個鍵？\n| 範例 | 答案 |\n| --- | --- |\n| A\\|B | 主鍵 |', answer: '主鍵' },
    { label: 'inline code pipe before English answer column', question: '哪個指令？\n| 片段 | Answer |\n| --- | --- |\n| `select a|b` | SQL |', answer: 'SQL' },
    { label: 'double backtick code pipe before answer', question: '哪個鍵？\n| 程式碼 | 正解 |\n| --- | --- |\n| ``a|b`` | 主鍵 |', answer: '主鍵' },
    { label: 'CRLF with escaped pipe and later answer row', question: '哪個欄位？\r\n| 範例 | 參考回答 |\r\n| --- | --- |\r\n| A\\|B | 其他 |\r\n| `x|y` | **外鍵** |', answer: '外鍵' },
    { label: 'single-column Markdown answer table', question: '計算結果為何？\n| 正解 |\n| --- |\n| 1.2 |', answer: '1.2' },
    { label: 'bold key in a later table row', question: '請解釋。\n| 題型 | 參考回答 |\n| --- | --- |\n| 例題 | 其他 |\n| 練習 | **外鍵** |', answer: '外鍵' },
    { label: 'answer column on the left', question: '選哪個？\n| 正確選項 | 題號 |\n| --- | --- |\n| B | 第一題 |', answer: 'B' },
    { label: 'Chinese heading without colon', question: '哪個欄位唯一識別紀錄？\n## 答案\n主鍵', answer: '主鍵' },
    { label: 'English heading with CRLF and inline code', question: 'Which language?\r\n### Answer\r\n`SQL`', answer: 'SQL' },
    { label: 'bold heading and blockquoted bullet', question: '哪種鍵連接另一張表？\n#### **參考回答**\n> - 外鍵', answer: '外鍵' },
    { label: 'fenced answer under a Markdown heading', question: '選哪一項？\n## 正解\n~~~text\nB\n~~~', answer: 'B' },
    { label: 'plain Chinese answer line without punctuation', question: '哪個鍵識別紀錄？\n答案\n主鍵', answer: '主鍵' },
    { label: 'plain English answer line with CRLF', question: 'Which keyword?\r\nAnswer\r\nSQL', answer: 'SQL' },
    { label: 'unordered bold key without a colon', question: '哪個欄位？\n- **答案** 主鍵', answer: '主鍵' },
    { label: 'numbered reference key without a colon', question: '哪個欄位？\n1. 正確答案 外鍵', answer: '外鍵' },
    { label: 'blockquote key without a colon', question: '哪個欄位？\n> 答案 主鍵', answer: '主鍵' },
    { label: 'two-level blockquote key without punctuation', question: 'Which term?\n>> **Answer** SQL', answer: 'SQL' },
  ])('rejects $label, preserves old backup parsing and allows retry', async ({ question, answer }) => {
    const leaked = { ...lesson(), question, answer };
    expect(parseTutorExplanation(JSON.stringify(leaked), passage()))
      .toMatchObject({ question, answer });

    const timing = vi.fn();
    const pending = runStudyTutor({
      passage: passage(), mode: 'exam',
      signal: new AbortController().signal, onTiming: timing,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(leaked) });
    await expect(pending).rejects.toThrow('直接寫出參考答案');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));

    const retry = runStudyTutor({
      passage: passage(), mode: 'exam', signal: new AbortController().signal,
    });
    lastWorker().emit({ type: 'result', raw: JSON.stringify(lesson()) });
    await expect(retry).resolves.toEqual(lesson());
  });

  it.each([
    { question: '「試答：SQL」在這份教材表示什麼？', answer: 'SQL' },
    { question: '「問答：SQL」格式中的主題是什麼？', answer: 'SQL' },
    { question: '答：SQLServer 跟 SQL 有什麼區別？', answer: 'SQL' },
    { question: '哪個欄位？\n## 答\n外鍵', answer: '主鍵' },
    { question: '哪個欄位？\n## 問答\n主鍵', answer: '主鍵' },
    { question: 'Which language?\r| Prompt | Answer |\r| --- | --- |\r| DB | SQLServer |', answer: 'SQL' },
    { question: 'Which language? Answer key: SQLServer instead of SQL?', answer: 'SQL' },
    { question: 'Which language?\n| Prompt | Ans. |\n| --- | --- |\n| DB | SQLServer |', answer: 'SQL' },
    { question: 'Which language?\n| Prompt | Answer Key |\n| --- | --- |\n| DB | NoSQL |', answer: 'SQL' },
    { question: 'Which language?\rAnswer\rSQLServer', answer: 'SQL' },
    { question: 'Which language?\n### Answer Key\nSQLServer', answer: 'SQL' },
    { question: 'Which language?\nAnswer Key\nNoSQL', answer: 'SQL' },
    { question: '哪個數值？\r## 答案\r12', answer: '1' },
    { question: 'Answer: SQLServer is different from SQL?', answer: 'SQL' },
    { question: 'Answer: ~~SQLServer~~ is a different product?', answer: 'SQL' },
    { question: '答案：~~12~~ 是否太大？', answer: '1' },
    { question: '答案：~1 的位元運算結果為何？', answer: '1' },
    { question: '答案：~~外鍵~~ 和主鍵有什麼不同？', answer: '主鍵' },
    { question: 'Answer: [SQLServer](https://example.test) refers to which product?', answer: 'SQL' },
    { question: 'Answer: [12](https://example.test/number) is too large?', answer: '1' },
    { question: 'Answer: [外鍵](https://example.test/term) 有什麼用途？', answer: '主鍵' },
    { question: '答案：ＳＱＬＳｅｒｖｅｒ 有什麼用途？', answer: 'SQL' },
    { question: '答案：１２ 是否過大？', answer: '1' },
    { question: '解答：x² 和 x2 有什麼差異？', answer: 'x2' },
    { question: '答案：－１', answer: '1' },
    { question: '主鍵用來識別什麼？', answer: '每一筆紀錄。' },
    { question: '題目出現「答案：」欄位時應如何核對？', answer: '先核對教材原文' },
    { question: '(a+b)？', answer: 'a+b' },
    { question: '答案是什麼？', answer: '主鍵' },
    { question: '答案：12 是否可行？', answer: '1' },
    { question: '答案：1.23 是否合理？', answer: '1.2' },
    { question: '答案：SQL 和 NoSQL 有何不同？', answer: '外鍵' },
    { question: 'Answer: SQL 這個提示代表什麼？', answer: '主鍵' },
    { question: '答案：\n```sql\nSQLServer\n``` 的用途是什麼？', answer: 'SQL' },
    { question: '答案：\n> ```sql\n> SQLServer\n> ``` 的用途是什麼？', answer: 'SQL' },
    { question: 'Answer:\r\n>> ~~~\r\n>> 12\r\n>> ~~~ is this right?', answer: '1' },
    { question: '答案：\n> ```sql\n> SELECT * FROM books\n> ``` 如何執行？', answer: 'SQL' },
    { question: '答案：\n```\n12\n``` 是正確數值嗎？', answer: '1' },
    { question: '答案：\n```sql\nSELECT * FROM books\n``` 如何理解？', answer: '外鍵' },
    { question: '答案：SQLServer 的語法用途？', answer: 'SQL' },
    { question: '正確選項：B2 如何處理？', answer: 'B' },
    { question: '答案：**SQLServer** 的用途是什麼？', answer: 'SQL' },
    { question: '答案：`B2` 這個符號代表什麼？', answer: 'B' },
    { question: '**答案**：SQLServer 的語法用途？', answer: 'SQL' },
    { question: '__正解__＝12 是否正確？', answer: '1' },
    { question: '**答案**應該如何核對？', answer: '主鍵' },
    { question: '*Solution*: SQL 與 NoSQL 差異為何？', answer: '外鍵' },
    { question: '答案：**12** 是否合理？', answer: '1' },
    { question: '答案：`SQL` 為何要使用？', answer: '外鍵' },
    { question: 'What? Solution: SQL_joins?', answer: 'SQL' },
    { question: 'What? Solution: _SQL_joins?', answer: 'SQL' },
    { question: 'What? Solution: __SQL__Server?', answer: 'SQL' },
    { question: 'What? Solution: SQL_', answer: 'SQL' },
    { question: '答案：- 1', answer: '1' },
    { question: '答案：- 12', answer: '1' },
    { question: 'Answer: 1. SQLServer', answer: 'SQL' },
    { question: 'Answer: - SQL_joins', answer: 'SQL' },
    { question: '答案：- SQL', answer: '外鍵' },
    { question: 'Answer:\n- SQL_joins', answer: 'SQL' },
    { question: '答案：\n- 12', answer: '1' },
    { question: 'Answer:\n- SQLServer', answer: 'SQL' },
    { question: '答案：\r\n- 12', answer: '1' },
    { question: 'Answer:\r\n12. SQLServer', answer: 'SQL' },
    { question: 'Answer:\n\n- SQLServer', answer: 'SQL' },
    { question: '答案：\n> - 12', answer: '1' },
    { question: 'Answer:\n> - SQL_joins', answer: 'SQL' },
    { question: 'Answer: <strong>SQLServer</strong> 有何用途？', answer: 'SQL' },
    { question: 'Answer: &lt;strong&gt;SQLServer&lt;/strong&gt; 有何用途？', answer: 'SQL' },
    { question: '正解：&#60;code&#62;B2&#60;/code&#62; 是什麼？', answer: 'B' },
    { question: '答案：《12》是不是太大？', answer: '1' },
    { question: 'Answer: <strong class="name">SQLServer</strong> 有何用途？', answer: 'SQL' },
    { question: '正解：<code lang="en">B2</code> 是哪個選項？', answer: 'B' },
    { question: "答案：<span class='number'>12</span> 是否正確？", answer: '1' },
    { question: 'Answer: <span title="shown">SQL</span> 代表什麼？', answer: '主鍵' },
    { question: '正解：<code>B2</code> 在程式中指什麼？', answer: 'B' },
    { question: '答案：<span>12</span> 是不是太大？', answer: '1' },
    { question: 'Answer: <strong>外鍵</strong>，請比較主鍵', answer: '主鍵' },
    { question: 'Answer is what?', answer: 'SQL' },
    { question: '請比較正解為主鍵與外鍵之差異', answer: '外鍵' },
    { question: '| Answer | SQLServer |', answer: 'SQL' },
    { question: '| 答案 | 12 |', answer: '1' },
    { question: '| Answer | `SQL` |', answer: '外鍵' },
    { question: '答案在哪？\n| 題目 | 答案 |\n| --- | --- |\n| 示例 | SQLServer |', answer: 'SQL' },
    { question: '是否正確？\n| 題目 | 正解 |\n| --- | --- |\n| 示例 | 12 |', answer: '1' },
    { question: '哪個欄位？\n| 題目 | Answer |\n| --- | --- |\n| 示例 | 主鍵 |', answer: '外鍵' },
    { question: '請比較。\n| 範例 | 答案 |\n| --- | --- |\n| A\\|B | SQLServer |', answer: 'SQL' },
    { question: '哪個選項？\n| 程式碼 | Answer |\n| --- | --- |\n| `a|b` | 12 |', answer: '1' },
    { question: '如何解讀？\n| 範例 | 正解 |\n| --- | --- |\n| ``a|b`` | 其他概念 |', answer: '主鍵' },
    { question: '請解釋。\n| 範例 | 答案 |\n| --- | --- |\n| A\\|B | SQL |', answer: '外鍵' },
    { question: '表格內容是什麼？\n| 術語 | 範例 |\n| --- | --- |\n| 語法 | SQL |', answer: 'SQL' },
    { question: 'Which database?\n## Answer\nSQLServer', answer: 'SQL' },
    { question: '算出哪個值？\n## 答案\n12', answer: '1' },
    { question: '哪個概念？\n### **參考回答**\n其他概念', answer: '外鍵' },
    { question: '標題中有 ## Answer 的例句如何理解？\nSQL', answer: 'SQL' },
    { question: '哪種資料庫？\n答案 SQLServer', answer: 'SQL' },
    { question: '哪個數值？\n答案 12', answer: '1' },
    { question: '哪個欄位？\n- **答案** 外鍵', answer: '主鍵' },
    { question: '題目說「答案 主鍵」時代表什麼？', answer: '主鍵' },
  ])('keeps a question without a disclosed answer: $question', async ({ question, answer }) => {
    const valid = { ...lesson(), question, answer };
    const pending = runStudyTutor({
      passage: passage(), mode: 'practice', signal: new AbortController().signal,
    });
    const worker = lastWorker();
    worker.emit({ type: 'result', raw: JSON.stringify(valid) });
    await expect(pending).resolves.toEqual(valid);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
