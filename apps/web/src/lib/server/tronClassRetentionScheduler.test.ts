// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  isTronClassRetentionSchedulerReady, startTronClassRetentionScheduler,
  TRONCLASS_RETENTION_INTERVAL_MS, waitForTronClassRetentionFirstSweep,
} from './tronClassRetentionScheduler';

vi.mock('server-only', () => ({}));
beforeEach(() => vi.stubGlobal('__tronClassRetentionScheduler', undefined));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const configured = { NODE_ENV: process.env.NODE_ENV, NEXT_RUNTIME: 'nodejs', TRONCLASS_RETENTION_ENABLED: 'true' };
const successful = { scanned: 0, deleted: 0, skipped: false };

it.each([
  {}, { NEXT_RUNTIME: 'nodejs' }, { ...configured, NEXT_RUNTIME: 'edge' },
  { ...configured, TRONCLASS_RETENTION_ENABLED: 'false' },
  { ...configured, TRONCLASS_RETENTION_ENABLED: 'TRUE' },
])('does not schedule without explicit supported configuration: %j', async env => {
  const run = vi.fn().mockResolvedValue(successful);
  expect(startTronClassRetentionScheduler({ NODE_ENV: process.env.NODE_ENV, ...env }, run)).toBe(false);
  await waitForTronClassRetentionFirstSweep();
  expect(run).not.toHaveBeenCalled();
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
});

it('starts the first sweep asynchronously and schedules later sweeps with jitter after completion', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let complete!: (result: typeof successful) => void;
  const slow = new Promise<typeof successful>(resolve => { complete = resolve; });
  const run = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(successful);
  expect(startTronClassRetentionScheduler(configured, run)).toBe(true);
  expect(startTronClassRetentionScheduler(configured, run)).toBe(false);
  expect(run).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(1);
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS * 3);
  expect(run).toHaveBeenCalledTimes(1);

  const waiting = waitForTronClassRetentionFirstSweep();
  complete(successful);
  await waiting;
  expect(isTronClassRetentionSchedulerReady()).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS + 29_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
});

it('bounds the initial wait even when the first sweep is still running', async () => {
  vi.useFakeTimers();
  const run = vi.fn(() => new Promise<typeof successful>(() => {}));
  startTronClassRetentionScheduler(configured, run);
  const completedWait = vi.fn();
  const waiting = waitForTronClassRetentionFirstSweep().then(completedWait);
  await vi.advanceTimersByTimeAsync(2_999);
  expect(completedWait).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(run).toHaveBeenCalledOnce();
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
});

it('requires a complete sweep and expires readiness while later sweeps fail', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failure = new Error('synthetic provider failure');
  const run = vi.fn().mockRejectedValue(failure)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ ...successful, skipped: true })
    .mockResolvedValueOnce(successful);
  startTronClassRetentionScheduler(configured, run);
  await waitForTronClassRetentionFirstSweep();
  expect(log.mock.calls).toEqual([['TronClass retention failed']]);
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS);
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS);
  expect(isTronClassRetentionSchedulerReady()).toBe(true);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(isTronClassRetentionSchedulerReady()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(isTronClassRetentionSchedulerReady()).toBe(false);
  run.mockResolvedValueOnce(successful);
  await vi.advanceTimersByTimeAsync(TRONCLASS_RETENTION_INTERVAL_MS);
  expect(isTronClassRetentionSchedulerReady()).toBe(true);
});
