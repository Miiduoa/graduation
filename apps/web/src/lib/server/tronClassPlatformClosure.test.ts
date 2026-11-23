// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlQuery } from '../nuni/assignmentFileStore';

const runtime = vi.hoisted(() => ({ getFirebaseAdmin: vi.fn(), dedicatedQuery: vi.fn(), closeTronClassOwner: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./firebaseAdmin', () => ({ getFirebaseAdmin: runtime.getFirebaseAdmin }));
vi.mock('./tronClassPlatformClosureDatabase', async importOriginal => ({
  ...await importOriginal<typeof import('./tronClassPlatformClosureDatabase')>(),
  tronClassPlatformClosureQuery: runtime.dedicatedQuery,
}));
vi.mock('../../../../../backend/functions/tronClassAccountLifecycle.js', () => ({ closeTronClassOwner: runtime.closeTronClassOwner }));
import {
  createSqlTronClassPlatformClosureStore, createTronClassPlatformClosureWorker,
  readTronClassPlatformClosureConfig, runDefaultTronClassPlatformClosureBatch,
  TRONCLASS_PLATFORM_CLOSURE_SQL,
  type TronClassPlatformClosureLease, type TronClassPlatformClosureStore,
} from './tronClassPlatformClosure';

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const lease: TronClassPlatformClosureLease = { id: '1', accountId, token, attempts: 1 };
const configured = { TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'true',
  TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic' };

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

function memoryStore() {
  return {
    claim: vi.fn<TronClassPlatformClosureStore['claim']>().mockResolvedValueOnce({ ...lease }).mockResolvedValue(null),
    complete: vi.fn<TronClassPlatformClosureStore['complete']>().mockResolvedValue(true),
    retry: vi.fn<TronClassPlatformClosureStore['retry']>().mockResolvedValue(true),
    retrying: vi.fn<TronClassPlatformClosureStore['retrying']>().mockResolvedValue(0),
  };
}

describe('platform closure queue worker', () => {
  it('uses only the database event identity and deletes its lease after the idempotent hook succeeds', async () => {
    const store = memoryStore();
    const closeOwner = vi.fn(async () => {});
    expect(await createTronClassPlatformClosureWorker({ store, closeOwner })()).toEqual({ claimed: 1, completed: 1, failed: 0, stale: 0 });
    expect(closeOwner).toHaveBeenCalledExactlyOnceWith(`platform:${accountId}`);
    expect(store.complete).toHaveBeenCalledExactlyOnceWith(lease);
    expect(closeOwner.mock.invocationCallOrder[0]).toBeLessThan(store.complete.mock.invocationCallOrder[0]);
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('keeps a failed event retryable without leaking its exception or falsely completing it', async () => {
    const store = memoryStore();
    const closeOwner = vi.fn(async () => { throw new Error('private-cookie and account details'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createTronClassPlatformClosureWorker({ store, closeOwner })()).toEqual({ claimed: 1, completed: 0, failed: 1, stale: 0 });
    expect(store.retry).toHaveBeenCalledExactlyOnceWith(lease);
    expect(store.complete).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it('does not treat another worker lease as completed by this worker', async () => {
    const store = memoryStore();
    store.complete.mockResolvedValue(false);
    expect(await createTronClassPlatformClosureWorker({ store, closeOwner: async () => {} })())
      .toEqual({ claimed: 1, completed: 0, failed: 0, stale: 1 });
  });

  it('retains the leased event when completion persistence fails after Firestore cleanup', async () => {
    const store = memoryStore();
    store.complete.mockRejectedValue(new Error('database temporarily unavailable'));
    await expect(createTronClassPlatformClosureWorker({ store, closeOwner: async () => {} })()).rejects.toThrow();
    expect(store.retry).not.toHaveBeenCalled(); // lease expiry recovers a process/connection failure
  });

  it.each([0, 21, 1.5, NaN])('rejects an invalid batch limit before claiming events: %s', async limit => {
    const store = memoryStore();
    await expect(createTronClassPlatformClosureWorker({ store, closeOwner: async () => {} })(limit))
      .rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it.each([
    { accountId: 'firebase:another-user' }, { accountId: 'pa_invalid' }, { id: '0' },
    { id: '9223372036854775808' }, { token: 'invalid' }, { attempts: 0 },
  ])('never invokes cleanup for malformed or foreign identity evidence: %j', async change => {
    const store = memoryStore();
    store.claim.mockReset().mockResolvedValue({ ...lease, ...change });
    const closeOwner = vi.fn(async () => {});
    await expect(createTronClassPlatformClosureWorker({ store, closeOwner })())
      .rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
    expect(closeOwner).not.toHaveBeenCalled();
  });
});

describe('parameterized PostgreSQL queue boundary', () => {
  it('claims one generated token and uses its exact token for removal or retry', async () => {
    const query = vi.fn<SqlQuery>(async (sql, parameters) => sql === TRONCLASS_PLATFORM_CLOSURE_SQL.claim
      ? [{ id: '1', platform_account_id: accountId, reason: 'closed', attempts: 1, lease_token: parameters![0] }]
      : [{ id: '1' }]);
    const store = createSqlTronClassPlatformClosureStore(query);
    const claimed = await store.claim();
    expect(claimed).toMatchObject({ id: '1', accountId, attempts: 1 });
    expect(query.mock.calls[0][1]).toEqual([claimed!.token, 300]);
    expect(await store.complete(claimed!)).toBe(true);
    expect(query).toHaveBeenLastCalledWith(TRONCLASS_PLATFORM_CLOSURE_SQL.complete, ['1', claimed!.token]);
    expect(await store.retry(claimed!)).toBe(true);
    expect(query).toHaveBeenLastCalledWith(TRONCLASS_PLATFORM_CLOSURE_SQL.retry, ['1', claimed!.token]);
  });

  it('reports a stale token without inventing a successful completion', async () => {
    const store = createSqlTronClassPlatformClosureStore(async () => []);
    expect(await store.claim()).toBeNull();
    expect(await store.complete(lease)).toBe(false);
    expect(await store.retry(lease)).toBe(false);
  });

  it.each([
    { id: '0' }, { platform_account_id: 'pa_wrong' }, { reason: 'suspended' },
    { attempts: '1' }, { attempts: -1 }, { lease_token: token },
  ])('rejects invalid database evidence before returning a lease: %j', async change => {
    const store = createSqlTronClassPlatformClosureStore(async (_sql, parameters) => [{
      id: '1', platform_account_id: accountId, reason: 'closed', attempts: 1, lease_token: parameters![0], ...change,
    }]);
    await expect(store.claim()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
  });

  it('counts events that still carry a failed cleanup, and fails closed on malformed evidence', async () => {
    expect(await createSqlTronClassPlatformClosureStore(async () => [{ retrying: '0' }]).retrying()).toBe(0);
    expect(await createSqlTronClassPlatformClosureStore(async () => [{ retrying: '3' }]).retrying()).toBe(3);
    for (const rows of [[], [{ retrying: 3 }], [{ retrying: '-1' }], [{ retrying: '1' }, { retrying: '1' }]])
      await expect(createSqlTronClassPlatformClosureStore(async () => rows).retrying())
        .rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
  });

  it('sanitizes SQL failures and rejects a completion for an unrelated event', async () => {
    const failed = createSqlTronClassPlatformClosureStore(async () => { throw new Error('private connection string'); });
    await expect(failed.claim()).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    const wrong = createSqlTronClassPlatformClosureStore(async () => [{ id: '2' }]);
    await expect(wrong.complete(lease)).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
  });
});

describe('explicit default worker wiring', () => {
  it.each([
    {}, { DATABASE_URL: configured.TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'false' },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'TRUE' },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: '' },
    { TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED: 'true', PLATFORM_ASSISTANT_DATABASE_URL: configured.TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: 'https://database.invalid/db' },
    { ...configured, TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL: 'postgresql://host/' },
  ])('does not inherit general database settings or start without an exact opt-in: %j', async env => {
    expect(readTronClassPlatformClosureConfig(env)).toBeNull();
    expect(await runDefaultTronClassPlatformClosureBatch(env)).toEqual({ claimed: 0, completed: 0, failed: 0, stale: 0, retrying: 0 });
    expect(runtime.getFirebaseAdmin).not.toHaveBeenCalled();
    expect(runtime.dedicatedQuery).not.toHaveBeenCalled();
    expect(runtime.closeTronClassOwner).not.toHaveBeenCalled();
  });

  it('connects the dedicated queue to the existing backend lifecycle hook and waits for cleanup before DELETE', async () => {
    const db = { synthetic: true };
    runtime.getFirebaseAdmin.mockResolvedValue({ db });
    runtime.closeTronClassOwner.mockResolvedValue(undefined);
    let claimed = false;
    const query = vi.fn<SqlQuery>(async (sql, parameters) => {
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.ready) return [{ ready: true }];
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.retrying) return [{ retrying: '0' }];
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.complete) return [{ id: '1' }];
      if (claimed) return [];
      claimed = true;
      return [{ id: '1', platform_account_id: accountId, reason: 'deleted', attempts: 1, lease_token: parameters![0] }];
    });
    runtime.dedicatedQuery.mockReturnValue(query);
    expect(await runDefaultTronClassPlatformClosureBatch(configured)).toEqual({ claimed: 1, completed: 1, failed: 0, stale: 0, retrying: 0 });
    expect(runtime.dedicatedQuery).toHaveBeenCalledExactlyOnceWith(configured.TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL);
    expect(runtime.closeTronClassOwner).toHaveBeenCalledExactlyOnceWith({ db, ownerKey: `platform:${accountId}` });
    expect(query.mock.calls[0][0]).toBe(TRONCLASS_PLATFORM_CLOSURE_SQL.ready);
    expect(runtime.closeTronClassOwner.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[2]);
  });

  it('does not claim queue events if privileged Firestore initialization is unavailable', async () => {
    runtime.getFirebaseAdmin.mockResolvedValue(null);
    await expect(runDefaultTronClassPlatformClosureBatch(configured)).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    expect(runtime.dedicatedQuery).not.toHaveBeenCalled();
  });

  it('reports a retryable backend cleanup failure without exposing the owner or raw exception', async () => {
    runtime.getFirebaseAdmin.mockResolvedValue({ db: { synthetic: true } });
    runtime.closeTronClassOwner.mockRejectedValue(new Error('private-cookie'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let claimed = false;
    const query = vi.fn<SqlQuery>(async (sql, parameters) => {
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.ready) return [{ ready: true }];
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.retry) return [{ id: '1' }];
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.retrying) return [{ retrying: '1' }];
      if (claimed) return [];
      claimed = true;
      return [{ id: '1', platform_account_id: accountId, reason: 'closed', attempts: 1, lease_token: parameters![0] }];
    });
    runtime.dedicatedQuery.mockReturnValue(query);
    expect(await runDefaultTronClassPlatformClosureBatch(configured)).toEqual({ claimed: 1, completed: 0, failed: 1, stale: 0, retrying: 1 });
    expect(warning).toHaveBeenCalledExactlyOnceWith('TronClass platform account cleanup failed');
    expect(query.mock.calls.some(([sql]) => sql === TRONCLASS_PLATFORM_CLOSURE_SQL.complete)).toBe(false);
  });

  it.each([
    ['not ready', async () => [{ ready: false }]],
    ['no row', async () => []],
    ['a non-boolean answer', async () => [{ ready: 'true' }]],
    ['a failing query', async () => { throw new Error('private-db-detail'); }],
  ] as const)('claims nothing when the closure pipeline reports %s', async (_name, readiness) => {
    runtime.getFirebaseAdmin.mockResolvedValue({ db: { synthetic: true } });
    const query = vi.fn<SqlQuery>(async (sql) => {
      if (sql === TRONCLASS_PLATFORM_CLOSURE_SQL.ready) return readiness() as Promise<Record<string, unknown>[]>;
      throw new Error('queue must not be touched');
    });
    runtime.dedicatedQuery.mockReturnValue(query);
    await expect(runDefaultTronClassPlatformClosureBatch(configured)).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    expect(query).toHaveBeenCalledExactlyOnceWith(TRONCLASS_PLATFORM_CLOSURE_SQL.ready, []);
    expect(runtime.closeTronClassOwner).not.toHaveBeenCalled();
  });
});
