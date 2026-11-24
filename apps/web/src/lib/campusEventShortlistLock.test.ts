import { afterEach, expect, it, vi } from 'vitest';
import { withCampusEventShortlistLock } from './campusEventShortlistLock';

afterEach(() => vi.unstubAllGlobals());

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
  const request = vi.fn(async (_key: string, callback: () => Promise<number>) => callback());
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('indexedDB', undefined);
  await expect(withCampusEventShortlistLock('campus-a', operation)).resolves.toBe(7);
  expect(request).toHaveBeenCalledWith('campus-a', operation);
  request.mockRejectedValueOnce(new Error('Lock unavailable'));
  await expect(withCampusEventShortlistLock('campus-a', operation)).rejects.toThrow(
    'Lock unavailable',
  );
  expect(operation).toHaveBeenCalledTimes(1);
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
