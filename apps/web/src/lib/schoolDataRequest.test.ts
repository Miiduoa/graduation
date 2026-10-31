import { afterEach, expect, it, vi } from 'vitest';
import { withSchoolDataDeadline } from './schoolDataRequest';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('已取消的讀取不執行來源，也不建立計時器', async () => {
  vi.useFakeTimers();
  const owner = new AbortController(); owner.abort();
  const read = vi.fn();
  await expect(withSchoolDataDeadline(read, owner.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('成功後清除期限與外部取消監聽', async () => {
  vi.useFakeTimers();
  const owner = new AbortController(); const remove = vi.spyOn(owner.signal, 'removeEventListener');
  let signal!: AbortSignal;
  await expect(withSchoolDataDeadline(async (value) => { signal = value; return 7; }, owner.signal)).resolves.toBe(7);
  expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  owner.abort(); expect(signal.aborted).toBe(false);
});
it('同步錯誤仍清理期限及監聽', async () => {
  vi.useFakeTimers();
  const owner = new AbortController(); const remove = vi.spyOn(owner.signal, 'removeEventListener');
  await expect(withSchoolDataDeadline(() => { throw new Error('read failed'); }, owner.signal)).rejects.toThrow('read failed');
  expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledTimes(1);
});
it('來源忽略 signal 時取消仍立即結束等待', async () => {
  vi.useFakeTimers();
  const owner = new AbortController(); const source = deferred<number>(); let signal!: AbortSignal;
  const pending = withSchoolDataDeadline((value) => { signal = value; return source.promise; }, owner.signal);
  const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); owner.abort(); await result;
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  source.resolve(9); await Promise.resolve();
});
it('開始前立即取消不呼叫來源', async () => {
  const owner = new AbortController(); const read = vi.fn(async () => 1);
  const pending = withSchoolDataDeadline(read, owner.signal); owner.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(read).not.toHaveBeenCalled();
});
it('取消時不轉傳呼叫端提供的任意原因', async () => {
  const owner = new AbortController();
  const pending = withSchoolDataDeadline(() => new Promise<never>(() => {}), owner.signal);
  owner.abort(new Error('private provider detail'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: '校務資料讀取已取消。' });
});
it('45 秒期限包含整次讀取且會中止傳輸', async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  const pending = withSchoolDataDeadline((value) => { signal = value; return new Promise<never>(() => {}); });
  const result = expect(pending).rejects.toThrow('校務資料讀取逾時。');
  await vi.advanceTimersByTimeAsync(44_999); expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await result;
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('逾時原因不被傳輸的同步 AbortError 蓋掉', async () => {
  vi.useFakeTimers();
  const pending = withSchoolDataDeadline((signal) => new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('transport aborted', 'AbortError')), { once: true });
  }));
  const result = expect(pending).rejects.toThrow('校務資料讀取逾時。');
  await vi.advanceTimersByTimeAsync(45_000); await result;
});
it('取消後的晚到拒絕仍有接收者，不成為未處理錯誤', async () => {
  const owner = new AbortController(); const source = deferred<number>();
  const pending = withSchoolDataDeadline(() => source.promise, owner.signal);
  await Promise.resolve(); owner.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  source.reject(new Error('late failure')); await Promise.resolve(); await Promise.resolve();
});
it('取消其中一個來源不影響另一個來源', async () => {
  const first = new AbortController(); const second = deferred<number>();
  const one = withSchoolDataDeadline(() => new Promise<never>(() => {}), first.signal);
  const two = withSchoolDataDeadline(() => second.promise);
  first.abort(); await expect(one).rejects.toMatchObject({ name: 'AbortError' });
  second.resolve(2); await expect(two).resolves.toBe(2);
});
it('讀取結束前取消，即使來源已完成也不採用該結果', async () => {
  const owner = new AbortController();
  const pending = withSchoolDataDeadline(async () => { owner.abort(); return 3; }, owner.signal);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
it('未傳取消訊號的既有呼叫仍回傳原始結果', async () => {
  const value = { courses: [] };
  await expect(withSchoolDataDeadline(async () => value)).resolves.toBe(value);
});
