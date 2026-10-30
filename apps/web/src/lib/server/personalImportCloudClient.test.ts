// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPersonalImportCloudMaskSafe, maskPersonalImportCloudBatch, maskPersonalImportCloudInput, maskPersonalImportText, requestPersonalImportCloud } from '@campus/shared/src/imports/aiCloud';
import { planResilientPersonalImportBatches, splitPersonalImportAiTextBatch } from '@campus/shared/src/imports/aiTextBatches';

afterEach(() => vi.useRealTimers());

describe('personal import cloud client', () => {
  it.each([
    ['姓名：\n王小明', '王小明'],
    ['教師：\n林小美', '林小美'],
    ['姓名：\r\n\r\n王小明', '王小明'],
    ['電子郵件：student.name+school@example.edu.tw', 'student.name+school@example.edu.tw'],
    ['0912-345-678', '0912-345-678'],
    ['02-2345-6789', '02-2345-6789'],
    ['+886-912-345-678', '+886-912-345-678'],
    ['電話：(02) 2345-6789\n微積分 3 85', '(02) 2345-6789'],
    ['電話：+1-202-555-0191', '+1-202-555-0191'],
    ['電子郵件：王小明@example.com', '王小明@example.com'],
    ['(02) 2345-6789', '(02) 2345-6789'],
    ['王小明@example.com', '王小明@example.com'],
  ])('masks OCR identity and contact formats before sending: %s', async (text, privateValue) => {
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.text).not.toContain(privateValue);
      return Response.json({ output: '{}', sourceText: body.text, columnContext: body.columnContext });
    });
    expect(isPersonalImportCloudMaskSafe(text)).toBe(true);
    expect(maskPersonalImportText(maskPersonalImportText(text))).toBe(maskPersonalImportText(text));
    expect(await requestPersonalImportCloud({ text, kind: 'grades', fetcher: fetcher as typeof fetch })).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['姓名：\n王小明,林小美', '教師：\n王小明\t林小美', '姓名：\n課程名稱,學分,成績', '教師：王小明,林小美'])('keeps ambiguous personal field boundaries on the device: %s', async (text) => {
    const fetcher = vi.fn();
    expect(isPersonalImportCloudMaskSafe(text)).toBe(false);
    expect(await requestPersonalImportCloud({ text, kind: 'grades', fetcher })).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('masks a tab-delimited labeled value without hiding the following academic field', () => {
    const source = '教師：王小明\t學分：3\t成績：85';
    expect(isPersonalImportCloudMaskSafe(source)).toBe(true);
    expect(maskPersonalImportText(source)).toBe('教師:[姓名已遮罩]\t學分:3\t成績:85');
  });

  it('derives cloud batches from the complete masked document while keeping the original scope', () => {
    const source = '姓名：\n\n王小明\n\n課程名稱,學分,成績\n資料庫,3,85';
    const batch = { text: '王小明\n\n', startLine: 3, columnContext: '' };
    expect(maskPersonalImportCloudBatch(source, batch)).toEqual({ sourceText: '[個資已遮罩]\n\n', columnContext: '' });
    expect(batch.text).toBe('王小明\n\n');
    expect(maskPersonalImportCloudBatch(source, { ...batch, startLine: 2 })).toBeNull();
    expect(maskPersonalImportCloudBatch(source, { ...batch, text: '王小' })).toBeNull();
  });

  it.each(['姓名', '姓名：'])('preserves course records after the vertical label %s', (label) => {
    const source = `${label}\n王小明\n微積分 3 85\n英文，學分 2，成績 80\n課程名稱,教師,學分,成績\n資料庫,林小美,3,90`;
    const masked = maskPersonalImportText(source);
    expect(isPersonalImportCloudMaskSafe(source)).toBe(true);
    expect(masked).not.toMatch(/王小明|林小美/);
    expect(masked).toContain('微積分 3 85');
    expect(masked).toContain('英文,學分 2,成績 80');
    expect(masked).toContain('資料庫,[個資已遮罩],3,90');
    expect(maskPersonalImportText(masked)).toBe(masked);
  });

  it('keeps raw split records and source lines while masking multiline private cells in every cloud slice', () => {
    const source = '課程名稱,教師,學分,成績\n' + Array.from({ length: 9 }, (_, index) => `課程${index},"王\n小明",3,85`).join('\n');
    const planned = planResilientPersonalImportBatches(source, { maxBatchCharacters: 1000, maxTotalCharacters: 40000, maxBatches: 80 });
    const split = splitPersonalImportAiTextBatch(planned.batches[0])!;
    const slices = [...split, ...planned.batches.slice(1)];
    expect(slices.map((batch) => batch.text).join('')).toBe(source);
    for (const batch of slices) {
      const masked = maskPersonalImportCloudBatch(source, batch)!;
      expect(masked).not.toBeNull();
      expect(masked.sourceText).not.toMatch(/王|小明/);
      expect(masked.sourceText.split('\n')).toHaveLength(batch.text.split('\n').length);
      expect(masked.columnContext).toBe('課程名稱,教師,學分,成績');
    }
    expect(slices.map((batch) => maskPersonalImportCloudBatch(source, batch)!.sourceText).join('')).toBe(maskPersonalImportText(source));
  });

  it('masks labels, known names, fullwidth IDs, student numbers and name columns without losing grades', () => {
    const source = '姓名：王小明 學號：411234567\n身份證：Ａ１２３４５６７８９\n陳小華\n課程名稱\t姓名\t學號\t學分\t成績\n微積分\t林小美\t412345678\t3\t85';
    const masked = maskPersonalImportText(source, ['陳小華']);
    for (const sensitive of ['王小明', '411234567', 'A123456789', '陳小華', '林小美', '412345678']) expect(masked).not.toContain(sensitive);
    expect(masked).toContain('微積分');
    expect(masked).toContain('\t3\t85');
    expect(maskPersonalImportText(masked)).toBe(masked);
  });

  it('uses column context to mask a segment whose header belongs to the previous segment', () => {
    expect(maskPersonalImportCloudInput('王小明\t微積分\t3\t85', '姓名\t課程名稱\t學分\t成績')).toEqual({
      sourceText: '[個資已遮罩]\t微積分\t3\t85', columnContext: '姓名\t課程名稱\t學分\t成績',
    });
  });

  it.each([
    '課程名稱,姓名,學分\n"程式,設計",王小明,3',
    '課程名稱,姓名,學分\n"程式\n設計",王小明,3',
    '課程名稱\t姓名\t學分\n"程式\n設計"\t王小明\t3',
    '課程名稱|姓名|學分\n"程式|設計"|王小明|3',
  ])('masks logical table cells despite quoted separators or newlines: %s', (source) => {
    const masked = maskPersonalImportText(source);
    expect(masked).not.toContain('王小明');
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    expect(maskPersonalImportText(masked)).toBe(masked);
    expect(isPersonalImportCloudMaskSafe(masked)).toBe(true);
  });

  it('masks a key/value name and resets private columns at a new academic table header', () => {
    const source = '姓名\t王小明\n課程名稱\t學分\t成績\n微積分\t3\t85\n課程名稱\t姓名\t學分\n英文\t林小美\t2\n課程名稱\t學分\t成績\n體育\t0\t90';
    const masked = maskPersonalImportText(source);
    expect(masked).not.toContain('王小明');
    expect(masked).not.toContain('林小美');
    expect(masked).toContain('微積分\t3\t85');
    expect(masked).toContain('體育\t0\t90');
  });

  it.each([
    '姓名\t王小明\t班級\t資工一\n課程名稱\t學分\n資料庫\t3',
    '姓名\n王小明\n課程名稱\n微積分',
    '課程名稱,姓名,學分\n\n程式設計,王小明,3',
  ])('masks mixed metadata and vertical OCR names: %s', async (text) => {
    const masked = maskPersonalImportText(text);
    expect(masked).not.toContain('王小明');
    expect(isPersonalImportCloudMaskSafe(masked)).toBe(true);
    expect(masked).toContain(text.includes('微積分') ? '微積分' : text.includes('資料庫') ? '資料庫' : '程式設計');
    expect(masked.split('\n')).toHaveLength(text.split('\n').length);
  });

  it('does not guess whether an unknown second cell is a header or a personal value', async () => {
    const text = '姓名,未知欄名\n王小明,另一值';
    const fetcher = vi.fn();
    expect(await requestPersonalImportCloud({ text, kind: 'grades', fetcher })).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('masks teacher names in metadata and columns while retaining labels and course values', () => {
    const source = '教師：王小明 學分：3 成績：85\n課程名稱,授課教師,學分,成績\n微積分,林小美,3,85\ncourse,teacher,credits,grade\nEnglish,John Doe,2,A';
    const masked = maskPersonalImportText(source);
    for (const value of ['王小明', '林小美', 'John Doe']) expect(masked).not.toContain(value);
    expect(masked).toContain('教師:');
    expect(masked).toContain('學分:3 成績:85');
    expect(masked).toContain('課程名稱,授課教師,學分,成績');
    expect(masked).toContain('微積分,[個資已遮罩],3,85');
    expect(masked).toContain('English,[個資已遮罩],2,A');
  });

  it.each(['課程名稱,姓名,學分\n"未關閉的課名,王小明,3', '課程名稱,姓名,學分\n程式,設計,王小明,3'])('keeps ambiguously structured private columns off the network', async (text) => {
    const fetcher = vi.fn();
    const masked = maskPersonalImportText(text);
    expect(isPersonalImportCloudMaskSafe(masked)).toBe(false);
    expect(await requestPersonalImportCloud({ text: masked, kind: 'grades', fetcher })).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends only masked text and returns cloud output with its exact masked source', async () => {
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      expect(input.text).not.toContain('王小明');
      expect(init.headers).toMatchObject({ 'X-Campus-Session': 'view-context' });
      return Response.json({ output: '{"complete":true,"rows":[]}', sourceText: input.text, columnContext: input.columnContext });
    });
    const result = await requestPersonalImportCloud({ text: '姓名：王小明\n微積分 3 85', kind: 'grades', headers: { 'X-Campus-Session': 'view-context' }, fetcher: fetcher as typeof fetch });
    expect(result).toMatchObject({ ok: true, sourceText: '姓名:[姓名已遮罩]\n微積分 3 85' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([[429, {}, 'quota'], [503, { code: 'disabled' }, 'disabled'], [503, {}, 'unavailable'], [401, {}, 'unauthenticated'], [504, {}, 'timeout']] as const)('returns an explicit fallback for status %s', async (status, body, reason) => {
    const result = await requestPersonalImportCloud({ text: '微積分 3 85', kind: 'grades', fetcher: vi.fn().mockResolvedValue(Response.json(body, { status })) });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('bounds a fetch that never settles and aborts the pending request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const promise = requestPersonalImportCloud({ text: '微積分 3 85', kind: 'grades', timeoutMs: 100, fetcher: vi.fn((_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); }) });
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toMatchObject({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('bounds a response body that never settles', async () => {
    vi.useFakeTimers();
    const promise = requestPersonalImportCloud({ text: '微積分 3 85', kind: 'grades', timeoutMs: 100, fetcher: vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }) });
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('rejects explicit cancellation instead of starting local work', async () => {
    const controller = new AbortController();
    const promise = requestPersonalImportCloud({ text: '微積分 3 85', kind: 'grades', signal: controller.signal, fetcher: vi.fn(() => new Promise<Response>(() => {})) });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not accept an altered source as evidence', async () => {
    const result = await requestPersonalImportCloud({ text: '微積分 3 85', kind: 'grades', fetcher: vi.fn().mockResolvedValue(Response.json({ output: '{}', sourceText: '另一個來源' })) });
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});

it.each(['姓名', '教師'])('refuses space separated %s headers with or without column context', async (label) => {
  const header = `${label} 課程名稱 學分 成績`;
  const text = '王小明 微積分 3 85';
  const fetcher = vi.fn();
  expect(isPersonalImportCloudMaskSafe(`${header}\n${text}`)).toBe(false);
  expect(await requestPersonalImportCloud({ text, columnContext: header, kind: 'grades', fetcher })).toMatchObject({ ok: false, reason: 'invalid-input' });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['姓名 未知欄名\n王小明 另一值', '姓名 教師\n王小明 林小美'])(
  'refuses uncertain space separated private headers: %s', async (text) => {
    const fetcher = vi.fn();
    expect(isPersonalImportCloudMaskSafe(text)).toBe(false);
    expect(await requestPersonalImportCloud({ text, kind: 'grades', fetcher })).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
