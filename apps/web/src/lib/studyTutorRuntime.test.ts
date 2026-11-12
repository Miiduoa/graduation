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
    { label: 'a short Chinese answer in parentheses', question: '哪個欄位？（參考回答：學號）', answer: '學號' },
    { label: 'an English answer key', question: '哪個指令？ 標準答案: SQL。', answer: 'SQL' },
    { label: 'a numeric answer after an answer label', question: '計算結果？答案：1.2', answer: '1.2' },
    { label: 'a quoted answer with spaces', question: '哪種欄位？解答：「外鍵 連接」', answer: '外鍵連接' },
    { label: 'an answer described with 是', question: '教材的解答是：資料表', answer: '資料表' },
    { label: 'a key described with 為', question: '這題正解為「主鍵」', answer: '主鍵' },
    { label: 'a plain English key', question: 'Expected answer: SQL', answer: 'SQL' },
    { label: 'an equal-sign answer key', question: '結果為何？答案＝1.2', answer: '1.2' },
    { label: 'a numerical answer without punctuation', question: '複習：答案為 2', answer: '2' },
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
    { question: '主鍵用來識別什麼？', answer: '每一筆紀錄。' },
    { question: '題目出現「答案：」欄位時應如何核對？', answer: '先核對教材原文' },
    { question: '(a+b)？', answer: 'a+b' },
    { question: '答案是什麼？', answer: '主鍵' },
    { question: '答案：12 是否可行？', answer: '1' },
    { question: '答案：1.23 是否合理？', answer: '1.2' },
    { question: '答案：SQL 和 NoSQL 有何不同？', answer: '外鍵' },
    { question: 'Answer: SQL 這個提示代表什麼？', answer: '主鍵' },
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
