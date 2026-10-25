import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdminMutation, useAdminResource } from './hooks';

afterEach(() => vi.unstubAllGlobals());

const keepResponse = (value: unknown) => value;

it.each([401, 403])(
  'clears retained management records when the server returns %s',
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"people":["private"]}'))
      .mockResolvedValueOnce(new Response('{"error":"FORBIDDEN"}', { status }));
    vi.stubGlobal('fetch', fetcher);
    const hook = renderHook(() => useAdminResource('people?tenantId=pu', 'account', keepResponse));
    await waitFor(() => expect(hook.result.current.value).toEqual({ people: ['private'] }));
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(hook.result.current.value).toBeUndefined();
  },
);

it('retains recoverable records after a temporary read failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"people":["private"]}'))
    .mockRejectedValueOnce(new TypeError('Network unavailable'));
  vi.stubGlobal('fetch', fetcher);
  const hook = renderHook(() => useAdminResource('people?tenantId=pu', 'account', keepResponse));
  await waitFor(() => expect(hook.result.current.value).toBeTruthy());
  act(() => hook.result.current.reload());
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(hook.result.current.value).toEqual({ people: ['private'] });
});

it('isolates in-flight locks and stale handlers across account contexts', async () => {
  let finishA!: (value: Response) => void;
  let finishB!: (value: Response) => void;
  const first = new Promise<Response>((resolve) => {
    finishA = resolve;
  });
  const second = new Promise<Response>((resolve) => {
    finishB = resolve;
  });
  const fetcher = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.stubGlobal('fetch', fetcher);
  const hook = renderHook(({ context }) => useAdminMutation(context), {
    initialProps: { context: 'account-a' },
  });
  const oldRun = hook.result.current.run;
  let firstResult!: Promise<unknown>;
  act(() => {
    firstResult = oldRun('schools/school-one/profile', { displayName: '甲' });
  });
  hook.rerender({ context: 'account-b' });
  expect(hook.result.current.busy).toBe(false);
  await act(async () => {
    expect(await oldRun('schools/school-one/profile', { displayName: '舊帳號' })).toBeUndefined();
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const newRun = hook.result.current.run;
  let secondResult!: Promise<unknown>;
  act(() => {
    secondResult = newRun('schools/school-one/profile', { displayName: '乙' });
  });
  await act(async () => {
    finishA(new Response('{"saved":"甲"}'));
    expect(await firstResult).toBeUndefined();
  });
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    expect(await newRun('schools/school-one/modules', { leave: false })).toBeUndefined();
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishB(new Response('{"saved":"乙"}'));
    expect(await secondResult).toEqual({ saved: '乙' });
  });
  expect(hook.result.current.busy).toBe(false);
});
