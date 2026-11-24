import { afterEach, expect, it, vi } from 'vitest';
import { withCampusEventShortlistLock } from './campusEventShortlistLock';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('never mutates storage without a cross-tab lock, including when IndexedDB is denied', async () => {
  const action = vi.fn(async () => 'saved');
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('indexedDB', undefined);
  await expect(withCampusEventShortlistLock('events', action)).rejects.toThrow();
  vi.stubGlobal('indexedDB', {
    open: () => {
      throw new DOMException('Denied', 'SecurityError');
    },
  });
  await expect(withCampusEventShortlistLock('events', action)).rejects.toThrow('Denied');
  expect(action).not.toHaveBeenCalled();
});

it('uses the browser Web Lock for the scope and never starts the operation after a lock error', async () => {
  const operation = vi.fn(async () => 7);
  const request = vi.fn(async (_key: string, _options: LockOptions, callback: () => Promise<number>) => callback());
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('indexedDB', undefined);
  await expect(withCampusEventShortlistLock('campus-a', operation)).resolves.toBe(7);
  expect(request).toHaveBeenCalledWith('campus-a', { signal: expect.any(AbortSignal) }, expect.any(Function));
  request.mockRejectedValueOnce(new Error('Lock unavailable'));
  await expect(withCampusEventShortlistLock('campus-a', operation)).rejects.toThrow(
    'Lock unavailable',
  );
  expect(operation).toHaveBeenCalledTimes(1);
});

it('aborts a queued Web Lock and guards against a late callback', async () => {
  vi.useFakeTimers();
  let acquire!: () => Promise<string>;
  let signal!: AbortSignal;
  const operation = vi.fn(async () => 'saved');
  const request = vi.fn((_key: string, options: LockOptions, callback: () => Promise<string>) => {
    acquire = callback;
    signal = options.signal!;
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  vi.stubGlobal('navigator', { locks: { request } });
  const pending = withCampusEventShortlistLock('events', operation);
  const rejected = expect(pending).rejects.toThrow('lock acquisition timed out');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(() => acquire()).toThrow('lock acquisition timed out');
  expect(operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not abort a granted Web Lock even if the mutation takes longer than the deadline', async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const operation = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const request = vi.fn(async (_key: string, _options: LockOptions, callback: () => Promise<string>) => callback());
  vi.stubGlobal('navigator', { locks: { request } });
  const pending = withCampusEventShortlistLock('events', operation);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(request.mock.calls[0]?.[1].signal?.aborted).toBe(false);
  expect(operation).toHaveBeenCalledOnce();
  finish('saved');
  await expect(pending).resolves.toBe('saved');
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the acquisition timer and preserves an ordinary Web Lock rejection', async () => {
  vi.useFakeTimers();
  const operation = vi.fn(async () => 'saved');
  const error = new Error('Lock unavailable');
  const request = vi.fn(async () => { throw error; });
  vi.stubGlobal('navigator', { locks: { request } });
  await expect(withCampusEventShortlistLock('events', operation)).rejects.toBe(error);
  expect(operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a blocked IndexedDB open and closes a late connection without writing', async () => {
  const close = vi.fn();
  const transaction = vi.fn();
  const operation = vi.fn(async () => 'saved');
  const request: {
    onblocked?: () => void;
    onsuccess?: () => void;
    result: { close: typeof close; transaction: typeof transaction };
  } = { result: { close, transaction } };
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('indexedDB', { open: () => request });

  const pending = withCampusEventShortlistLock('events', operation);
  const rejected = expect(pending).rejects.toThrow('database upgrade blocked');
  expect(request.onblocked).toBeTypeOf('function');
  request.onblocked?.();
  await rejected;
  request.onsuccess?.();

  expect(close).toHaveBeenCalledOnce();
  expect(transaction).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});

it('closes an open connection on a version change and preserves transaction errors', async () => {
  const close = vi.fn();
  const transaction = vi.fn(() => { throw new Error('transaction failed'); });
  const operation = vi.fn(async () => 'saved');
  const connection: {
    close: typeof close;
    transaction: typeof transaction;
    onversionchange?: () => void;
  } = { close, transaction };
  const request: { onsuccess?: () => void; result: typeof connection } = { result: connection };
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('indexedDB', { open: () => request });

  const pending = withCampusEventShortlistLock('events', operation);
  const rejected = expect(pending).rejects.toThrow('transaction failed');
  request.onsuccess?.();
  expect(connection.onversionchange).toBeTypeOf('function');
  connection.onversionchange?.();
  expect(close).toHaveBeenCalledOnce();
  await rejected;
  expect(operation).not.toHaveBeenCalled();
});

function stalledDatabase() {
  vi.useFakeTimers();
  const first: { onsuccess?: () => void } = {};
  const tx = {
    objectStore: () => ({ get: () => first }),
    abort: vi.fn(),
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
  };
  const db = { transaction: vi.fn(() => tx), close: vi.fn() };
  const request: { result: typeof db; onsuccess?: () => void } = { result: db };
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('indexedDB', { open: () => request });
  return { first, tx, db, request };
}

it('rejects a stalled database open and closes any late connection without writing', async () => {
  const { request, db } = stalledDatabase();
  const operation = vi.fn(async () => 'saved');
  const pending = withCampusEventShortlistLock('events', operation);
  const rejected = expect(pending).rejects.toThrow('database open timed out');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  request.onsuccess?.();
  expect(db.close).toHaveBeenCalledOnce();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});

it('aborts a stalled transaction and never starts a late mutation', async () => {
  const { request, db, tx, first } = stalledDatabase();
  const operation = vi.fn(async () => 'saved');
  const pending = withCampusEventShortlistLock('events', operation);
  const rejected = expect(pending).rejects.toThrow('lock acquisition timed out');
  request.onsuccess?.();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  first.onsuccess?.();
  await Promise.resolve();
  expect(tx.abort).toHaveBeenCalledOnce();
  expect(db.close).toHaveBeenCalledOnce();
  expect(operation).not.toHaveBeenCalled();
});

it('does not time out a mutation after it has acquired the transaction', async () => {
  const { request, db, tx, first } = stalledDatabase();
  let finish!: (value: string) => void;
  const operation = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const pending = withCampusEventShortlistLock('events', operation);
  request.onsuccess?.();
  await Promise.resolve();
  first.onsuccess?.();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(tx.abort).not.toHaveBeenCalled();
  expect(operation).toHaveBeenCalledOnce();
  finish('saved');
  await vi.advanceTimersByTimeAsync(0);
  tx.oncomplete?.();
  await expect(pending).resolves.toBe('saved');
  expect(db.close).toHaveBeenCalledOnce();
});
