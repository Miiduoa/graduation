import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdminMutation } from './hooks';

afterEach(() => vi.unstubAllGlobals());

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
