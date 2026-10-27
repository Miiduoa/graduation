import { localLLM } from '../services/localLLMInference';
import {
  getMobileImportAiAvailability,
  runMobilePersonalImportAi,
  subscribeMobileImportAi,
} from '../services/imports/personalImportAi';
import { readImportDelimitedRecords } from '@campus/shared/src/imports/aiDelimitedText';
import type { PersonalImportOptions } from '@campus/shared';

jest.mock('../services/localLLMInference', () => ({ localLLM: {
  getRuntimeAvailability: jest.fn(), getState: jest.fn(), getLoadedModelId: jest.fn(),
  subscribe: jest.fn(() => jest.fn()), generate: jest.fn(), abort: jest.fn(),
  downloadModel: jest.fn(), ensureReady: jest.fn(),
} }));

const options: PersonalImportOptions = {
  kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1',
  source: { type: 'file', name: '歷年成績.csv' },
};
const sourceFor = (count: number) => '課程名稱,學分,成績\r\n' +
  Array.from({ length: count }, (_, i) => `課${i},3,85`).join('\r\n');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function resultFor(prompt: string) {
  const text = JSON.parse(/^SOURCE_DATA=(.*)$/mu.exec(prompt)![1]) as string;
  const records = readImportDelimitedRecords(text, ',')!;
  return {
    content: JSON.stringify({ complete: true, rows: records
      .filter((record) => /^課\d/u.test(record.cells[0]))
      .map((record) => ({
        title: record.cells[0], credits: 3, grade: '85',
        evidence: text.slice(record.start, record.contentEnd),
      })) }),
    finishReason: 'stop' as const, tokensGenerated: 100, tokensPerSecond: 10, totalTimeMs: 1000,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-3b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-3b');
  jest.mocked(localLLM.subscribe).mockReturnValue(jest.fn());
  jest.mocked(localLLM.generate).mockImplementation(async (request) => resultFor(request.messages[0].content));
});
afterEach(async () => { await flush(); jest.useRealTimers(); });

it('organizes a short dense CSV without losing or duplicating a source record', async () => {
  const text = sourceFor(25);
  expect(text.length).toBeLessThan(1000);
  const result = await runMobilePersonalImportAi(text, options, new AbortController().signal);
  expect(localLLM.generate).toHaveBeenCalledTimes(4);
  expect(result.rows.map((row) => row.title)).toEqual(Array.from({ length: 25 }, (_, i) => `課${i}`));
  expect(result.rows.map((row) => row.source.line)).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
  expect(result.rows.every((row) => row.credits === 3 && row.grade === '85' && row.schoolId === 'pu')).toBe(true);
  expect(result.issues.filter((issue) => issue.code === 'ai-review-required')).toHaveLength(25);
  expect(localLLM.downloadModel).not.toHaveBeenCalled();
  expect(localLLM.ensureReady).not.toHaveBeenCalled();
});

it('retries only the truncated range and never parses its partial output', async () => {
  const seen: string[] = [];
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    seen.push(request.messages[0].content);
    return seen.length === 2
      ? { ...resultFor(request.messages[0].content), content: 'invalid partial JSON', finishReason: 'length' }
      : resultFor(request.messages[0].content);
  });
  const details: string[] = [];
  const unsubscribe = subscribeMobileImportAi(() => details.push(getMobileImportAiAvailability().detail));
  const result = await runMobilePersonalImportAi(sourceFor(25), options, new AbortController().signal);
  expect(localLLM.generate).toHaveBeenCalledTimes(6);
  expect(result.rows.map((row) => row.title)).toEqual(Array.from({ length: 25 }, (_, i) => `課${i}`));
  expect(result.rows.map((row) => row.source.line)).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
  expect(new Set(result.rows.map((row) => row.id)).size).toBe(25);
  expect(details.some((detail) => detail.includes('縮小範圍') && detail.includes('第 10–13 行'))).toBe(true);
  const sources = seen.map((prompt) => JSON.parse(/^SOURCE_DATA=(.*)$/mu.exec(prompt)![1]) as string);
  expect(sources[2] + sources[3]).toBe(sources[1]);
  expect(seen.every((prompt) => prompt.includes('COLUMN_CONTEXT_DATA="課程名稱,學分,成績"'))).toBe(true);
  expect(jest.mocked(localLLM.generate).mock.calls.every(([request]) =>
    request.maxTokens === 1536 && request.temperature === 0 && request.signal === undefined)).toBe(true);
  unsubscribe();
});

it('stops at a single indivisible record and rejects the whole operation', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => ({
    ...resultFor(request.messages[0].content), finishReason: 'length',
  }));
  await expect(runMobilePersonalImportAi(sourceFor(8), options, new AbortController().signal)).rejects.toThrow('部分結果');
  expect(localLLM.generate).toHaveBeenCalledTimes(4);
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
});

it('limits automatic subdivisions across the whole operation rather than retrying forever', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    const result = resultFor(request.messages[0].content);
    const rows = JSON.parse(result.content).rows as unknown[];
    return { ...result, finishReason: rows.length > 1 ? 'length' : 'stop' };
  });
  await expect(runMobilePersonalImportAi(sourceFor(24), options, new AbortController().signal)).rejects.toThrow('部分結果');
  expect(localLLM.generate).toHaveBeenCalledTimes(17);
});

it('holds ownership when cancellation interrupts a retry, then discards late native results', async () => {
  let finish!: (result: ReturnType<typeof resultFor>) => void;
  let late!: ReturnType<typeof resultFor>;
  let count = 0;
  jest.mocked(localLLM.generate).mockImplementation((request) => {
    const result = resultFor(request.messages[0].content);
    if (++count === 1) return Promise.resolve({ ...result, finishReason: 'length' });
    late = result;
    return new Promise((resolve) => { finish = resolve; });
  });
  const controller = new AbortController();
  const running = runMobilePersonalImportAi(sourceFor(8), options, controller.signal);
  await flush();
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(running).rejects.toThrow('取消');
  expect(localLLM.abort).toHaveBeenCalledTimes(1);
  expect(getMobileImportAiAvailability().status).toBe('busy');
  await expect(runMobilePersonalImportAi(sourceFor(8), options, new AbortController().signal)).rejects.toThrow('前一次');
  finish(late);
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
});

it('times out a retry without accepting either the truncated parent or a late child', async () => {
  jest.useFakeTimers();
  let finish!: (result: ReturnType<typeof resultFor>) => void;
  let late!: ReturnType<typeof resultFor>;
  let count = 0;
  jest.mocked(localLLM.generate).mockImplementation((request) => {
    const result = resultFor(request.messages[0].content);
    if (++count === 1) return Promise.resolve({ ...result, finishReason: 'length' });
    late = result;
    return new Promise((resolve) => { finish = resolve; });
  });
  const running = runMobilePersonalImportAi(sourceFor(8), options, new AbortController().signal);
  const rejection = expect(running).rejects.toThrow('逾時');
  await flush();
  jest.advanceTimersByTime(120_000);
  await rejection;
  expect(getMobileImportAiAvailability().status).toBe('busy');
  finish(late);
  await flush();
  expect(getMobileImportAiAvailability().status).toBe('ready');
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
});

it('does not retry an invalid source citation just because the input is splittable', async () => {
  jest.mocked(localLLM.generate).mockResolvedValue({ ...resultFor('SOURCE_DATA=' + JSON.stringify(sourceFor(8))),
    content: JSON.stringify({ complete: true, rows: [{ title: '不存在', evidence: '不存在', grade: '99' }] }),
  });
  await expect(runMobilePersonalImportAi(sourceFor(8), options, new AbortController().signal)).rejects.toThrow('可核對');
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
});

it('does not start retry generation after the loaded model changes', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-7b');
    return { ...resultFor(request.messages[0].content), finishReason: 'length' };
  });
  await expect(runMobilePersonalImportAi(sourceFor(8), options, new AbortController().signal)).rejects.toThrow('可核對');
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
});
