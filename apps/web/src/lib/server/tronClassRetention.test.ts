// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createTronClassRetentionWorker, runDefaultTronClassRetentionBatch, type TronClassRetentionStore } from './tronClassRetention';
import { getFirebaseAdmin } from './firebaseAdmin';

vi.mock('server-only', () => ({}));
vi.mock('./firebaseAdmin', () => ({ getFirebaseAdmin: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); });

it.each([
  {}, { NEXT_RUNTIME: 'nodejs' }, { NEXT_RUNTIME: 'nodejs', TRONCLASS_RETENTION_ENABLED: 'false' },
  { NEXT_RUNTIME: 'nodejs', TRONCLASS_RETENTION_ENABLED: 'TRUE' },
  { NEXT_RUNTIME: 'edge', TRONCLASS_RETENTION_ENABLED: 'true' },
])('never initializes Firebase without explicit server-side opt-in: %j', async env => {
  expect(await runDefaultTronClassRetentionBatch({ NODE_ENV: process.env.NODE_ENV, ...env }))
    .toEqual({ scanned: 0, deleted: 0, skipped: true });
  expect(getFirebaseAdmin).not.toHaveBeenCalled();
});

it('generalizes configuration/provider errors without exposing credentials', async () => {
  vi.mocked(getFirebaseAdmin).mockRejectedValueOnce(new Error('synthetic-private-key owner=firebase:private'));
  await expect(runDefaultTronClassRetentionBatch({ NODE_ENV: process.env.NODE_ENV, NEXT_RUNTIME: 'nodejs', TRONCLASS_RETENTION_ENABLED: 'true' }))
    .rejects.toThrow(/^TronClass retention unavailable$/);
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('refuses an invalid cleanup clock (%s) before any DB access', async at => {
  const collection = vi.fn();
  const run = createTronClassRetentionWorker({ db: { collection } as unknown as TronClassRetentionStore, now: () => at });
  await expect(run()).rejects.toThrow(/^TronClass retention unavailable$/);
  expect(collection).not.toHaveBeenCalled();
});

it('does not overlap a slow batch and releases the guard after failure', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
  const get = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ docs: [] });
  const query = { where: () => query, orderBy: () => query, limit: () => query, get };
  const collection = vi.fn(() => query);
  const run = createTronClassRetentionWorker({ db: { collection } as unknown as TronClassRetentionStore });
  const first = run();
  expect(await run()).toEqual({ scanned: 0, deleted: 0, skipped: true });
  expect(collection).toHaveBeenCalledTimes(1);
  const failure = expect(first).rejects.toThrow(/^TronClass retention unavailable$/);
  reject(new Error('private provider details'));
  await failure;
  expect(await run()).toEqual({ scanned: 0, deleted: 0, skipped: false });
  expect(collection).toHaveBeenCalledTimes(4);
});
