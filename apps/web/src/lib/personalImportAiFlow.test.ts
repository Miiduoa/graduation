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

it.each([429, 503])('keeps teacher and verbatim evidence in local and rule fallbacks for status %s', async (status) => {
  const teacherSource = '課程名稱,教師,學分,成績\n資料庫,王小明,3,85';
  const evidence = '資料庫,王小明,3,85';
  const teacherOutput = JSON.stringify({ complete: true, rows: [{ ...record, teacher: '王小明', evidence }] });
  fetcher.mockResolvedValue(new Response('{"code":"disabled"}', { status }));
  vi.mocked(runLocalPersonalImportAi).mockImplementation(async ({ input }) =>
    parsePersonalImportAiResponse(teacherOutput, input.text!, options));
  const local = await run(teacherSource);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).text).not.toContain('王小明');
  expect(runLocalPersonalImportAi).toHaveBeenCalledWith(expect.objectContaining({ input: { text: teacherSource } }));
  expect(local.rows[0]).toMatchObject({ teacher: '王小明', source: { rawText: evidence } });

  vi.mocked(localAvailability).mockReturnValue({ available: false, downloadLabel: '' });
  const rules = await run(teacherSource);
  expect(rules.rows[0]).toMatchObject({ teacher: '王小明', source: { rawText: evidence } });
  expect(rules.retry?.batches[0].text).toBe(teacherSource);
});

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
  await run('姓名：王小明\n學號：s12345678\n身分證：A123456789\n資料庫,3,85');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps an unsafe original document local even when a saved retry says cloud is safe', async () => {
  const source = '姓名,未知欄名\n王小明,另一值';
  await run(source, {
    retry: {
      batches: [{ text: '王小明,另一值', startLine: 2, columnContext: '' }],
      completed: { rows: [], issues: [] },
      cloudSafe: true,
      sourceText: source,
    },
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(runLocalPersonalImportAi).toHaveBeenCalledWith(expect.objectContaining({ input: { text: '王小明,另一值' } }));
});

it('masks a known name only in the cloud copy and retains it in the local input', async () => {
  const text = `${source}\n王小明`;
  fetcher.mockResolvedValue(new Response('{"code":"disabled"}', { status: 503 }));
  await run(text, { knownNames: ['王小明'] });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).text).not.toContain('王小明');
  expect(runLocalPersonalImportAi).toHaveBeenCalledWith(expect.objectContaining({ input: { text } }));
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

it.each(['', ' \n\t '])('uses the local visual model when OCR returns blank text: %j', async (text) => {
  const image = new File(['pixels'], '成績.png', { type: 'image/png' });
  vi.mocked(recognizePersonalImportImage).mockResolvedValue(text);
  const result = await run('', { input: { image } });
  expect(result.rows).toHaveLength(1);
  expect(runLocalPersonalImportAi).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ input: { image } }));
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not duplicate the header in rules after disabled cloud and unavailable local model', async () => {
  fetcher.mockResolvedValue(new Response('{"code":"disabled"}', { status: 503 }));
  vi.mocked(localAvailability).mockReturnValue({ available: false, downloadLabel: '' });
  const result = await run(`${source}\n微積分,2,90`);
  expect(result.rows.map((row) => row.title)).toEqual(['資料庫', '微積分']);
});

it.each(['姓名', '教師'])('keeps space separated %s tables local', async (label) => {
  await run(`${label} 課程名稱 學分 成績\n王小明 微積分 3 85`);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([null, undefined, '[個資已遮罩]'])('restores original teachers and each evidence when cloud teacher is %s', async (teacher) => {
  const original = '課程名稱,教師,學分,成績\n資料庫,王小明,3,85\n微積分,林小美,2,90';
  fetcher.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    return success(body.text, JSON.stringify({ complete: true, rows: [
      { ...record, teacher, evidence: '資料庫,[個資已遮罩],3,85' },
      { title: '微積分', teacher, credits: 2, grade: '90', evidence: '微積分,[個資已遮罩],2,90' },
    ] }), body.columnContext);
  });
  const result = await run(original);
  expect(result.rows).toMatchObject([
    { teacher: '王小明', source: { line: 2, rawText: '資料庫,王小明,3,85' } },
    { teacher: '林小美', source: { line: 3, rawText: '微積分,林小美,2,90' } },
  ]);
  expect(runLocalPersonalImportAi).not.toHaveBeenCalled();
});

it('clears a cloud teacher mask and warns when the original has no teacher', async () => {
  fetcher.mockResolvedValue(success(source, JSON.stringify({ complete: true, rows: [{ ...record, teacher: '[姓名已遮罩]' }] })));
  const result = await run();
  expect(result.rows[0].teacher).toBeUndefined();
  expect(result.issues).toContainEqual(expect.objectContaining({ field: 'teacher', rowId: result.rows[0].id }));
});

it.each([';', '；', '，', '、', '/'])('keeps unreliable private tables separated by %s local', async (delimiter) => {
  for (const label of ['姓名', '教師']) {
    await run(`${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績\n王小明${delimiter}微積分${delimiter}3`);
  }
  expect(fetcher).not.toHaveBeenCalled();
});


it.each([
  'not json',
  JSON.stringify({ complete: true, rows: [] }),
  JSON.stringify({ complete: true, rows: [{ title: '資料庫', credits: 3, grade: '85', evidence: '不存在的來源' }] }),
])(
  'invalid cloud output %s falls back to local and then rules', async (invalid) => {
    fetcher.mockResolvedValue(success(source, invalid));
    expect((await run()).rows[0]).toMatchObject({ title: '資料庫', grade: '85' });
    expect(runLocalPersonalImportAi).toHaveBeenCalledOnce();
    vi.mocked(runLocalPersonalImportAi).mockRejectedValue(new Error('invalid output'));
    expect((await run()).rows[0]).toMatchObject({ title: '資料庫', grade: '85' });
    expect(runLocalPersonalImportAi).toHaveBeenCalledTimes(2);
  },
);

it.each(['授課老師', '教授', 'instructor', '教師姓名', 'teacher_name'])(
  'request body masks names under %s', async (label) => {
    fetcher.mockResolvedValue(new Response('{"code":"disabled"}', { status: 503 }));
    await run(`課程名稱,${label},學分,成績\n資料庫,王小明,3,85`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].body).not.toContain('王小明');
  },
);

it.each(['Teacher Education', '教師 專業發展', '教師專業發展'])(
  '有教師字樣的課名保留本機原文：%s', async (title) => {
    const evidence = `${title},3,85`;
    const text = `課程名稱,學分,成績\n${evidence}`;
    const output = JSON.stringify({ complete: true, rows: [{ title, credits: 3, grade: '85', evidence }] });
    vi.mocked(runLocalPersonalImportAi).mockImplementation(async ({ input }) =>
      parsePersonalImportAiResponse(output, input.text!, options));
    const result = await run(text);
    expect(fetcher).not.toHaveBeenCalled();
    expect(runLocalPersonalImportAi).toHaveBeenCalledWith(expect.objectContaining({ input: { text } }));
    expect(result.rows[0]).toMatchObject({ title, source: { rawText: evidence } });
    vi.mocked(localAvailability).mockReturnValue({ available: false, downloadLabel: '' });
    const rules = await run(text);
    expect(fetcher).not.toHaveBeenCalled();
    expect(rules.rows[0]).toMatchObject({ title, source: { rawText: evidence } });
  },
);

for (const delimiter of [',', '\t', '|', ';', '、']) {
  for (const boundary of ['日期', '【第二頁】']) {
    for (const template of ['姓名,課程名稱,學分,成績\nBOUNDARY\n王小明,微積分,3,85',
    '課程名稱,學號,學分,成績\nBOUNDARY\n微積分,A12345,3,85']) {
      const source = template.replace('BOUNDARY', boundary).replaceAll(',', delimiter);
      it(`單格插入首次與重試均留在本機：${JSON.stringify(source)}`, async () => {
        await run(source);
        await run(source, { retry: {
          batches: [{ text: source.split('\n')[2], startLine: 3, columnContext: '' }],
          completed: { rows: [], issues: [] }, cloudSafe: true, sourceText: source,
        } });
        expect(fetcher).not.toHaveBeenCalled();
      });
    }
  }
}

// 所有資料均為合成值；覆蓋欄名碰撞、直排續行與換頁。
const privacyCases: string[] = [];
for (const delimiter of [',', '\t', '|', ';', '、']) {
  for (const label of ['姓名', '學生姓名', '學生', '名字', '學生名字', '學生學號', '學號', '学号', 'studentid', 'studentnumber', '身分證', '身分證字號', '身份證', '身份證字號', '電子郵件', '電郵', '聯絡電話', '電話', '手機', '手機號碼', 'email', 'phone', 'mobile', '教師', '授課教師', '授課老師', '老師', '教授', '教師姓名', 'teacher', 'teachername', 'instructor', 'studentname', 'name']) {
    for (const row of [`王甲乙,微積分,3,${label}`, `王甲乙,${label},學分,成績`, `王甲乙,${label},3,85`]) {
      privacyCases.push(`姓名,課程名稱,學分,成績\n${row}`.replaceAll(',', delimiter));
    }
    privacyCases.push(`課程名稱,學號,學分,成績\n微積分,A12345,3,${label}`.replaceAll(',', delimiter));
  }
}
privacyCases.push('姓名\n王甲乙\n王丙丁,學分,成績\nB54321\n課程名稱,學分,成績\n微積分,3,85');
for (const boundary of ['日期', '【第二頁】', '課程名稱', '學分', '成績', '教室', 'date']) {
  for (const [label, first, second] of [['姓名', '王甲乙', '王丙丁'], ['學號', 'A12345', 'B54321']]) {
    for (const head of [`${label}\n${first}`, `${label}:${first}`]) {
      privacyCases.push(`${head}\n${boundary}\n${second}\n課程名稱,學分,成績\n微積分,3,85`);
    }
  }
}

it.each(privacyCases)('首次及重試均不得外送私密續行：%s', async (text) => {
  fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
  await run(text);
  await run(text, { retry: {
    batches: [{ text: text.split('\n').slice(1).join('\n'), startLine: 2, columnContext: text.split('\n')[0] }],
    completed: { rows: [], issues: [] }, cloudSafe: true, sourceText: text,
  } });
  expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/王甲乙|王丙丁|A12345|B54321/u);
});
