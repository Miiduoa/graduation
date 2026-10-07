import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSchoolCollectionData } from './useSchoolCollectionData';
const config = vi.hoisted(() => ({ enabled: true }));
vi.mock('./firebase', () => ({ isFirebaseConfigured: () => config.enabled }));
beforeEach(() => {
  config.enabled = true;
});
it('reports missing configuration without fabricating a collection', async () => {
  config.enabled = false;
  const load = vi.fn();
  const { result } = renderHook(() => useSchoolCollectionData('pu', load));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual([]);
  expect(result.current.sourceMode).toBe('unavailable');
  expect(result.current.error).toBeTruthy();
  expect(load).not.toHaveBeenCalled();
});
it('keeps a successful empty collection distinct from a failure', async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useSchoolCollectionData('pu', load));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeNull();
  expect(result.current.sourceMode).toBe('firebase');
  expect(result.current.data).toEqual([]);
});
it('clears failed data and retries the real source', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['menu']);
  const { result } = renderHook(() => useSchoolCollectionData('pu', load));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.data).toEqual([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.data).toEqual(['menu']));
  expect(result.current.error).toBeNull();
});
it('rejects a non-array response', async () => {
  const load = vi.fn().mockResolvedValue({ success: false });
  const { result } = renderHook(() => useSchoolCollectionData('pu', load));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.data).toEqual([]);
});
it('handles a loader that throws before returning a promise', async () => {
  const load = vi.fn(() => {
    throw new Error('not initialized');
  });
  const { result } = renderHook(() => useSchoolCollectionData('pu', load));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.data).toEqual([]);
});
it('rejects a late school response after switching schools', async () => {
  let resolveOld!: (rows: string[]) => void;
  const load = vi.fn((school: string) =>
    school === 'pu'
      ? new Promise<string[]>((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(['new school']),
  );
  const { result, rerender } = renderHook(({ school }) => useSchoolCollectionData(school, load), {
    initialProps: { school: 'pu' },
  });
  rerender({ school: 'other' });
  await waitFor(() => expect(result.current.data).toEqual(['new school']));
  await act(async () => resolveOld(['old school']));
  expect(result.current.data).toEqual(['new school']);
});
it('unsubscribes and clears previous account data before accepting the new source', async () => {
  const callbacks: Array<{ next: (rows: string[]) => void; fail: (error: unknown) => void }> = [];
  const stop = vi.fn();
  const subscribe = vi.fn(
    (_school: string, next: (rows: string[]) => void, fail: (error: unknown) => void) => {
      callbacks.push({ next, fail });
      return stop;
    },
  );
  const { result, rerender } = renderHook(
    ({ uid }) =>
      useSchoolCollectionData('pu', undefined, { scopeKey: uid, subscribeLive: subscribe }),
    { initialProps: { uid: 'a' } },
  );
  act(() => callbacks[0].next(['old']));
  expect(result.current.data).toEqual(['old']);
  rerender({ uid: 'b' });
  expect(result.current.data).toEqual([]);
  expect(stop).toHaveBeenCalledTimes(1);
  act(() => callbacks[0].next(['stale']));
  expect(result.current.data).toEqual([]);
  act(() => callbacks[1].next(['current']));
  expect(result.current.data).toEqual(['current']);
  act(() => callbacks[1].fail(new Error('permission lost')));
  expect(result.current.data).toEqual([]);
  expect(result.current.sourceMode).toBe('unavailable');
});
it('reports subscription initialization failure without keeping prior rows', async () => {
  const subscribe = vi.fn(() => {
    throw new Error('cannot subscribe');
  });
  const { result } = renderHook(() =>
    useSchoolCollectionData('pu', undefined, { subscribeLive: subscribe }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeTruthy();
  expect(result.current.data).toEqual([]);
});
