// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const configured = { NEXT_RUNTIME: 'nodejs', FILE_STORAGE_BACKEND: 'supabase', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', SUPABASE_STORAGE_BUCKET: 'private' };
it.each([
  {}, { ...configured, NEXT_RUNTIME: 'edge' },
  { ...configured, FILE_STORAGE_BACKEND: 'off' },
  ...['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'].map((key) => ({ ...configured, [key]: '' })),
])('does not start for incomplete or unsupported runtime settings', async (env) => {
  vi.resetModules();
  const { startPrivateFileCleanupScheduler } = await import('./privateFileCleanupScheduler');
  expect(startPrivateFileCleanupScheduler(env, vi.fn())).toBe(false);
});
it('starts once, jitters, and continues after generalized failure logging', async () => {
  vi.useFakeTimers(); vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const run = vi.fn().mockRejectedValueOnce(new Error('sensitive details')).mockResolvedValue(undefined);
  const { startPrivateFileCleanupScheduler, CLEANUP_INTERVAL_MS } = await import('./privateFileCleanupScheduler');
  expect(startPrivateFileCleanupScheduler(configured, run)).toBe(true);
  expect(startPrivateFileCleanupScheduler(configured, run)).toBe(false);
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('Private file cleanup failed');
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS + 30_000);
  expect(run).toHaveBeenCalledTimes(2);
  vi.clearAllTimers();
});
