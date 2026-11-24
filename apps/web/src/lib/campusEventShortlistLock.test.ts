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
