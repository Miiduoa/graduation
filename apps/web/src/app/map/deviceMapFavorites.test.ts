import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_MAP_FAVORITES_LIMIT,
  DEVICE_MAP_FAVORITES_RAW_LIMIT,
  clearDeviceMapFavorites,
  deviceMapFavoritesKey,
  readDeviceMapFavorites,
  setDeviceMapFavorite,
} from './deviceMapFavorites';

const alice = 'pa_11111111-1111-4111-8111-111111111111';
const bob = 'pa_22222222-2222-4222-8222-222222222222';
const school = 'pu';
const current = () => true;
const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

function memoryStorage() {
  const values = new Map<string, string>();
  const io = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    clear: vi.fn(() => { values.clear(); }),
    get length() { return values.size; },
  };
  return { values, io };
}

let memory: ReturnType<typeof memoryStorage>;

function entryKey(locationId: string, accountId = alice, schoolId = school) {
  return `${deviceMapFavoritesKey(accountId, schoolId)}${encodeURIComponent(locationId)}`;
}

function record(locationId: string, accountId = alice, schoolId = school) {
  return JSON.stringify({ version: 1, accountId, schoolId, locationId });
}

function seed(locationId: string, accountId = alice, schoolId = school) {
  memory.values.set(entryKey(locationId, accountId, schoolId), record(locationId, accountId, schoolId));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function installLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, _options: { mode: string }, operation: () => unknown) => {
    const result = (tails.get(name) ?? Promise.resolve()).then(operation);
    tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return request;
}

beforeEach(() => {
  memory = memoryStorage();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memory.io });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage);
  else Reflect.deleteProperty(window, 'localStorage');
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('Google device map favorite scopes', () => {
  it('uses an exact account and school prefix without prefix collisions', () => {
    const prefix = deviceMapFavoritesKey(alice, school);
    expect(prefix).toBe(`campus-one:device-map-favorites:v1:platform:${alice}:pu:`);
    expect(deviceMapFavoritesKey(bob, school)).not.toBe(prefix);
    expect(deviceMapFavoritesKey(alice, 'pu-east').startsWith(prefix)).toBe(false);
  });

  it('isolates accounts and schools, including after a new reader is created', async () => {
    await setDeviceMapFavorite(alice, school, 'library', true, current);
    await setDeviceMapFavorite(alice, 'ntu', 'gate', true, current);
    await setDeviceMapFavorite(bob, school, 'health', true, current);
    vi.resetModules();
    const reopened = await import('./deviceMapFavorites');
    const ids = reopened.readDeviceMapFavorites(alice, school);
    expect(ids).toEqual(['library']);
    ids.push('not-persisted');
    expect(reopened.readDeviceMapFavorites(alice, school)).toEqual(['library']);
    expect(readDeviceMapFavorites(alice, 'ntu')).toEqual(['gate']);
    expect(readDeviceMapFavorites(bob, school)).toEqual(['health']);
  });

  it('does not read or migrate guest, Firebase, or another scope records', async () => {
    const unrelated = [
      'campus-one:map-favorites:guest:pu',
      'campus-one:map-favorites:firebase:alice:pu',
      entryKey('library', bob),
      entryKey('library', alice, 'pu-east'),
    ];
    unrelated.forEach((key) => memory.values.set(key, '{broken foreign data'));
    expect(readDeviceMapFavorites(alice, school)).toEqual([]);
    expect(memory.io.getItem).not.toHaveBeenCalled();
    await setDeviceMapFavorite(alice, school, 'gate', true, current);
    expect(memory.io.getItem.mock.calls.every(([key]) => key.startsWith(deviceMapFavoritesKey(alice, school)))).toBe(true);
    unrelated.forEach((key) => expect(memory.values.get(key)).toBe('{broken foreign data'));
  });

  it.each([
    ['guest', school],
    ['firebase-uid', school],
    ['pa_short', school],
    [`${alice}:pu`, school],
    [`${alice}\n`, school],
    [alice, ''],
    [alice, '../pu'],
    [alice, 'pu:other'],
    [alice, ' pU '],
    [alice, 'pu\n'],
    [alice, 'a'.repeat(81)],
    [alice, '__proto__'],
  ])('rejects an invalid scope before accessing storage: %s / %s', async (accountId, schoolId) => {
    expect(() => deviceMapFavoritesKey(accountId, schoolId)).toThrow();
    expect(() => readDeviceMapFavorites(accountId, schoolId)).toThrow();
    await expect(setDeviceMapFavorite(accountId, schoolId, 'library', true, current))
      .rejects.toMatchObject({ code: 'invalid-scope' });
    await expect(clearDeviceMapFavorites(accountId, schoolId, current))
      .rejects.toMatchObject({ code: 'invalid-scope' });
    expect(memory.io.key).not.toHaveBeenCalled();
    expect(memory.io.setItem).not.toHaveBeenCalled();
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });
});

describe('independent location entries', () => {
  it('adds and removes without Web Locks, retries idempotently, and preserves other entries', async () => {
    expect(await setDeviceMapFavorite(alice, school, 'library', true, current)).toEqual(['library']);
    const libraryRaw = memory.values.get(entryKey('library'));
    expect(await setDeviceMapFavorite(alice, school, 'gate', true, current)).toEqual(['gate', 'library']);
    expect(memory.values.get(entryKey('library'))).toBe(libraryRaw);
    expect(await setDeviceMapFavorite(alice, school, 'gate', true, current)).toEqual(['gate', 'library']);
    expect(memory.io.setItem).toHaveBeenCalledTimes(2);
    expect(await setDeviceMapFavorite(alice, school, 'gate', false, current)).toEqual(['library']);
    expect(await setDeviceMapFavorite(alice, school, 'gate', false, current)).toEqual(['library']);
    expect(memory.io.removeItem).toHaveBeenCalledTimes(1);
    expect(memory.values.get(entryKey('library'))).toBe(libraryRaw);
  });

  it('preserves valid Unicode IDs and encodes delimiters without identity collisions', async () => {
    for (const id of ['靜宜圖書館', 'map:gate', 'map%3Agate']) {
      await setDeviceMapFavorite(alice, school, id, true, current);
    }
    const ids = readDeviceMapFavorites(alice, school);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['靜宜圖書館', 'map:gate', 'map%3Agate']));
    expect(entryKey('map:gate')).not.toBe(entryKey('map%3Agate'));
  });

  it.each(['', ' ', ' library', 'a/b', 'a\\b', '\u0000', '__proto__', 'constructor', 'prototype', '.', '..', '\ud800', 'a'.repeat(201)])(
    'rejects an invalid location without changing storage: %j', async (id) => {
      await expect(setDeviceMapFavorite(alice, school, id, true, current))
        .rejects.toMatchObject({ code: 'invalid-location' });
      expect(memory.io.setItem).not.toHaveBeenCalled();
      expect(memory.io.removeItem).not.toHaveBeenCalled();
    },
  );

  it('rejects a nonboolean operation instead of coercing an external value', async () => {
    await expect(setDeviceMapFavorite(alice, school, 'library', 'false' as unknown as boolean, current))
      .rejects.toMatchObject({ code: 'invalid-location' });
    expect(memory.values.size).toBe(0);
  });

  it('does not overwrite another tab adding a different location between read and write', async () => {
    memory.io.setItem.mockImplementationOnce((key, value) => {
      seed('gate');
      memory.values.set(key, value);
    });
    expect(await setDeviceMapFavorite(alice, school, 'library', true, current)).toEqual(['gate', 'library']);
    expect(memory.values.get(entryKey('gate'))).toBe(record('gate'));
    expect(memory.io.setItem).toHaveBeenCalledTimes(1);
  });

  it('reports a same-location concurrent reversal instead of claiming a successful removal', async () => {
    seed('library');
    memory.io.removeItem.mockImplementationOnce((key) => {
      memory.values.delete(key);
      seed('library'); // Another tab saved this location after our remove.
    });
    await expect(setDeviceMapFavorite(alice, school, 'library', false, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
    expect(readDeviceMapFavorites(alice, school)).toEqual(['library']);
  });
});

describe('validation and storage failures', () => {
  it.each([
    '', '{broken', 'null', '[]',
    JSON.stringify({ version: 2, accountId: alice, schoolId: school, locationId: 'library' }),
    record('library', bob),
    record('library', alice, 'ntu'),
    record('gate'),
    JSON.stringify({ version: 1, accountId: alice, schoolId: school, locationId: 'library', owner: bob }),
    `${record('library')}${' '.repeat(2048)}`,
  ])('keeps corrupt or foreign data intact and refuses to overwrite it: %j', async (raw) => {
    memory.values.set(entryKey('library'), raw);
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'corrupt-data' });
    expect(memory.values.get(entryKey('library'))).toBe(raw);
    expect(memory.io.setItem).not.toHaveBeenCalled();
  });

  it.each(['%6Cibrary', '%E0%A4', '', 'other%2Flibrary', 'x'.repeat(1801)])('rejects noncanonical entry suffixes: %j', (suffix) => {
    memory.values.set(`${deviceMapFavoritesKey(alice, school)}${suffix}`, record('library'));
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
  });

  it('rejects prototype keys without assigning or merging parsed fields', async () => {
    const raw = `{"version":1,"accountId":"${alice}","schoolId":"pu","locationId":"library","__proto__":{"polluted":true}}`;
    memory.values.set(entryKey('library'), raw);
    await expect(setDeviceMapFavorite(alice, school, 'gate', true, current))
      .rejects.toMatchObject({ code: 'corrupt-data' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(memory.values.get(entryKey('library'))).toBe(raw);
  });

  it('enforces the item limit while allowing idempotent saves and removals at capacity', async () => {
    for (let index = 0; index < DEVICE_MAP_FAVORITES_LIMIT; index += 1) seed(`poi-${index}`);
    expect(await setDeviceMapFavorite(alice, school, 'poi-0', true, current)).toHaveLength(500);
    expect(memory.io.setItem).not.toHaveBeenCalled();
    await expect(setDeviceMapFavorite(alice, school, 'new', true, current))
      .rejects.toMatchObject({ code: 'limit-reached' });
    expect(memory.values.has(entryKey('new'))).toBe(false);
    expect(await setDeviceMapFavorite(alice, school, 'poi-0', false, current)).toHaveLength(499);
    expect(await setDeviceMapFavorite(alice, school, 'new', true, current)).toHaveLength(500);
  });

  it('allows a targeted removal to recover an unlocked 499-to-501 capacity race', async () => {
    for (let index = 0; index < 501; index += 1) seed(`poi-${index}`);
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    expect(await setDeviceMapFavorite(alice, school, 'poi-500', false, current)).toHaveLength(500);
    expect(memory.io.removeItem).toHaveBeenCalledTimes(1);
    expect(memory.io.removeItem).toHaveBeenCalledWith(entryKey('poi-500'));
  });

  it('bounds aggregate raw data before accepting an existing scope', () => {
    for (let index = 0; index < 80; index += 1) {
      const id = `poi-${index}`;
      memory.values.set(entryKey(id), record(id).padEnd(1800, ' '));
    }
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });

  it('checks the next record against the aggregate budget before writing', async () => {
    const count = 66;
    const width = Math.floor(DEVICE_MAP_FAVORITES_RAW_LIMIT / count);
    for (let index = 0; index < count; index += 1) {
      const id = `poi-${index}`;
      memory.values.set(entryKey(id), record(id).padEnd(width, ' '));
    }
    expect(readDeviceMapFavorites(alice, school)).toHaveLength(count);
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'limit-reached' });
    expect(memory.io.setItem).not.toHaveBeenCalled();
  });

  it('does not return an empty collection when browser storage access is denied', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('SecurityError'); },
    });
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'storage-unavailable' });
    expect(memory.values.size).toBe(0);
  });

  it('does not mistake denied reads or key enumeration for absent data', async () => {
    seed('library');
    memory.io.getItem.mockImplementation(() => { throw new Error('denied'); });
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    await expect(setDeviceMapFavorite(alice, school, 'gate', true, current))
      .rejects.toMatchObject({ code: 'storage-unavailable' });
    memory.io.key.mockImplementation(() => { throw new Error('denied'); });
    await expect(clearDeviceMapFavorites(alice, school, current))
      .rejects.toMatchObject({ code: 'storage-unavailable' });
    expect(memory.values.get(entryKey('library'))).toBe(record('library'));
  });

  it('keeps existing records when a new write is refused', async () => {
    seed('gate');
    memory.io.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'write-failed' });
    expect(readDeviceMapFavorites(alice, school)).toEqual(['gate']);
  });

  it('does not report success for ignored writes or ignored removals', async () => {
    memory.io.setItem.mockImplementation(() => {});
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
    seed('library');
    memory.io.removeItem.mockImplementation(() => {});
    await expect(setDeviceMapFavorite(alice, school, 'library', false, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
    await expect(clearDeviceMapFavorites(alice, school, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
  });

  it('rejects a corrupted readback without rolling back newer data', async () => {
    memory.io.setItem.mockImplementationOnce((key) => { memory.values.set(key, record('library', bob)); });
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
    expect(memory.values.get(entryKey('library'))).toBe(record('library', bob));
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });

  it('refuses partial lists if another tab deletes a key during enumeration', () => {
    seed('gate');
    seed('library');
    memory.io.getItem.mockImplementationOnce((key) => {
      const raw = memory.values.get(key) ?? null;
      memory.values.delete(entryKey('library'));
      return raw;
    });
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
  });

  it('bounds key enumeration even when storage reports an excessive length', () => {
    vi.spyOn(memory.io, 'length', 'get').mockReturnValue(20_001);
    expect(() => readDeviceMapFavorites(alice, school)).toThrow();
    expect(memory.io.key).not.toHaveBeenCalled();
  });
});

describe('session fences and cross-tab locks', () => {
  it('does no storage work if the account has already changed', async () => {
    await expect(setDeviceMapFavorite(alice, school, 'library', true, () => false))
      .rejects.toMatchObject({ code: 'scope-changed' });
    await expect(clearDeviceMapFavorites(alice, school, () => false))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(memory.io.key).not.toHaveBeenCalled();
    expect(memory.io.setItem).not.toHaveBeenCalled();
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });

  it('rechecks the scope after reading and immediately before a write', async () => {
    seed('gate');
    let active = true;
    memory.io.getItem.mockImplementationOnce((key) => {
      active = false;
      return memory.values.get(key) ?? null;
    });
    await expect(setDeviceMapFavorite(alice, school, 'library', true, () => active))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(memory.io.setItem).not.toHaveBeenCalled();
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });

  it('does not return a successful receipt or roll back if scope changes after the write', async () => {
    let active = true;
    memory.io.setItem.mockImplementationOnce((key, raw) => {
      memory.values.set(key, raw);
      active = false;
    });
    await expect(setDeviceMapFavorite(alice, school, 'library', true, () => active))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(memory.values.get(entryKey('library'))).toBe(record('library'));
    expect(memory.io.removeItem).not.toHaveBeenCalled();
  });

  it.each(['save', 'clear'] as const)('does not %s after a delayed lock outlives its session', async (action) => {
    seed('library');
    const request = installLocks();
    const gate = deferred();
    const held = request(deviceMapFavoritesKey(alice, school), { mode: 'exclusive' }, () => gate.promise);
    let active = true;
    const operation = action === 'save'
      ? setDeviceMapFavorite(alice, school, 'gate', true, () => active)
      : clearDeviceMapFavorites(alice, school, () => active);
    const check = expect(operation).rejects.toMatchObject({ code: 'scope-changed' });
    active = false;
    gate.resolve();
    await held;
    await check;
    expect(memory.io.setItem).not.toHaveBeenCalled();
    expect(memory.io.removeItem).not.toHaveBeenCalled();
    expect(readDeviceMapFavorites(alice, school)).toEqual(['library']);
  });

  it.each(['save', 'clear'] as const)('rejects the %s receipt when the session changes after the callback but before lock completion', async (action) => {
    seed('library');
    const callbackDone = deferred();
    const release = deferred();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _options: { mode: string }, operation: () => unknown) => {
          const result = operation();
          callbackDone.resolve();
          await release.promise;
          return result;
        },
      },
    });
    let active = true;
    const operation = action === 'save'
      ? setDeviceMapFavorite(alice, school, 'gate', true, () => active)
      : clearDeviceMapFavorites(alice, school, () => active);
    const check = expect(operation).rejects.toMatchObject({ code: 'scope-changed' });
    await callbackDone.promise;
    const committed = action === 'save' ? ['gate', 'library'] : [];
    expect(readDeviceMapFavorites(alice, school)).toEqual(committed);
    active = false;
    release.resolve();
    await check;
    // A stale completion must not roll back a write that has already happened.
    expect(readDeviceMapFavorites(alice, school)).toEqual(committed);
  });

  it('serializes separate module instances using the same scope lock', async () => {
    const request = installLocks();
    vi.resetModules();
    const otherTab = await import('./deviceMapFavorites');
    const first = setDeviceMapFavorite(alice, school, 'library', true, current);
    const second = otherTab.setDeviceMapFavorite(alice, school, 'gate', true, current);
    expect(await first).toEqual(['library']);
    expect(await second).toEqual(['gate', 'library']);
    expect(request.mock.calls.map(([name, options]) => [name, options])).toEqual([
      [deviceMapFavoritesKey(alice, school), { mode: 'exclusive' }],
      [deviceMapFavoritesKey(alice, school), { mode: 'exclusive' }],
    ]);
  });

  it('reports a rejected lock request without claiming a write', async () => {
    const request = installLocks();
    request.mockRejectedValueOnce(new Error('Lock unavailable'));
    await expect(setDeviceMapFavorite(alice, school, 'library', true, current))
      .rejects.toMatchObject({ code: 'storage-unavailable' });
    expect(memory.io.setItem).not.toHaveBeenCalled();
  });
});

describe('explicit scoped clearing', () => {
  it('can clear corrupt entries while preserving other accounts, schools, and adjacent prefixes', async () => {
    memory.values.set(entryKey('library'), '{broken');
    memory.values.set(`${deviceMapFavoritesKey(alice, school)}bad%`, 'bad suffix');
    seed('library', bob);
    seed('library', alice, 'ntu');
    seed('library', alice, 'pu-east');
    await clearDeviceMapFavorites(alice, school, current);
    await clearDeviceMapFavorites(alice, school, current);
    expect(readDeviceMapFavorites(alice, school)).toEqual([]);
    expect(readDeviceMapFavorites(bob, school)).toEqual(['library']);
    expect(readDeviceMapFavorites(alice, 'ntu')).toEqual(['library']);
    expect(readDeviceMapFavorites(alice, 'pu-east')).toEqual(['library']);
    expect(memory.io.removeItem).toHaveBeenCalledTimes(2);
    expect(memory.io.clear).not.toHaveBeenCalled();
  });

  it('reports a partial clearing failure without restoring or claiming all entries were removed', async () => {
    seed('gate');
    seed('library');
    memory.io.removeItem.mockImplementation((key) => {
      if (key === entryKey('library')) throw new Error('Storage denied');
      memory.values.delete(key);
    });
    await expect(clearDeviceMapFavorites(alice, school, current))
      .rejects.toMatchObject({ code: 'write-failed' });
    expect(memory.values.has(entryKey('gate'))).toBe(false);
    expect(memory.values.has(entryKey('library'))).toBe(true);
    expect(memory.io.setItem).not.toHaveBeenCalled();
  });

  it('checks current before each deletion and stops immediately when it changes', async () => {
    seed('gate');
    seed('library');
    let active = true;
    memory.io.removeItem.mockImplementationOnce((key) => {
      memory.values.delete(key);
      active = false;
    });
    await expect(clearDeviceMapFavorites(alice, school, () => active))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(memory.io.removeItem).toHaveBeenCalledTimes(1);
    expect(memory.values.has(entryKey('library'))).toBe(true);
  });

  it('reports an observed concurrent addition without deleting the newly added entry', async () => {
    seed('library');
    memory.io.removeItem.mockImplementationOnce((key) => {
      memory.values.delete(key);
      seed('gate');
    });
    await expect(clearDeviceMapFavorites(alice, school, current))
      .rejects.toMatchObject({ code: 'readback-failed' });
    expect(readDeviceMapFavorites(alice, school)).toEqual(['gate']);
    expect(memory.io.removeItem).toHaveBeenCalledTimes(1);
    expect(memory.io.removeItem).toHaveBeenCalledWith(entryKey('library'));
  });
});
