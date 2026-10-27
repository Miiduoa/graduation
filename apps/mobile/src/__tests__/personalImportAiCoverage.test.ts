import type { PersonalImportOptions } from '@campus/shared';
import { readImportDelimitedRecords } from '@campus/shared/src/imports/aiDelimitedText';
import { localLLM } from '../services/localLLMInference';
import {
  getMobileImportAiAvailability, runMobilePersonalImportAi, subscribeMobileImportAi,
} from '../services/imports/personalImportAi';

jest.mock('../services/localLLMInference', () => ({ localLLM: {
  getRuntimeAvailability: jest.fn(), getState: jest.fn(), getLoadedModelId: jest.fn(),
  subscribe: jest.fn(() => jest.fn()), generate: jest.fn(), abort: jest.fn(),
  downloadModel: jest.fn(), ensureReady: jest.fn(),
} }));
const options: PersonalImportOptions = {
  kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1',
  source: { type: 'file', name: '成績表.csv' },
};
const source = (count: number) => '課程名稱,學分,成績\n' +
  Array.from({ length: count }, (_, i) => `課程${i},2,3`).join('\n');
const sourceIn = (prompt: string) => JSON.parse(/^SOURCE_DATA=(.*)$/mu.exec(prompt)![1]) as string;
const responseFor = (prompt: string) => {
  const text = sourceIn(prompt);
  return {
    content: JSON.stringify({ complete: true, rows: readImportDelimitedRecords(text, ',')!
      .filter((record) => /^課程\d+$/u.test(record.cells[0]))
      .map((record) => ({ title: record.cells[0], credits: 2, grade: '3',
        evidence: text.slice(record.start, record.contentEnd) })) }),
    finishReason: 'stop' as const, tokensGenerated: 100, tokensPerSecond: 10, totalTimeMs: 100,
  };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-3b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-3b');
  jest.mocked(localLLM.subscribe).mockReturnValue(jest.fn());
  jest.mocked(localLLM.generate).mockImplementation(async (request) => responseFor(request.messages[0].content));
});
afterEach(flush);

it.each(['missing', 'duplicate', 'columns'] as const)(
  'repairs a later complete:true batch with %s without rerunning the successful range', async (failure) => {
    let calls = 0;
    const prompts: string[] = [];
    const details: string[] = [];
    const unsubscribe = subscribeMobileImportAi(() => details.push(getMobileImportAiAvailability().detail));
    jest.mocked(localLLM.generate).mockImplementation(async (request) => {
      const prompt = request.messages[0].content;
      prompts.push(prompt);
      const result = responseFor(prompt);
      if (++calls === 2) {
        const data = JSON.parse(result.content);
        if (failure === 'missing') data.rows.pop();
        else if (failure === 'duplicate') data.rows[data.rows.length - 1] = { ...data.rows[0] };
        else { data.rows[0].credits = 3; data.rows[0].grade = '2'; }
        result.content = JSON.stringify(data);
      }
      return result;
    });
    try {
      const result = await runMobilePersonalImportAi(source(25), options, new AbortController().signal);
      expect(result.rows).toHaveLength(25);
      expect(result.rows.map((row) => row.title)).toEqual(Array.from({ length: 25 }, (_, i) => `課程${i}`));
      expect(result.rows.map((row) => row.source.line)).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
      expect(result.rows.every((row) => row.credits === 2 && row.grade === '3')).toBe(true);
      expect(prompts).toHaveLength(6);
      expect(prompts.filter((prompt) => sourceIn(prompt).includes('課程0,'))).toHaveLength(1);
      expect(details.some((detail) => detail.includes('漏列或欄位錯配'))).toBe(true);
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'ai-table-coverage', message: expect.stringContaining('25 筆'),
      }));
      expect(result.issues.filter((issue) => issue.code === 'ai-review-required')).toHaveLength(25);
      expect(localLLM.downloadModel).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  },
);

it('rejects a still-wrong single record and releases the lock without a partial draft', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    const result = responseFor(request.messages[0].content);
    const data = JSON.parse(result.content);
    data.rows[0].credits = 3; data.rows[0].grade = '2';
    return { ...result, content: JSON.stringify(data) };
  });
  await expect(runMobilePersonalImportAi(source(2), options, new AbortController().signal)).rejects.toThrow('部分結果');
  await flush();
  expect(localLLM.generate).toHaveBeenCalledTimes(2);
  expect(getMobileImportAiAvailability().status).toBe('ready');
});

it('preserves deliberately uncertain fields and their manual correction issues', async () => {
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    const result = responseFor(request.messages[0].content);
    const data = JSON.parse(result.content);
    data.rows[0].credits = null; data.rows[0].uncertainFields = ['credits'];
    return { ...result, content: JSON.stringify(data) };
  });
  const result = await runMobilePersonalImportAi(source(1), options, new AbortController().signal);
  expect(result.rows[0].credits).toBeUndefined();
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai-uncertain-field', field: 'credits' }));
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
});

it('gives identical original records distinct source positions instead of always pointing to the first', async () => {
  const result = await runMobilePersonalImportAi('課程名稱,學分,成績\n課程0,2,3\n課程0,2,3', options, new AbortController().signal);
  expect(result.rows.map((row) => row.source.line)).toEqual([2, 3]);
});

it('shares the eight-split budget between truncation and silent omissions', async () => {
  let calls = 0;
  jest.mocked(localLLM.generate).mockImplementation(async (request) => {
    const result = responseFor(request.messages[0].content);
    const data = JSON.parse(result.content);
    calls++;
    if (data.rows.length > 1) {
      if (calls % 2 === 0) return { ...result, finishReason: 'length' as const };
      data.rows.pop();
    }
    return { ...result, content: JSON.stringify(data) };
  });
  await expect(runMobilePersonalImportAi(source(64), options, new AbortController().signal)).rejects.toThrow('部分結果');
  expect(calls).toBeLessThanOrEqual(24); // Eight initial ranges plus at most sixteen extra calls.
});

it('cancels during a coverage retry without accepting a late result or starting another range', async () => {
  let calls = 0;
  let finish!: (value: ReturnType<typeof responseFor>) => void;
  let late!: ReturnType<typeof responseFor>;
  jest.mocked(localLLM.generate).mockImplementation((request) => {
    const result = responseFor(request.messages[0].content);
    if (++calls === 1) {
      const data = JSON.parse(result.content); data.rows.pop();
      return Promise.resolve({ ...result, content: JSON.stringify(data) });
    }
    late = result;
    return new Promise((resolve) => { finish = resolve; });
  });
  const controller = new AbortController();
  const running = runMobilePersonalImportAi(source(8), options, controller.signal);
  await flush();
  controller.abort();
  await expect(running).rejects.toThrow('取消');
  expect(getMobileImportAiAvailability().status).toBe('busy');
  expect(localLLM.abort).toHaveBeenCalledTimes(1);
  finish(late);
  await flush();
  expect(calls).toBe(2);
  expect(getMobileImportAiAvailability().status).toBe('ready');
});
