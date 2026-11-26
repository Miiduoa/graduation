// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const starts = vi.hoisted(() => ({ files: vi.fn(), closure: vi.fn(), retention: vi.fn() }));
vi.mock('./lib/server/privateFileCleanupScheduler', () => ({ startPrivateFileCleanupScheduler: starts.files }));
vi.mock('./lib/server/tronClassPlatformClosureScheduler', () => ({ startTronClassPlatformClosureScheduler: starts.closure }));
vi.mock('./lib/server/tronClassRetentionScheduler', () => ({ startTronClassRetentionScheduler: starts.retention }));
import { register } from './instrumentation';

beforeEach(() => vi.resetAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('independent server cleanup initialization', () => {
  it('starts all three server schedulers only in the Node runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(starts.files).toHaveBeenCalledTimes(1);
    expect(starts.closure).toHaveBeenCalledTimes(1);
    expect(starts.retention).toHaveBeenCalledTimes(1);
  });

  it.each(['edge', undefined])('does not initialize privileged workers in runtime %s', async runtime => {
    vi.stubEnv('NEXT_RUNTIME', runtime);
    await register();
    expect(starts.files).not.toHaveBeenCalled();
    expect(starts.closure).not.toHaveBeenCalled();
    expect(starts.retention).not.toHaveBeenCalled();
  });

  it.each(['files', 'closure', 'retention'] as const)('does not let %s initialization block the other cleanup services', async failing => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    starts[failing].mockImplementation(() => { throw new Error('private-connection-detail'); });
    await register();
    expect(starts.files).toHaveBeenCalledTimes(1);
    expect(starts.closure).toHaveBeenCalledTimes(1);
    expect(starts.retention).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-connection-detail');
  });
});
