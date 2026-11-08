import { afterEach, expect, it, vi } from 'vitest';
import { withAssistantRequestDeadline } from './execution';

afterEach(() => vi.useRealTimers());

it('releases a hung request at its own deadline without cancelling the conversation', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  let requestSignal!: AbortSignal;
  let finish!: (value: string) => void;
  const outcome = withAssistantRequestDeadline(lifetime.signal, 15000, (signal) => {
    requestSignal = signal;
    return new Promise<string>((resolve) => { finish = resolve; });
  }).catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await outcome).toBeInstanceOf(Error);
  expect((await outcome as Error).message).toContain('連線逾時');
  expect(requestSignal.aborted).toBe(true);
  expect(lifetime.signal.aborted).toBe(false);
  finish('late success');
  expect(await outcome).toBeInstanceOf(Error);
  expect(await withAssistantRequestDeadline(lifetime.signal, 15000, async () => 'later read')).toBe('later read');
  expect(vi.getTimerCount()).toBe(0);
});

it('stops an old scope immediately even when the transport ignores AbortSignal', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  let requestSignal!: AbortSignal;
  const outcome = withAssistantRequestDeadline(lifetime.signal, 15000, (signal) => {
    requestSignal = signal;
    return new Promise<string>(() => {});
  }).catch((error: Error) => error);
  lifetime.abort();
  expect((await outcome as Error).message).toBe('已取消');
  expect(requestSignal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const work = vi.fn();
  await expect(withAssistantRequestDeadline(lifetime.signal, 15000, work)).rejects.toThrow('已取消');
  expect(work).not.toHaveBeenCalled();
});

it('clears its deadline after a completed request', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  expect(await withAssistantRequestDeadline(lifetime.signal, 15000, async () => 1)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
