import type { FoodIntent } from './foodState';

const PREFIX = 'campus-one:food-pending:v1:';
const INDEX_PREFIX = 'campus-one:food-pending-index:v1:';

export class FoodStorageError extends Error {
  constructor(message = '目前無法安全保存這次訂餐操作，請稍後再試。') {
    super(message);
    this.name = 'FoodStorageError';
  }
}

type StoredRecord = {
  version: 1;
  accountId: string;
  scope: string;
  intent: FoodIntent;
};

function assertBrowserStorage(): Storage {
  try {
    const storage = window.sessionStorage;
    const probe = `${PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    throw new FoodStorageError();
  }
}

export function foodPendingStorageKey(accountId: string, scope: string) {
  return `${PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(scope)}`;
}

function indexKey(accountId: string) {
  return `${INDEX_PREFIX}${encodeURIComponent(accountId)}`;
}

function readIndex(storage: Storage, accountId: string): string[] {
  const raw = storage.getItem(indexKey(accountId));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new FoodStorageError('訂餐重試資料已損毀，請重新登入後再操作。');
    }
    return parsed;
  } catch (error) {
    if (error instanceof FoodStorageError) throw error;
    throw new FoodStorageError('訂餐重試資料已損毀，請重新登入後再操作。');
  }
}

function writeIndex(storage: Storage, accountId: string, scopes: string[]) {
  const unique = [...new Set(scopes)];
  if (!unique.length) storage.removeItem(indexKey(accountId));
  else storage.setItem(indexKey(accountId), JSON.stringify(unique));
}

function parseRecord(raw: string, accountId: string, scope: string): FoodIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FoodStorageError('訂餐重試資料已損毀，請重新登入後再操作。');
  }
  const record = parsed as StoredRecord;
  if (
    !record ||
    record.version !== 1 ||
    record.accountId !== accountId ||
    record.scope !== scope ||
    !record.intent ||
    typeof record.intent !== 'object' ||
    Array.isArray(record.intent) ||
    typeof record.intent.action !== 'string' ||
    !record.intent.input ||
    typeof record.intent.input !== 'object' ||
    Array.isArray(record.intent.input)
  ) {
    throw new FoodStorageError('訂餐重試資料已損毀，請重新登入後再操作。');
  }
  return structuredClone(record.intent);
}

/** Durable save must succeed before any network mutation. */
export function saveFoodPending(accountId: string, scope: string, intent: FoodIntent): void {
  if (!accountId || !scope) throw new FoodStorageError();
  const storage = assertBrowserStorage();
  const key = foodPendingStorageKey(accountId, scope);
  const record: StoredRecord = {
    version: 1,
    accountId,
    scope,
    intent: structuredClone(intent),
  };
  try {
    const encoded = JSON.stringify(record);
    const frozen = parseRecord(encoded, accountId, scope);
    const existing = storage.getItem(key);
    if (
      existing !== null &&
      JSON.stringify(parseRecord(existing, accountId, scope)) !== JSON.stringify(frozen)
    ) {
      throw new FoodStorageError('這筆操作尚未確認，請先重試原本的操作。');
    }
    const scopes = readIndex(storage, accountId);
    // Index first so a partially failed new write remains discoverable for logout.
    // A retry never rewrites the unresolved intent or replaces its idempotency key.
    if (!scopes.includes(scope)) writeIndex(storage, accountId, [...scopes, scope]);
    if (existing === null) storage.setItem(key, encoded);
    const verify = storage.getItem(key);
    if (
      verify === null ||
      JSON.stringify(parseRecord(verify, accountId, scope)) !== JSON.stringify(frozen) ||
      !readIndex(storage, accountId).includes(scope)
    )
      throw new FoodStorageError();
  } catch (error) {
    if (error instanceof FoodStorageError) throw error;
    throw new FoodStorageError();
  }
}

export function loadFoodPending(accountId: string, scope: string): FoodIntent | null {
  if (!accountId || !scope) return null;
  try {
    const storage = assertBrowserStorage();
    readIndex(storage, accountId);
    const raw = storage.getItem(foodPendingStorageKey(accountId, scope));
    return raw === null ? null : parseRecord(raw, accountId, scope);
  } catch (error) {
    if (error instanceof FoodStorageError) throw error;
    throw new FoodStorageError();
  }
}

export function clearFoodPending(accountId: string, scope: string): void {
  if (!accountId || !scope) return;
  const storage = assertBrowserStorage();
  const scopes = readIndex(storage, accountId);
  storage.removeItem(foodPendingStorageKey(accountId, scope));
  writeIndex(
    storage,
    accountId,
    scopes.filter((entry) => entry !== scope),
  );
}

/** Logout / confirmed identity leave: only this feature's keys. */
export function clearAllFoodPendingForAccount(accountId: string): void {
  if (!accountId) return;
  try {
    const storage = assertBrowserStorage();
    const scopes = readIndex(storage, accountId);
    for (const scope of scopes) storage.removeItem(foodPendingStorageKey(accountId, scope));
    storage.removeItem(indexKey(accountId));
    const prefix = `${PREFIX}${encodeURIComponent(accountId)}:`;
    const doomed: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch (error) {
    if (error instanceof FoodStorageError) throw error;
    throw new FoodStorageError();
  }
}

export function listFoodPendingScopes(accountId: string): string[] {
  if (!accountId) return [];
  const storage = assertBrowserStorage();
  return readIndex(storage, accountId);
}

export const FOOD_TERMINAL_STATES = new Set([
  'fulfilled',
  'canceled',
  'rejected',
  'payment-expired',
]);

export const FOOD_POLL_MS = 10_000;
