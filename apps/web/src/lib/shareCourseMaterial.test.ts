import { afterEach, expect, it, vi } from 'vitest';
import { shareCourseMaterial } from './shareCourseMaterial';
import { materialCapabilities, materialFailureMessage, readMaterialWithDeadline } from '@campus/shared/src/materialAccess';
import { NuniError } from '@campus/shared/src/nuni';

afterEach(() => vi.unstubAllGlobals());
it('shares a stable course entry rather than a file address', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share });
  await shareCourseMaterial('講義', '/classroom/course/cw_test#material-cwm_test');
  expect(share).toHaveBeenCalledWith({ title: '講義', url: `${location.origin}/classroom/course/cw_test#material-cwm_test` });
});
it('copies the entry when system sharing is unavailable or fails', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(await shareCourseMaterial('講義', '/classroom/course/cw_test#material-cwm_test')).toContain('已複製');
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#material-cwm_test'));
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error()), clipboard: { writeText } });
  await shareCourseMaterial('講義', '/classroom/course/cw_test#material-cwm_test');
  expect(writeText).toHaveBeenCalledTimes(2);
});
it.each([
  [new NuniError(403, 'DENIED'), '沒有查看權限'],
  [new NuniError(404, 'MISSING'), '已不存在'],
  [new TypeError('network'), '連線中斷'],
  [new NuniError(500, 'FAILED'), '暫時沒有回應'],
])('explains load failures with a next step', (failure, copy) => {
  expect(materialFailureMessage(failure)).toContain(copy);
  expect(materialFailureMessage(failure)).toMatch(/首頁|重試|再試/);
});
it('shows student, teacher and archived capabilities', () => {
  const course = { id: 'cw_test', title: '合成課程', state: 'active' as const, memberRole: 'student' as const };
  expect(materialCapabilities(course)).toContain('只有老師');
  expect(materialCapabilities({ ...course, memberRole: 'co-teacher' })).toContain('可以發布');
  expect(materialCapabilities({ ...course, state: 'archived' })).toContain('不能發布');
});
it('saves a link file when clipboard access is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await shareCourseMaterial('講義', '/classroom/course/cw_test#material-cwm_test')).toContain('另存');
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
});
it('does not copy a link after the user cancels sharing', async () => {
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('取消', 'AbortError')), clipboard: { writeText } });
  expect(await shareCourseMaterial('講義', '/classroom/course/cw_test#material-cwm_test')).toBe('');
  expect(writeText).not.toHaveBeenCalled();
});

it('ends a stalled material read and clears the deadline after success', async () => {
  vi.useFakeTimers();
  try {
    const stalled = readMaterialWithDeadline(new Promise<never>(() => {}));
    const rejected = expect(stalled).rejects.toThrow('教材讀取逾時');
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(await readMaterialWithDeadline(Promise.resolve('教材'))).toBe('教材');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
