import * as SecureStore from 'expo-secure-store';
import {
  clearAllFoodPendingForAccount,
  clearFoodPending,
  FoodStorageError,
  listFoodPendingScopes,
  loadFoodPending,
  saveFoodPending,
} from '../state/foodPersistence';

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4,
}));

const persisted = new Map<string, string>();
const available = SecureStore.isAvailableAsync as jest.Mock;
const get = SecureStore.getItemAsync as jest.Mock;
const set = SecureStore.setItemAsync as jest.Mock;
const remove = SecureStore.deleteItemAsync as jest.Mock;
const scope = 'food:school-one:location-one:intent';
const intent = (key: string) => ({
  kind: 'order' as const,
  input: { quoteId: 'quote-one', idempotencyKey: key },
});
const validKey = (key: string) => {
  if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid SecureStore key');
};
const write = async (key: string, value: string) => {
  validKey(key);
  persisted.set(key, value);
};
const indexKey = () => [...persisted.keys()].find((key) => key.includes('food-pending-index'))!;
const recordKey = () => [...persisted.keys()].find((key) => key.includes('food-pending.v1'))!;

beforeEach(() => {
  jest.clearAllMocks();
  persisted.clear();
  available.mockResolvedValue(true);
  get.mockImplementation(async (key: string) => {
    validKey(key);
    return persisted.get(key) ?? null;
  });
  set.mockImplementation(write);
  remove.mockImplementation(async (key: string) => {
    validKey(key);
    persisted.delete(key);
  });
});

test('restores the same intent from SecureStore after module reload and a fresh draft Map', async () => {
  await saveFoodPending('pa-a', scope, intent('food-cold-a'));
  let fresh!: typeof import('../state/foodPersistence');
  jest.isolateModules(() => {
    fresh = require('../state/foodPersistence');
  });
  const drafts = new Map();
  drafts.set(scope, await fresh.loadFoodPending('pa-a', scope));
  expect(drafts.get(scope)).toEqual(intent('food-cold-a'));
  expect(await fresh.listFoodPendingScopes('pa-a')).toEqual([scope]);
});

test('keys satisfy the installed SecureStore validator without punctuation or Unicode collisions', async () => {
  for (const [account, value] of [
    ['a:b', 'c'],
    ['a', 'b:c'],
    ['a%b', '校區🍱'],
    ['a_b', '校區%🍱'],
    ['a.b', '\ud800'],
  ]) {
    await saveFoodPending(account, value, intent(`${account}-${value}`));
    expect(await loadFoodPending(account, value)).toEqual(intent(`${account}-${value}`));
  }
  expect([...persisted.keys()].every((key) => /^[\w.-]+$/.test(key))).toBe(true);
  expect([...persisted.keys()].filter((key) => key.includes('food-pending.v1'))).toHaveLength(5);
});

test('isolates accounts and clears only the targeted scope', async () => {
  await saveFoodPending('pa-a', scope, intent('food-a'));
  await saveFoodPending('pa-a', 'merchant-food:school:other', intent('food-sibling'));
  await saveFoodPending('pa-b', scope, intent('food-b'));
  await clearFoodPending('pa-a', scope);
  expect(await loadFoodPending('pa-a', scope)).toBeNull();
  expect(await loadFoodPending('pa-a', 'merchant-food:school:other')).toEqual(
    intent('food-sibling'),
  );
  await clearAllFoodPendingForAccount('pa-a');
  expect(await loadFoodPending('pa-b', scope)).toEqual(intent('food-b'));
});

test('unavailable SecureStore rejects read, write and deletion with no fallback', async () => {
  await saveFoodPending('pa-a', scope, intent('food-a'));
  const before = new Map(persisted);
  available.mockResolvedValue(false);
  for (const operation of [
    () => loadFoodPending('pa-a', scope),
    () => saveFoodPending('pa-a', scope, intent('food-a')),
    () => clearFoodPending('pa-a', scope),
    () => clearAllFoodPendingForAccount('pa-a'),
    () => listFoodPendingScopes('pa-a'),
  ])
    await expect(operation()).rejects.toBeInstanceOf(FoodStorageError);
  expect(persisted).toEqual(before);
});

test('read and write rejection block persistence without claiming success', async () => {
  get.mockRejectedValueOnce(new Error('keychain unavailable'));
  await expect(loadFoodPending('pa-a', scope)).rejects.toBeInstanceOf(FoodStorageError);
  set.mockRejectedValueOnce(new Error('keychain unavailable'));
  await expect(saveFoodPending('pa-a', scope, intent('food-a'))).rejects.toBeInstanceOf(
    FoodStorageError,
  );
  expect(await loadFoodPending('pa-a', scope)).toBeNull();
});

test('retry index read or write failure keeps the original pending intent', async () => {
  const original = intent('food-original');
  await saveFoodPending('pa-a', scope, original);
  const key = recordKey();
  const raw = persisted.get(key);
  const index = indexKey();
  get
    .mockImplementationOnce(async (readKey: string) => persisted.get(readKey) ?? null)
    .mockRejectedValueOnce(new Error('index read failed'));
  await expect(saveFoodPending('pa-a', scope, original)).rejects.toBeInstanceOf(FoodStorageError);
  expect(persisted.get(key)).toBe(raw);
  persisted.delete(index);
  set.mockRejectedValueOnce(new Error('index write failed'));
  await expect(saveFoodPending('pa-a', scope, original)).rejects.toBeInstanceOf(FoodStorageError);
  expect(persisted.get(key)).toBe(raw);
  expect(await loadFoodPending('pa-a', scope)).toEqual(original);
});

test('an unresolved scope cannot be overwritten with a different intent or idempotency key', async () => {
  await saveFoodPending('pa-a', scope, intent('food-original'));
  const before = new Map(persisted);
  await expect(saveFoodPending('pa-a', scope, intent('food-new'))).rejects.toBeInstanceOf(
    FoodStorageError,
  );
  expect(persisted).toEqual(before);
  set.mockClear();
  await saveFoodPending('pa-a', scope, intent('food-original'));
  expect(set).not.toHaveBeenCalled();
});

test('a queued save snapshots its intent before the caller can mutate it', async () => {
  const value = intent('food-original');
  const saving = saveFoodPending('pa-a', scope, value);
  value.input.idempotencyKey = 'food-replacement';
  await saving;
  expect(await loadFoodPending('pa-a', scope)).toEqual(intent('food-original'));
});

test.each(['', '{broken', 'null', '[""]'])(
  'damaged index blocks loading and saving instead of acting empty: %s',
  async (raw) => {
    await saveFoodPending('pa-a', scope, intent('food-original'));
    persisted.set(indexKey(), raw);
    await expect(loadFoodPending('pa-a', 'different-scope')).rejects.toBeInstanceOf(
      FoodStorageError,
    );
    await expect(saveFoodPending('pa-a', scope, intent('food-original'))).rejects.toBeInstanceOf(
      FoodStorageError,
    );
    expect(persisted.get(recordKey())).toContain('food-original');
  },
);

test('damaged record cannot be overwritten by a new save', async () => {
  await saveFoodPending('pa-a', scope, intent('food-original'));
  const key = recordKey();
  persisted.set(key, '');
  await expect(loadFoodPending('pa-a', scope)).rejects.toBeInstanceOf(FoodStorageError);
  await expect(saveFoodPending('pa-a', scope, intent('food-new'))).rejects.toBeInstanceOf(
    FoodStorageError,
  );
  expect(persisted.get(key)).toBe('');
});

test('concurrent scopes keep both index entries and logout removes both records', async () => {
  await Promise.all([
    saveFoodPending('pa-a', scope, intent('food-a')),
    saveFoodPending('pa-a', 'merchant-food:school:other', intent('food-other')),
  ]);
  expect((await listFoodPendingScopes('pa-a')).sort()).toEqual(
    [scope, 'merchant-food:school:other'].sort(),
  );
  await clearAllFoodPendingForAccount('pa-a');
  expect(persisted.size).toBe(0);
});

test('logout during a delayed record write prevents success and removes its own late key', async () => {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  set.mockImplementation(async (key: string, value: string) => {
    if (key.includes('food-pending.v1')) {
      entered();
      await blocked;
    }
    await write(key, value);
  });
  const saving = saveFoodPending('pa-a', scope, intent('food-late'));
  const rejected = expect(saving).rejects.toBeInstanceOf(FoodStorageError);
  await writing;
  const logout = clearAllFoodPendingForAccount('pa-a');
  release();
  await rejected;
  await logout;
  expect(persisted.size).toBe(0);
});
