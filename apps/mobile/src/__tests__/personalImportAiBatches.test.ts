import { localLLM } from '../services/localLLMInference';
import { getMobileImportAiAvailability, runMobilePersonalImportAi, subscribeMobileImportAi } from '../services/imports/personalImportAi';
import type { PersonalImportOptions } from '@campus/shared';

jest.mock('../services/localLLMInference', () => ({ localLLM: {
  getRuntimeAvailability: jest.fn(), getState: jest.fn(), getLoadedModelId: jest.fn(),
  subscribe: jest.fn(() => jest.fn()), generate: jest.fn(), abort: jest.fn(),
  downloadModel: jest.fn(), ensureReady: jest.fn(),
} }));

const options: PersonalImportOptions = {
  kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1',
  source: { type: 'file', name: '成績表.xlsx' },
};
const entries = Array.from({ length: 60 }, (_, index) =>
  `資料庫系統設計與資料分析實務課程${index}\t3\t85`,
);
const source = `【歷年成績】\n課程名稱\t學分\t成績\n${entries.join('\n')}`;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const resultFor = (prompt: string) => {
  const text = JSON.parse(/^SOURCE_DATA=(.*)$/mu.exec(prompt)![1]) as string;
  return {
    content: JSON.stringify({ complete: true, rows: text.split('\n')
      .filter((line) => line.startsWith('資料庫系統'))
      .map((line) => ({ title: line.split('\t')[0], credits: 3, grade: '85', evidence: line })) }),
    finishReason: 'stop' as const, tokensGenerated: 100, tokensPerSecond: 10, totalTimeMs: 1000,
  };
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-3b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-3b');
  jest.mocked(localLLM.subscribe).mockReturnValue(jest.fn());
  jest.mocked(localLLM.generate).mockImplementation(async (request) => resultFor(request.messages[0].content));
});
afterEach(async () => { await flush(); jest.useRealTimers(); });

it('returns every source row once, with original file line numbers and host scope', async () => {
  expect(source.length).toBeGreaterThan(1000);
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal);
  expect(result.rows).toHaveLength(60);
  expect(result.rows.map((row) => row.title)).toEqual(entries.map((line) => line.split('\t')[0]));
  expect(result.rows.map((row) => row.source.line)).toEqual(entries.map((_, index) => index + 3));
  expect(result.rows.every((row) => row.schoolId === 'pu' && row.source.name === '成績表.xlsx')).toBe(true);
  expect(new Set(result.rows.map((row) => row.id)).size).toBe(60);
  expect(result.issues.filter((issue) => issue.code === 'ai-review-required')).toHaveLength(60);
  expect(localLLM.generate).toHaveBeenCalledTimes(8);
  const prompts = jest.mocked(localLLM.generate).mock.calls.map(([request]) => request.messages[0].content);
  const pieces = prompts.map((prompt) => JSON.parse(/^SOURCE_DATA=(.*)$/mu.exec(prompt)![1]) as string);
  expect(pieces.join('')).toBe(source);
  expect(pieces.every((piece) => piece.length <= 1000)).toBe(true);
  expect(prompts.every((prompt) => prompt.includes('COLUMN_CONTEXT_DATA='))).toBe(true);
  expect(localLLM.downloadModel).not.toHaveBeenCalled();
  expect(localLLM.ensureReady).not.toHaveBeenCalled();
});

it('exposes batch progress through the existing availability subscription', async () => {
  const titles: string[] = [];
  const unsubscribe = subscribeMobileImportAi(() => titles.push(getMobileImportAiAvailability().title));
  await runMobilePersonalImportAi(source, options, new AbortController().signal);
  await flush();
  expect(titles).toContain('正在整理第 1／8 段');
  expect(titles).toContain('正在整理第 8／8 段');
  expect(titles.at(-1)).toBe('本機 AI 已就緒');
  unsubscribe();
});

it('retains completed rows and reports only the ranges that remain truncated', async () => {
  let calls = 0;
  jest.mocked(localLLM.generate).mockImplementation(async (request) => ({
    ...resultFor(request.messages[0].content), finishReason: ++calls >= 2 ? 'length' : 'stop',
  }));
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal);
  expect(result.rows).toHaveLength(8);
  expect(result.retryBatches!.length).toBeGreaterThan(0);
  expect(localLLM.generate).toHaveBeenCalledTimes(24);
});

it('keeps completed ranges when a later batch has invalid evidence', async () => {
  let calls = 0;
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    const result = resultFor(request.messages[0].content);
    if (++calls === 2) result.content = JSON.stringify({ complete: true, rows: [
      { title: '不存在的課程', credits: 3, grade: '85', evidence: '不存在的課程 3 85' },
    ] });
    return result;
  });
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal);
  expect(result.rows.some((row) => row.title === entries[0].split('\t')[0])).toBe(true);
  expect(result.rows.some((row) => row.title === '不存在的課程')).toBe(false);
});

it('holds the native lock after cancelling a later batch and discards its late result', async () => {
  let finish!: (value: ReturnType<typeof resultFor>) => void;
  let late!: ReturnType<typeof resultFor>;
  let calls = 0;
  jest.mocked(localLLM.generate).mockImplementation((request) => {
    const result = resultFor(request.messages[0].content);
    if (++calls === 1) return Promise.resolve(result);
    late = result;
    return new Promise((resolve) => { finish = resolve; });
  });
  const controller = new AbortController();
  const running = runMobilePersonalImportAi(source, options, controller.signal);
  await flush();
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(running).rejects.toThrow('取消');
  expect(localLLM.abort).toHaveBeenCalledTimes(1);
  expect(getMobileImportAiAvailability().status).toBe('busy');
  finish(late);
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
});

it('never starts a batch after a model change invalidates the transaction', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-7b');
    return resultFor(request.messages[0].content);
  });
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal);
  expect(result.issues.some((issue) => issue.message.includes('模型已變更'))).toBe(true);
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
});

it.each(['文'.repeat(1001), ('課名\n教師\n時間\n').repeat(150)])('uses rules without cutting an indivisible paragraph', async (text) => {
  const result = await runMobilePersonalImportAi(text, options, new AbortController().signal);
  expect(result.issues.some((issue) => issue.code === 'ai-processing-mode')).toBe(true);
  expect(localLLM.generate).not.toHaveBeenCalled();
});

it.each(['\t', ','])('preserves an oversized quoted cell (%j) for rules without native work', async (delimiter) => {
  const text = ['課程名稱', '學分', '備註'].join(delimiter) + '\n' +
    ['資料庫', '3', '"' + '說明'.repeat(300) + ' ""引述\n\n跨段引述"" ' + '附註'.repeat(300) + '"'].join(delimiter);
  const result = await runMobilePersonalImportAi(text, options, new AbortController().signal);
  expect(result.issues.some((issue) => issue.code === 'ai-processing-mode')).toBe(true);
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(getMobileImportAiAvailability().status).toBe('ready');
});

it('applies the row budget to the whole transaction, not separately to each batch', async () => {
  const longer = `課程名稱\t學分\t成績\n${Array.from({ length: 510 }, (_, index) =>
    `資料庫系統設計與資料分析實務課程${index}\t3\t85`,
  ).join('\n')}`;
  const result = await runMobilePersonalImportAi(longer, options, new AbortController().signal);
  expect(result.rows.length).toBeLessThanOrEqual(500);
  expect(result.issues.some((issue) => issue.message.includes('總筆數'))).toBe(true);
});

it('returns earlier rows on timeout while retaining native ownership until completion', async () => {
  jest.useFakeTimers();
  let finish!: (value: ReturnType<typeof resultFor>) => void;
  let late!: ReturnType<typeof resultFor>;
  let calls = 0;
  jest.mocked(localLLM.generate).mockImplementation((request) => {
    const result = resultFor(request.messages[0].content);
    if (++calls === 1) return Promise.resolve(result);
    late = result;
    return new Promise((resolve) => { finish = resolve; });
  });
  const running = runMobilePersonalImportAi(source, options, new AbortController().signal);
  const completion = running;
  await flush();
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(120_000);
  const result = await completion;
  expect(result.rows.some((row) => row.title === entries[0].split('\t')[0])).toBe(true);
  expect(result.issues.some((issue) => issue.message.includes('逾時'))).toBe(true);
  expect(getMobileImportAiAvailability().status).toBe('busy');
  expect(localLLM.abort).toHaveBeenCalledTimes(1);
  finish(late);
  await flush();
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
  expect(getMobileImportAiAvailability().status).toBe('ready');
});
