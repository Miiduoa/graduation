// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const configured = { NEXT_RUNTIME: 'nodejs', TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'true',
  TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic' };
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('opt-in platform closure scheduler', () => {
  it.each([{}, { ...configured, NEXT_RUNTIME: 'edge' },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'false' },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: '' },
  ])('does not start for an unsupported runtime or missing dedicated configuration: %j', async env => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { startTronClassPlatformClosureScheduler } = await import('./tronClassPlatformClosureScheduler');
    expect(startTronClassPlatformClosureScheduler(env, vi.fn())).toBe(false);
  });

  it('reports enabled but invalid configuration without exposing the dedicated connection string', async () => {
    vi.resetModules();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { startTronClassPlatformClosureScheduler } = await import('./tronClassPlatformClosureScheduler');
    expect(startTronClassPlatformClosureScheduler({ ...configured,
      TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: 'https://private-password@private-host/db' }, vi.fn())).toBe(false);
    expect(warning).toHaveBeenCalledExactlyOnceWith('TronClass platform account cleanup configuration is invalid');
  });

  it('starts once and retries after a generalized failure without logging private exception details', async () => {
    vi.useFakeTimers(); vi.resetModules();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error('private-account')).mockResolvedValue(undefined);
    const { startTronClassPlatformClosureScheduler, TRONCLASS_CLOSURE_INTERVAL_MS } = await import('./tronClassPlatformClosureScheduler');
    expect(startTronClassPlatformClosureScheduler(configured, run)).toBe(true);
    expect(startTronClassPlatformClosureScheduler(configured, run)).toBe(false);
    await vi.advanceTimersByTimeAsync(2499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith('TronClass platform account cleanup failed');
    await vi.advanceTimersByTimeAsync(TRONCLASS_CLOSURE_INTERVAL_MS + 2500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never overlaps the same process worker while a batch is still running', async () => {
    vi.useFakeTimers(); vi.resetModules();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let finish: (() => void) | undefined;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const { startTronClassPlatformClosureScheduler, TRONCLASS_CLOSURE_INTERVAL_MS } = await import('./tronClassPlatformClosureScheduler');
    startTronClassPlatformClosureScheduler(configured, run);
    await vi.advanceTimersByTimeAsync(TRONCLASS_CLOSURE_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
    finish!();
    await vi.advanceTimersByTimeAsync(TRONCLASS_CLOSURE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
