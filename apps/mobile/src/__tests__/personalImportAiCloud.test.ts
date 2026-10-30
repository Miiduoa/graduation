import type { PersonalImportOptions } from '@campus/shared';
import { localLLM } from '../services/localLLMInference';
import { runMobilePersonalImportAi } from '../services/imports/personalImportAi';

jest.mock('../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(),
    getState: jest.fn(),
    getLoadedModelId: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    generate: jest.fn(),
    abort: jest.fn(),
  },
}));
const options: PersonalImportOptions = {
  kind: 'grades',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
};
const text = '資料庫，學分 3，成績 85';
const output = JSON.stringify({
  complete: true,
  rows: [{ title: '資料庫', credits: 3, grade: '85', evidence: text }],
});
const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = mockFetch;
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-3b' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-3b');
  jest.mocked(localLLM.generate).mockResolvedValue({
    content: output,
    finishReason: 'stop',
    tokensGenerated: 50,
    tokensPerSecond: 5,
    totalTimeMs: 100,
  });
});
afterEach(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  global.fetch = originalFetch;
  jest.useRealTimers();
});
const request = { platformContext: `ps_${'a'.repeat(43)}` };
const response = (status: number, body: unknown) => ({
  ok: status === 200,
  status,
  json: async () => body,
});

test('cloud succeeds with no native engine or downloaded model', async () => {
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'uninitialized' });
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue(null);
  mockFetch.mockResolvedValue(
    response(200, { output, sourceText: text.normalize('NFKC'), columnContext: '' }),
  );
  const result = await runMobilePersonalImportAi(
    text,
    options,
    new AbortController().signal,
    request,
  );
  expect(result.rows).toHaveLength(1);
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledWith(
    'https://nuni.tw/api/personal-import/recognize',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Platform ${request.platformContext}` }),
    }),
  );
  expect(result.issues.some((issue) => issue.message.includes('目前使用雲端 AI'))).toBe(true);
});

test.each([
  [429, {}, '額度'],
  [503, { code: 'disabled' }, '尚未啟用'],
  [502, {}, '暫時無法'],
  [401, {}, '登入狀態'],
] as const)(
  'cloud status %s falls back to the loaded local model',
  async (status, body, notice) => {
    mockFetch.mockResolvedValue(response(status, body));
    const result = await runMobilePersonalImportAi(
      text,
      options,
      new AbortController().signal,
      request,
    );
    expect(result.rows).toHaveLength(1);
    expect(localLLM.generate).toHaveBeenCalledTimes(1);
    expect(
      result.issues.some(
        (issue) => issue.message.includes(notice) && issue.message.includes('目前使用本機 AI'),
      ),
    ).toBe(true);
  },
);

test('cloud input masks identity fields before fetch', async () => {
  mockFetch.mockResolvedValue(response(503, { code: 'disabled' }));
  await runMobilePersonalImportAi(
    `姓名：王小明 學號：411123456\n身分證：A123456789\n${text}`,
    options,
    new AbortController().signal,
    request,
  );
  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.text).not.toMatch(/王小明|411123456|A123456789/);
});

test.each([429, 503])('status %s preserves the original teacher and evidence for both local fallbacks', async (status) => {
  const source = '課程名稱,教師,學分,成績\n資料庫,王小明,3,85';
  const evidence = '資料庫,王小明,3,85';
  mockFetch.mockResolvedValue(response(status, { code: 'disabled' }));
  jest.mocked(localLLM.generate).mockResolvedValue({
    content: JSON.stringify({ complete: true, rows: [{ title: '資料庫', teacher: '王小明', credits: 3, grade: '85', evidence }] }),
    finishReason: 'stop', tokensGenerated: 50, tokensPerSecond: 5, totalTimeMs: 100,
  });
  const local = await runMobilePersonalImportAi(source, options, new AbortController().signal, request);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).not.toContain('王小明');
  expect(localLLM.generate).toHaveBeenCalledWith(expect.objectContaining({
    messages: [expect.objectContaining({ content: expect.stringContaining(evidence) })],
  }));
  expect(local.rows[0]).toMatchObject({ teacher: '王小明', source: { rawText: evidence } });

  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  const rules = await runMobilePersonalImportAi(source, options, new AbortController().signal, request);
  expect(rules.rows[0]).toMatchObject({ teacher: '王小明', source: { rawText: evidence } });
});

test('cloud timeout falls back even if fetch never settles', async () => {
  jest.useFakeTimers();
  mockFetch.mockReturnValue(new Promise(() => {}));
  const pending = runMobilePersonalImportAi(text, options, new AbortController().signal, request);
  jest.advanceTimersByTime(25_000);
  const result = await pending;
  expect(result.rows).toHaveLength(1);
  expect(result.issues.some((issue) => issue.message.includes('雲端整理等候逾時'))).toBe(true);
});

test('unsupported native runtime uses the rule parser after cloud quota exhaustion', async () => {
  mockFetch.mockResolvedValue(response(429, {}));
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  const result = await runMobilePersonalImportAi(
    '課程名稱\t學分\t成績\n資料庫\t3\t85',
    options,
    new AbortController().signal,
    request,
  );
  expect(result.rows[0]).toMatchObject({ title: '資料庫', credits: 3, grade: '85' });
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(result.issues.some((issue) => issue.message.includes('目前使用一般規則'))).toBe(true);
});

test('small Qwen model reserves space for the prompt and caps output at 512 tokens', async () => {
  jest.mocked(localLLM.getLoadedModelId).mockReturnValue('qwen2.5-0.5b');
  const result = await runMobilePersonalImportAi(text, options, new AbortController().signal);
  expect(result.rows).toHaveLength(1);
  expect(localLLM.generate).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 512 }));
});

test('cloud isolates a malformed later segment and retries only its unfinished source range', async () => {
  const source =
    '課程名稱,學分,成績\n' + Array.from({ length: 17 }, (_, index) => `課${index},3,85`).join('\n');
  let failOne = true;
  const sent: string[] = [];
  mockFetch.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.text);
    const lines: string[] = body.text
      .trimEnd()
      .split('\n')
      .filter((line: string) => /^課\d+,/u.test(line));
    return response(200, {
      sourceText: body.text,
      columnContext: body.columnContext,
      output:
        failOne && lines.some((line) => line.startsWith('課8,'))
          ? '{"complete":true,"rows":['
          : JSON.stringify({
              complete: true,
              rows: lines.map((line) => ({
                title: line.split(',')[0],
                credits: 3,
                grade: '85',
                evidence: line,
              })),
            }),
    });
  });
  const result = await runMobilePersonalImportAi(
    source,
    options,
    new AbortController().signal,
    request,
  );
  expect(result.rows).toHaveLength(16);
  expect(result.rows.map((row) => row.title)).not.toContain('課8');
  expect(result.retryBatches).toHaveLength(1);
  expect(result.retryBatches![0].startLine).toBe(10);
  expect(sent.filter((piece) => piece.includes('課0,'))).toHaveLength(1);
  failOne = false;
  const retried = await runMobilePersonalImportAi(source, options, new AbortController().signal, {
    ...request,
    retryBatches: result.retryBatches,
  });
  expect(retried.rows).toHaveLength(1);
  expect(retried.rows[0]).toMatchObject({ title: '課8', source: { line: 10 } });
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('whole-document masking protects a vertical name before paragraph segmentation', async () => {
  mockFetch.mockResolvedValue(response(503, { code: 'disabled' }));
  await runMobilePersonalImportAi(
    `姓名\n\n王小明\n\n${text}`,
    options,
    new AbortController().signal,
    request,
  );
  expect(mockFetch).toHaveBeenCalled();
  expect(mockFetch.mock.calls.every(([, init]) => !init.body.includes('王小明'))).toBe(true);
});

test('unmasked local retry ranges cannot bypass whole-document identity masking', async () => {
  mockFetch.mockResolvedValue(response(503, { code: 'disabled' }));
  await runMobilePersonalImportAi(
    `姓名\n\n王小明\n\n${text}`,
    options,
    new AbortController().signal,
    {
      ...request,
      retryBatches: [{ text: '王小明\n\n', startLine: 3 }],
    },
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('[個資已遮罩]\n\n');
});

test('a retry range that cannot be matched to the original document stays on the device', async () => {
  await runMobilePersonalImportAi(
    `姓名\n\n王小明\n\n${text}`,
    options,
    new AbortController().signal,
    { ...request, retryBatches: [{ text: '王小明\n\n', startLine: 2, columnContext: '' }] },
  );
  expect(mockFetch).not.toHaveBeenCalled();
});

test.each([null, undefined, '[個資已遮罩]'])('cloud teacher %s is restored with original evidence for every row', async (teacher) => {
  const source = '課程名稱,教師,學分,成績\n資料庫,王小明,3,85\n微積分,林小美,2,90';
  mockFetch.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    return response(200, { sourceText: body.text, columnContext: body.columnContext, output: JSON.stringify({ complete: true, rows: [
      { title: '資料庫', teacher, credits: 3, grade: '85', evidence: '資料庫,[個資已遮罩],3,85' },
      { title: '微積分', teacher, credits: 2, grade: '90', evidence: '微積分,[個資已遮罩],2,90' },
    ] }) });
  });
  const result = await runMobilePersonalImportAi(source, options, new AbortController().signal, request);
  expect(result.rows).toMatchObject([
    { teacher: '王小明', source: { line: 2, rawText: '資料庫,王小明,3,85' } },
    { teacher: '林小美', source: { line: 3, rawText: '微積分,林小美,2,90' } },
  ]);
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('cloud teacher mask is cleared with a missing teacher warning when restoration is impossible', async () => {
  mockFetch.mockResolvedValue(response(200, { sourceText: text.normalize('NFKC'), columnContext: '', output: JSON.stringify({ complete: true, rows: [{ title: '資料庫', credits: 3, grade: '85', teacher: '[姓名已遮罩]', evidence: text }] }) }));
  const result = await runMobilePersonalImportAi(text, options, new AbortController().signal, request);
  expect(result.rows[0].teacher).toBeUndefined();
  expect(result.issues).toContainEqual(expect.objectContaining({ field: 'teacher', rowId: result.rows[0].id }));
});

test.each([';', '；', '，', '、', '/'])('keeps unreliable private tables separated by %s on the device', async (delimiter) => {
  for (const label of ['姓名', '教師']) {
    const source = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績\n王小明${delimiter}微積分${delimiter}3`;
    await runMobilePersonalImportAi(source, options, new AbortController().signal, request);
  }
  expect(mockFetch).not.toHaveBeenCalled();
});
