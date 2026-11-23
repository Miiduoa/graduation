// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
beforeEach(() => vi.stubGlobal('__tronClassRetentionSchedulerStarted', undefined));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const configured = { NODE_ENV: process.env.NODE_ENV, NEXT_RUNTIME: 'nodejs', TRONCLASS_RETENTION_ENABLED: 'true' };
it.each([
  {}, { NEXT_RUNTIME: 'nodejs' }, { ...configured, NEXT_RUNTIME: 'edge' },
  { ...configured, TRONCLASS_RETENTION_ENABLED: 'false' },
  { ...configured, TRONCLASS_RETENTION_ENABLED: 'TRUE' },
])('does not schedule without explicit supported configuration: %j', async env => {
  vi.resetModules();
  const { startTronClassRetentionScheduler } = await import('./tronClassRetentionScheduler');
  const run = vi.fn();
  expect(startTronClassRetentionScheduler({ NODE_ENV: process.env.NODE_ENV, ...env }, run)).toBe(false);
  expect(run).not.toHaveBeenCalled();
});

it('starts once with jitter and schedules the next batch only after the current one completes', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let complete!: () => void;
  const slow = new Promise<void>(resolve => { complete = resolve; });
  const run = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(undefined);
  const { isTronClassRetentionSchedulerStarted, startTronClassRetentionScheduler, TRONCLASS_RETENTION_INTERVAL_MS } = await import('./tronClassRetentionScheduler');
  expect(isTronClassRetentionSchedulerStarted()).toBe(false);
  expect(TRONCLASS_RETENTION_INTERVAL_MS + 60_000).toBeLessThanOrEqual(5 * 60_000);
  expect(startTronClassRetentionScheduler(configured, run)).toBe(true);
  expect(isTronClassRetentionSchedulerStarted()).toBe(true);
  expect(startTronClassRetentionScheduler(configured, run)).toBe(false);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS * 3);
  expect(run).toHaveBeenCalledTimes(1);
  complete();
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS + 29_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
});

it('logs only a fixed message and continues after provider failures', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const run = vi.fn().mockRejectedValueOnce(new Error('synthetic-private-key owner=firebase:private')).mockResolvedValue(undefined);
  const { startTronClassRetentionScheduler, TRONCLASS_RETENTION_INTERVAL_MS } = await import('./tronClassRetentionScheduler');
  expect(startTronClassRetentionScheduler(configured, run)).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(log.mock.calls).toEqual([['TronClass retention failed']]);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS + 30_000);
  expect(run).toHaveBeenCalledTimes(2);
});

it('stays unready after timer registration fails and can retry initialization', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { isTronClassRetentionSchedulerStarted, startTronClassRetentionScheduler } = await import('./tronClassRetentionScheduler');
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(() => { throw new Error('timer unavailable'); });
  const run = vi.fn().mockResolvedValue(undefined);
  expect(() => startTronClassRetentionScheduler(configured, run)).toThrow('timer unavailable');
  expect(isTronClassRetentionSchedulerStarted()).toBe(false);
  timer.mockRestore();
  expect(startTronClassRetentionScheduler(configured, run)).toBe(true);
  expect(isTronClassRetentionSchedulerStarted()).toBe(true);
});
