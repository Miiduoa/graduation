import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearAllFoodPendingForAccount,
  clearFoodPending,
  foodPendingStorageKey,
  listFoodPendingScopes,
  loadFoodPending,
  saveFoodPending,
  FoodStorageError,
} from './foodPersistence';
import type { FoodIntent } from './foodState';

const intent = (key = 'food-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'): FoodIntent => ({
  action: 'order',
  input: { quoteId: 'quote-1', idempotencyKey: key },
});

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('persists and restores the same idempotency key after a fresh Map / module reload', async () => {
  const scope = 'food:cart:campus-one:store-1';
  const first = intent();
  saveFoodPending('account-a', scope, first);
  expect(loadFoodPending('account-a', scope)).toEqual(first);
  expect(listFoodPendingScopes('account-a')).toEqual([scope]);
  vi.resetModules();
  const fresh = await import('./foodPersistence');
  const drafts = new Map();
  drafts.set(scope, fresh.loadFoodPending('account-a', scope));
  const restored = drafts.get(scope);
  expect(restored?.input.idempotencyKey).toBe(first.input.idempotencyKey);
  expect(restored).toEqual(first);
});

it('isolates pending intents across platform accounts', () => {
  const scope = 'food:cart:campus-one:store-1';
  saveFoodPending('account-a', scope, intent('food-key-a'));
  saveFoodPending('account-b', scope, intent('food-key-b'));
  expect(loadFoodPending('account-a', scope)?.input.idempotencyKey).toBe('food-key-a');
  expect(loadFoodPending('account-b', scope)?.input.idempotencyKey).toBe('food-key-b');
  clearAllFoodPendingForAccount('account-a');
  expect(loadFoodPending('account-a', scope)).toBeNull();
  expect(loadFoodPending('account-b', scope)?.input.idempotencyKey).toBe('food-key-b');
  expect(sessionStorage.getItem(foodPendingStorageKey('account-a', scope))).toBeNull();
});

it('blocks writes when sessionStorage is unavailable and does not pretend success', () => {
  const probe = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => saveFoodPending('account-a', 'food:cart:t:l', intent())).toThrow(FoodStorageError);
  probe.mockRestore();
  expect(loadFoodPending('account-a', 'food:cart:t:l')).toBeNull();
});

it('rejects corrupted records instead of returning a fake intent', () => {
  const scope = 'food:order:campus-one:order-1';
  sessionStorage.setItem(
    foodPendingStorageKey('account-a', scope),
    JSON.stringify({ version: 1, accountId: 'account-a', scope, intent: 'nope' }),
  );
  expect(() => loadFoodPending('account-a', scope)).toThrow(FoodStorageError);
});

it('clears only the targeted scope and keeps sibling locations', () => {
  saveFoodPending('account-a', 'merchant-food:campus-one:store-1', intent('food-1'));
  saveFoodPending('account-a', 'merchant-food:campus-one:store-2', intent('food-2'));
  clearFoodPending('account-a', 'merchant-food:campus-one:store-1');
  expect(loadFoodPending('account-a', 'merchant-food:campus-one:store-1')).toBeNull();
  expect(
    loadFoodPending('account-a', 'merchant-food:campus-one:store-2')?.input.idempotencyKey,
  ).toBe('food-2');
});

const findIndex = () =>
  Object.keys(sessionStorage).find((key) => key.startsWith('campus-one:food-pending-index:'))!;

it('rejects storage read failure instead of interpreting it as no pending operation', () => {
  saveFoodPending('account-a', 'food:cart:t:l', intent());
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  expect(() => loadFoodPending('account-a', 'food:cart:t:l')).toThrow(FoodStorageError);
  expect(() => saveFoodPending('account-a', 'food:cart:t:l', intent())).toThrow(FoodStorageError);
  spy.mockRestore();
  expect(loadFoodPending('account-a', 'food:cart:t:l')).toEqual(intent());
});

it('retry index read or write failure preserves the original unresolved operation', () => {
  const scope = 'food:cart:t:l';
  const original = intent('food-original');
  saveFoodPending('account-a', scope, original);
  const key = foodPendingStorageKey('account-a', scope);
  const raw = sessionStorage.getItem(key);
  const index = findIndex();
  const get = Storage.prototype.getItem;
  const readSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (key === index) throw new Error('index read failed');
    return get.call(this, key);
  });
  expect(() => saveFoodPending('account-a', scope, original)).toThrow(FoodStorageError);
  readSpy.mockRestore();
  expect(sessionStorage.getItem(key)).toBe(raw);
  sessionStorage.removeItem(index);
  const set = Storage.prototype.setItem;
  const writeSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === index) throw new Error('index write failed');
    return set.call(this, key, value);
  });
  expect(() => saveFoodPending('account-a', scope, original)).toThrow(FoodStorageError);
  writeSpy.mockRestore();
  expect(sessionStorage.getItem(key)).toBe(raw);
  expect(loadFoodPending('account-a', scope)).toEqual(original);
});

it('rejects replacing an unresolved intent and never rewrites a retry record', () => {
  const scope = 'food:cart:t:l';
  saveFoodPending('account-a', scope, intent('food-original'));
  const key = foodPendingStorageKey('account-a', scope);
  const raw = sessionStorage.getItem(key);
  expect(() => saveFoodPending('account-a', scope, intent('food-replacement'))).toThrow(
    FoodStorageError,
  );
  expect(sessionStorage.getItem(key)).toBe(raw);
  const spy = vi.spyOn(Storage.prototype, 'setItem');
  saveFoodPending('account-a', scope, intent('food-original'));
  expect(spy.mock.calls.some(([written]) => written === key)).toBe(false);
});

it.each(['', '{broken', 'null', '[""]'])(
  'damaged index blocks new mutations and reads: %s',
  (raw) => {
    const scope = 'food:cart:t:l';
    saveFoodPending('account-a', scope, intent('food-original'));
    sessionStorage.setItem(findIndex(), raw);
    expect(() => loadFoodPending('account-a', 'different-scope')).toThrow(FoodStorageError);
    expect(() => saveFoodPending('account-a', scope, intent('food-original'))).toThrow(
      FoodStorageError,
    );
    expect(sessionStorage.getItem(foodPendingStorageKey('account-a', scope))).toContain(
      'food-original',
    );
  },
);

it('damaged empty record is not absent and cannot be overwritten', () => {
  const scope = 'food:cart:t:l';
  const key = foodPendingStorageKey('account-a', scope);
  sessionStorage.setItem(key, '');
  expect(() => loadFoodPending('account-a', scope)).toThrow(FoodStorageError);
  expect(() => saveFoodPending('account-a', scope, intent())).toThrow(FoodStorageError);
  expect(sessionStorage.getItem(key)).toBe('');
});
