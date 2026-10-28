import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAcademicRecords } from './useAcademicRecords';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from './academicClient';
import { ACADEMIC_REFRESH_INTERVAL_MS as INTERVAL } from './academicRefreshController';

const account = vi.hoisted(() => ({ user: { uid: 'a' } as { uid: string } | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('./academicClient', async (original) => ({
  ...await original<typeof import('./academicClient')>(), loadAcademicRecords: vi.fn(),
}));
function snapshot(uid = 'a', time = '2026-10-28T00:00:00Z'): AcademicSnapshot<'grades'> {
  return { ownerUid: uid, schoolId: 'pu', fetchedAt: time,
    records: { grades: [], semesters: [], allSemesters: [], summary: {} } };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); }); }
const signal = () => vi.mocked(loadAcademicRecords).mock.calls.at(-1)?.[3]?.signal;
beforeEach(() => {
  account.user = { uid: 'a' }; account.loading = false;
  vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(snapshot());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('retains the original snapshot and timestamp through repeated transient failures and retry', async () => {
  const view = renderHook(() => useAcademicRecords('grades')); await flush();
  const original = view.result.current.state?.snapshot;
  for (let i = 0; i < 2; i++) {
    vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
    await act(async () => { await view.result.current.refresh(); });
    expect(view.result.current.state).toMatchObject({ status: 'error', stale: true, reason: 'unavailable' });
    expect(view.result.current.state?.snapshot).toBe(original);
  }
  const pending = deferred<AcademicSnapshot<'grades'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  act(() => { void view.result.current.refresh(); void view.result.current.refresh(); }); await flush();
  expect(view.result.current.state).toMatchObject({ status: 'ready', refreshing: true, stale: true });
  expect(view.result.current.state?.snapshot).toBe(original);
  expect(loadAcademicRecords).toHaveBeenCalledTimes(4);
  await act(async () => { pending.resolve(snapshot('a', '2026-10-28T00:10:00Z')); });
  expect(view.result.current.state?.status).toBe('ready');
  expect(view.result.current.state?.stale).not.toBe(true);
  expect(view.result.current.state?.snapshot?.fetchedAt).toBe('2026-10-28T00:10:00Z');
});

it.each(['reconnect', 'permission', 'unconfigured'] as const)('clears retained records for %s and cannot resurrect them on a later network failure', async (reason) => {
  const view = renderHook(() => useAcademicRecords('grades')); await flush();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError(reason));
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.state?.snapshot).toBeUndefined();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.state?.snapshot).toBeUndefined();
  expect(view.result.current.state?.stale).toBe(false);
});

it.each(['owner', 'school', 'unknown-error', 'invalid-response'] as const)('does not retain private data after %s', async (kind) => {
  const view = renderHook(() => useAcademicRecords('grades')); await flush();
  if (kind === 'owner') vi.mocked(loadAcademicRecords).mockResolvedValueOnce(snapshot('other'));
  else if (kind === 'school') vi.mocked(loadAcademicRecords).mockResolvedValueOnce({ ...snapshot(), schoolId: 'nthu' } as unknown as AcademicSnapshot<'grades'>);
  else if (kind === 'invalid-response') {
    const error = new AcademicConnectionError('unavailable');
    Object.defineProperty(error, 'canRetainSnapshot', { value: false });
    vi.mocked(loadAcademicRecords).mockRejectedValueOnce(error);
  } else vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new Error('Unexpected parser failure'));
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.state?.status).toBe('error');
  expect(view.result.current.state?.snapshot).toBeUndefined();
});

it('does not invent a previous snapshot when the first request fails', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  const view = renderHook(() => useAcademicRecords('grades')); await flush();
  expect(view.result.current.state?.snapshot).toBeUndefined();
  expect(view.result.current.state?.stale).toBe(false);
});

it('aborts an unfinished read on unmount and tolerates a late rejection', async () => {
  const pending = deferred<AcademicSnapshot<'grades'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const view = renderHook(() => useAcademicRecords('grades')); await flush(); const active = signal();
  expect(active?.aborted).toBe(false); view.unmount(); expect(active?.aborted).toBe(true);
  await act(async () => { pending.reject(new Error('late transport failure')); });
});

it.each(['account', 'school', 'disabled', 'verification'] as const)('aborts and hides a pending read when %s changes', async (change) => {
  const pending = deferred<AcademicSnapshot<'grades'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const view = renderHook(({ school, enabled }) => useAcademicRecords('grades', enabled, school), { initialProps: { school: 'pu', enabled: true } });
  await flush(); const active = signal();
  if (change === 'account') account.user = { uid: 'b' };
  if (change === 'verification') account.loading = true;
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot('b'));
  view.rerender({ school: change === 'school' ? 'nthu' : 'pu', enabled: change !== 'disabled' });
  expect(active?.aborted).toBe(true);
  // A→B 可立即顯示 B 的載入狀態；不得顯示 A 的私有快照。
  expect(view.result.current.state?.snapshot?.ownerUid).not.toBe('a');
  if (change === 'account') {
    if (view.result.current.state) expect(view.result.current.state.scope).toBe(JSON.stringify(['b', 'grades', true, 'pu']));
  } else {
    expect(view.result.current.state).toBeNull();
  }
  await flush();
  if (change === 'account') {
    expect(view.result.current.state).toMatchObject({ status: 'ready', snapshot: { ownerUid: 'b' } });
  }
  await act(async () => { pending.resolve(snapshot('a')); });
  expect(view.result.current.state?.snapshot?.ownerUid).not.toBe('a');
  if (change === 'account') expect(view.result.current.state?.snapshot?.ownerUid).toBe('b');
  else expect(view.result.current.state).toBeNull();
});

it('does not restore an earlier A snapshot when A returns after B', async () => {
  const view = renderHook(() => useAcademicRecords('grades')); await flush();
  account.user = { uid: 'b' }; vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot('b')); view.rerender(); await flush();
  account.user = { uid: 'a' }; vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  view.rerender(); await flush();
  expect(view.result.current.state?.snapshot).toBeUndefined();
});

it('keeps automatic backoff and blocks polling after an authorization failure', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const view = renderHook(() => useAcademicRecords('grades', true, 'pu', true)); await flush();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(view.result.current.automaticStatus).toBe('retrying'); expect(view.result.current.state?.stale).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL - 1); }); expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('permission'));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(view.result.current.automaticStatus).toBe('blocked'); expect(view.result.current.state?.snapshot).toBeUndefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 10); }); expect(loadAcademicRecords).toHaveBeenCalledTimes(3);
});
