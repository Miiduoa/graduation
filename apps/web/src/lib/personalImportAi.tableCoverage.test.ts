import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPersonalImportAi } from './personalImportAi';

class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  id = 0;
  terminate = vi.fn();
  constructor() { FakeWorker.current = this; }
  postMessage(message: { id: number }) { this.id = message.id; }
  result(rows: unknown[]) {
    this.onmessage?.({ data: { type: 'result', id: this.id, raw: JSON.stringify({ complete: true, rows }) } } as MessageEvent);
  }
}
const options = { kind: 'grades' as const, schoolId: 'pu', academicYear: '115', semester: '1' };
const text = '課程名稱,學分,成績\n資料庫,2,3\n統計學,3,85';
const first = { title: '資料庫', credits: 2, grade: '3', evidence: '資料庫,2,3' };
const second = { title: '統計學', credits: 3, grade: '85', evidence: '統計學,3,85' };
const start = (source = text) => runPersonalImportAi({
  input: { text: source }, options, signal: new AbortController().signal, onProgress: vi.fn(),
});
beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { gpu: {} });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['missing', 'duplicate', 'columns'])('rejects a syntactically complete %s response and permits a clean retry', async (failure) => {
  const running = start();
  const failedWorker = FakeWorker.current;
  failedWorker.result(failure === 'missing' ? [first] : failure === 'duplicate' ? [first, first]
    : [{ ...first, credits: 3, grade: '2' }, second]);
  await expect(running).rejects.toThrow('部分結果');
  expect(failedWorker.terminate).toHaveBeenCalled();
  const retry = start();
  FakeWorker.current.result([first, second]);
  const result = await retry;
  expect(result.rows.map((row) => row.source.line)).toEqual([2, 3]);
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai-table-coverage' }));
});

it('keeps duplicate original records and fixes their evidence positions', async () => {
  const running = start('課程名稱,學分,成績\n資料庫,2,3\n資料庫,2,3');
  FakeWorker.current.result([first, first]);
  expect((await running).rows.map((row) => row.source.line)).toEqual([2, 3]);
});

it('never treats an image model transcription or attached OCR as independent table evidence', async () => {
  const image = new File(['image'], '課表.png', { type: 'image/png' });
  const running = runPersonalImportAi({
    input: { image, text }, options, signal: new AbortController().signal, onProgress: vi.fn(),
  });
  FakeWorker.current.result([first]);
  const result = await running;
  expect(result.rows[0].source.type).toBe('screenshot');
  expect(result.issues.some((issue) => issue.code === 'ai-table-coverage')).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'ai-review-required')).toBe(true);
});

it('does not claim coverage for unstructured prose', async () => {
  const running = start('資料庫 學分2 成績3');
  FakeWorker.current.result([{ ...first, evidence: '資料庫 學分2 成績3' }]);
  expect((await running).issues.some((issue) => issue.code === 'ai-table-coverage')).toBe(false);
});
