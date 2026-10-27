import type { PersonalImportOptions } from '@campus/shared';
import { localLLM } from '../services/localLLMInference';
import {
  getMobileImportAiAvailability,
  MOBILE_IMPORT_AI_MAX_CHARACTERS,
  runMobilePersonalImportAi,
  subscribeMobileImportAi,
} from '../services/imports/personalImportAi';

jest.mock('../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(),
    getState: jest.fn(),
    getLoadedModelId: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    generate: jest.fn(),
    abort: jest.fn(),
    downloadModel: jest.fn(),
    ensureReady: jest.fn(),
  },
}));

const source = '資料庫，學分 3，成績 85';
const options: PersonalImportOptions = {
  kind: 'grades',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  source: { type: 'screenshot', name: '成績.png' },
};
const response = (overrides: Record<string, unknown> = {}) => ({
  content: JSON.stringify({
    complete: true,
    rows: [{ title: '資料庫', credits: 3, grade: '85', evidence: source, ...overrides }],
  }),
  tokensGenerated: 120,
  tokensPerSecond: 10,
  finishReason: 'stop' as const,
  totalTimeMs: 1200,
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-3b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-3b');
  jest.mocked(localLLM.generate).mockResolvedValue(response());
});

afterEach(async () => {
  await flush();
  jest.useRealTimers();
});

test('runs only an already-loaded model and returns source-backed drafts in the host scope', async () => {
  jest
    .mocked(localLLM.generate)
    .mockResolvedValue(response({ schoolId: 'other', linkedCourseId: 'foreign' }));
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    title: '資料庫',
    credits: 3,
    grade: '85',
    schoolId: 'pu',
    source: { rawText: source, type: 'screenshot' },
  });
  expect(result.rows[0].linkedCourseId).toBeUndefined();
  expect(result.issues.some((issue) => issue.code === 'ai-review-required')).toBe(true);
  expect(localLLM.generate).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0, maxTokens: 1536 }),
  );
  expect(jest.mocked(localLLM.generate).mock.calls[0][0].signal).toBeUndefined();
  expect(localLLM.downloadModel).not.toHaveBeenCalled();
  expect(localLLM.ensureReady).not.toHaveBeenCalled();
});

test.each(['uninitialized', 'loading', 'downloading', 'generating', 'error'] as const)(
  'does not load, download, or generate when the runtime is %s',
  async (status) => {
    jest.mocked(localLLM.getState).mockReturnValue({ status });
    await expect(
      runMobilePersonalImportAi(source, options, new AbortController().signal),
    ).rejects.toThrow();
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(localLLM.ensureReady).not.toHaveBeenCalled();
  },
);

test('unsupported native builds and incompatible loaded prompt templates stay unavailable', async () => {
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  expect(getMobileImportAiAvailability().status).toBe('unavailable');
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'mistral-7b-v0.3' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('mistral-7b-v0.3');
  expect(getMobileImportAiAvailability().title).toContain('Qwen2.5');
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('Qwen2.5');
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('a changed model preference cannot authorize a different context still in memory', async () => {
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-7b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('phi-3.5-mini');
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('Qwen2.5');
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('a replaced native context invalidates the result instead of labelling it as the requested model', async () => {
  let finish!: (result: ReturnType<typeof response>) => void;
  jest.mocked(localLLM.generate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = runMobilePersonalImportAi(source, options, new AbortController().signal);
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-7b');
  finish(response());
  await expect(result).rejects.toThrow('AI 未能整理出可核對的資料');
});

test('caller mutations cannot reassign a pending result to another school, term, or source', async () => {
  let finish!: (result: ReturnType<typeof response>) => void;
  jest.mocked(localLLM.generate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const mutableOptions = { ...options, source: { ...options.source! } };
  const result = runMobilePersonalImportAi(source, mutableOptions, new AbortController().signal);
  mutableOptions.schoolId = 'other-school';
  mutableOptions.academicYear = '116';
  mutableOptions.source.name = 'other-file';
  finish(response());
  const parsed = await result;
  expect(parsed.rows[0]).toMatchObject({
    schoolId: 'pu',
    academicYear: '115',
    source: { name: '成績.png' },
  });
});

test('rejects an oversize source before inference instead of silently cutting off rows', async () => {
  await expect(
    runMobilePersonalImportAi(
      '文'.repeat(MOBILE_IMPORT_AI_MAX_CHARACTERS + 1),
      options,
      new AbortController().signal,
    ),
  ).rejects.toThrow('分批');
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('rejects truncated generation even when the JSON prefix looks complete', async () => {
  jest.mocked(localLLM.generate).mockResolvedValue({ ...response(), finishReason: 'length' });
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('部分結果');
});

test('invented evidence never becomes an editable import result', async () => {
  jest.mocked(localLLM.generate).mockResolvedValue(response({ evidence: '不存在的課程 99 分' }));
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('可核對');
});

test('cancellation rejects promptly but holds exclusivity until late native work settles', async () => {
  let finish!: (result: ReturnType<typeof response>) => void;
  jest.mocked(localLLM.generate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const listener = jest.fn();
  const unsubscribe = subscribeMobileImportAi(listener);
  const controller = new AbortController();
  const result = runMobilePersonalImportAi(source, options, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow('取消');
  expect(localLLM.abort).toHaveBeenCalledTimes(1);
  expect(getMobileImportAiAvailability().status).toBe('busy');
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('前一次');
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
  finish(response());
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  const abortCount = jest.mocked(localLLM.abort).mock.calls.length;
  controller.abort();
  expect(localLLM.abort).toHaveBeenCalledTimes(abortCount);
});

test('an already-aborted request never reaches the native model', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(runMobilePersonalImportAi(source, options, controller.signal)).rejects.toThrow(
    '取消',
  );
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(localLLM.abort).not.toHaveBeenCalled();
});

test('cancellation during readiness evaluation is rechecked before native inference', async () => {
  const controller = new AbortController();
  jest.mocked(localLLM.getRuntimeAvailability).mockImplementation(() => {
    controller.abort();
    return { available: true };
  });
  await expect(runMobilePersonalImportAi(source, options, controller.signal)).rejects.toThrow(
    '取消',
  );
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(localLLM.abort).not.toHaveBeenCalled();
});

test('a timeout never accepts a late result or claims that native execution has stopped', async () => {
  jest.useFakeTimers();
  let finish!: (result: ReturnType<typeof response>) => void;
  jest.mocked(localLLM.generate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = runMobilePersonalImportAi(source, options, new AbortController().signal);
  const rejection = expect(result).rejects.toThrow('逾時');
  jest.advanceTimersByTime(120_000);
  await rejection;
  expect(getMobileImportAiAvailability().status).toBe('busy');
  finish(response());
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
});

test('native exception text containing source data is not displayed', async () => {
  jest.mocked(localLLM.generate).mockRejectedValue(new Error('private-source: ' + source));
  await expect(
    runMobilePersonalImportAi(source, options, new AbortController().signal),
  ).rejects.toThrow('AI 未能整理出可核對的資料');
});
