import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAcademicRecords } from './useAcademicRecords';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from './academicClient';
import { ACADEMIC_REFRESH_INTERVAL_MS as INTERVAL } from './academicRefreshController';

const account = vi.hoisted(() => ({ user: { uid: 'a' } as { uid: string } | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('./academicClient', () => ({
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
  loadAcademicRecords: vi.fn(),
}));

function snapshot(uid = 'a', time = '2026-10-27T00:00:00.000Z'): AcademicSnapshot<'grades'> {
  return {
    ownerUid: uid,
    schoolId: 'pu',
    fetchedAt: time,
    records: { grades: [], semesters: [], allSemesters: [], summary: {} },
  };
}
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
let visibility = 'visible';
let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  account.user = { uid: 'a' };
  account.loading = false;
  visibility = 'visible';
  online = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(snapshot());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('does not poll without explicit opt-in', async () => {
  const view = renderHook(() => useAcademicRecords('grades'));
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 3); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  expect(view.result.current.state?.snapshot?.ownerUid).toBe('a');
  view.unmount();
});

it('enables foreground updates without causing an immediate duplicate read', async () => {
  const view = renderHook(({ automatic }) => useAcademicRecords('grades', true, 'pu', automatic), {
    initialProps: { automatic: false },
  });
  await flush();
  view.rerender({ automatic: true });
  await flush();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot('a', '2026-10-27T00:05:00.000Z'));
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  expect(view.result.current.state?.snapshot?.fetchedAt).toBe('2026-10-27T00:05:00.000Z');
  view.unmount();
});

it('retains the labelled last snapshot while updating and coalesces repeated clicks', async () => {
  const view = renderHook(() => useAcademicRecords('grades'));
  await flush();
  let finish!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => { void view.result.current.refresh(); void view.result.current.refresh(); });
  await flush();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  expect(view.result.current.state?.status).toBe('ready');
  expect(view.result.current.state?.refreshing).toBe(true);
  expect(view.result.current.state?.snapshot?.fetchedAt).toBe('2026-10-27T00:00:00.000Z');
  await act(async () => { finish(snapshot('a', '2026-10-27T00:01:00.000Z')); });
  expect(view.result.current.state?.refreshing).toBe(false);
  view.unmount();
});

it('fences a late response and stops the old scheduler after an account change', async () => {
  let old!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { old = resolve; }));
  const view = renderHook(() => useAcademicRecords('grades', true, 'pu', true));
  await flush();
  account.user = { uid: 'b' };
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot('b'));
  view.rerender();
  expect(view.result.current.state).toBeNull();
  await flush();
  await act(async () => { old(snapshot('a')); });
  expect(view.result.current.state?.snapshot?.ownerUid).toBe('b');
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(vi.mocked(loadAcademicRecords).mock.calls.filter(([, uid]) => uid === 'a')).toHaveLength(1);
  view.unmount();
});

it('does not send requests for an unsupported campus or render old campus records', async () => {
  const view = renderHook(({ school }) => useAcademicRecords('grades', true, school, true), {
    initialProps: { school: 'pu' },
  });
  await flush();
  view.rerender({ school: 'nthu' });
  expect(view.result.current.state).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 10); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('stops polling on expired authorization and never retains a misleading success state', async () => {
  const view = renderHook(() => useAcademicRecords('grades', true, 'pu', true));
  await flush();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(view.result.current.state?.status).toBe('error');
  expect(view.result.current.state?.snapshot).toBeUndefined();
  expect(view.result.current.automaticStatus).toBe('blocked');
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 10); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('pauses automatic reads while hidden and offline and resumes only when both permit', async () => {
  const view = renderHook(() => useAcademicRecords('grades', true, 'pu', true));
  await flush();
  visibility = 'hidden';
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 3); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  online = false;
  visibility = 'visible';
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(view.result.current.automaticStatus).toBe('offline');
  online = true;
  act(() => { window.dispatchEvent(new Event('online')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('rejects a mismatched owner returned by a reader and does not show their data', async () => {
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot('someone-else'));
  const view = renderHook(() => useAcademicRecords('grades'));
  await flush();
  expect(view.result.current.state?.status).toBe('error');
  expect(view.result.current.state?.snapshot).toBeUndefined();
  view.unmount();
});
