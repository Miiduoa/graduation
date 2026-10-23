import * as SecureStore from 'expo-secure-store';

const PREFIX = 'campus-one.food-pending.v1.';
const INDEX_PREFIX = 'campus-one.food-pending-index.v1.';
const queues = new Map<string, Promise<void>>();
const logoutGeneration = new Map<string, number>();

export class FoodStorageError extends Error {
  constructor(message = '目前無法安全保存這次訂餐操作，請稍後再試。') {
    super(message);
    this.name = 'FoodStorageError';
  }
}

export type FoodPersistedIntent = {
  version: 1;
  accountId: string;
  scope: string;
  intent: unknown;
};

// Fixed-width UTF-16 code units are injective even for punctuation, Unicode and
// unpaired surrogates; every resulting SecureStore key matches /^[\w.-]+$/.
function encodeKey(value: string): string {
  return value
    .split('')
    .map((unit) => unit.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
}

function storageKey(accountId: string, scope: string) {
  return `${PREFIX}${encodeKey(accountId)}.${encodeKey(scope)}`;
}

function indexStorageKey(accountId: string) {
  return `${INDEX_PREFIX}${encodeKey(accountId)}`;
}

function serialized<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
  const task = (queues.get(accountId) ?? Promise.resolve()).then(operation).catch((error) => {
    if (error instanceof FoodStorageError) throw error;
    throw new FoodStorageError();
  });
  const settled = task.then(
    () => undefined,
    () => undefined,
  );
  queues.set(accountId, settled);
  void settled.then(() => {
    if (queues.get(accountId) === settled) queues.delete(accountId);
  });
  return task;
}

async function requireSecureStore() {
  if (!(await SecureStore.isAvailableAsync())) throw new FoodStorageError();
}

async function read(key: string): Promise<string | null> {
  await requireSecureStore();
  const value = await SecureStore.getItemAsync(key);
  if (value !== null && typeof value !== 'string') throw new FoodStorageError();
  return value;
}

async function write(key: string, value: string) {
  await requireSecureStore();
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function remove(key: string) {
  await requireSecureStore();
  await SecureStore.deleteItemAsync(key);
}

function damaged(): never {
  throw new FoodStorageError('訂餐重試資料已損毀，請重新登入後再操作。');
}

async function readIndex(accountId: string): Promise<string[]> {
  const raw = await read(indexStorageKey(accountId));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string' || !entry))
      damaged();
    return parsed as string[];
  } catch {
    return damaged();
  }
}

async function writeIndex(accountId: string, scopes: string[]) {
  const unique = [...new Set(scopes)];
  if (!unique.length) await remove(indexStorageKey(accountId));
  else await write(indexStorageKey(accountId), JSON.stringify(unique));
}

function parseRecord(raw: string, accountId: string, scope: string): unknown {
  try {
    const record = JSON.parse(raw) as FoodPersistedIntent;
    if (
      !record ||
      record.version !== 1 ||
      record.accountId !== accountId ||
      record.scope !== scope ||
      !record.intent ||
      typeof record.intent !== 'object' ||
      Array.isArray(record.intent)
    )
      damaged();
    return record.intent;
  } catch {
    return damaged();
  }
}

/** Must succeed before any network mutation; no memory or AsyncStorage fallback. */
export async function saveFoodPending(
  accountId: string,
  scope: string,
  intent: unknown,
): Promise<void> {
  if (!accountId || !scope) throw new FoodStorageError();
  const generation = logoutGeneration.get(accountId) ?? 0;
  let encoded: string;
  try {
    encoded = JSON.stringify({ version: 1, accountId, scope, intent });
  } catch {
    throw new FoodStorageError();
  }
  return serialized(accountId, async () => {
    if ((logoutGeneration.get(accountId) ?? 0) !== generation) throw new FoodStorageError();
    const key = storageKey(accountId, scope);
    const frozen = parseRecord(encoded, accountId, scope);
    const raw = await read(key);
    if (
      raw !== null &&
      JSON.stringify(parseRecord(raw, accountId, scope)) !== JSON.stringify(frozen)
    ) {
      throw new FoodStorageError('這筆操作尚未確認，請先重試原本的操作。');
    }
    const scopes = await readIndex(accountId);
    // Index first: even a late or partially failed record write remains discoverable
    // for logout cleanup. Never rewrite or remove an existing pending intent on retry.
    if (!scopes.includes(scope)) await writeIndex(accountId, [...scopes, scope]);
    if (raw === null) await write(key, encoded);
    const verify = await read(key);
    if (
      verify === null ||
      JSON.stringify(parseRecord(verify, accountId, scope)) !== JSON.stringify(frozen) ||
      !(await readIndex(accountId)).includes(scope)
    )
      throw new FoodStorageError();
    if ((logoutGeneration.get(accountId) ?? 0) !== generation) {
      await remove(key);
      throw new FoodStorageError();
    }
  });
}

export async function loadFoodPending(accountId: string, scope: string): Promise<unknown | null> {
  if (!accountId || !scope) return null;
  return serialized(accountId, async () => {
    // A damaged index must block new mutations, even when this scope has no record.
    await readIndex(accountId);
    const raw = await read(storageKey(accountId, scope));
    return raw === null ? null : parseRecord(raw, accountId, scope);
  });
}

export async function clearFoodPending(accountId: string, scope: string): Promise<void> {
  if (!accountId || !scope) return;
  return serialized(accountId, async () => {
    const scopes = await readIndex(accountId);
    await remove(storageKey(accountId, scope));
    await writeIndex(
      accountId,
      scopes.filter((entry) => entry !== scope),
    );
  });
}

/** Logout waits for earlier writes and invalidates their success before clearing owned keys. */
export async function clearAllFoodPendingForAccount(accountId: string): Promise<void> {
  if (!accountId) return;
  logoutGeneration.set(accountId, (logoutGeneration.get(accountId) ?? 0) + 1);
  return serialized(accountId, async () => {
    const scopes = await readIndex(accountId);
    for (const scope of scopes) await remove(storageKey(accountId, scope));
    await remove(indexStorageKey(accountId));
  });
}

export async function listFoodPendingScopes(accountId: string): Promise<string[]> {
  if (!accountId) return [];
  return serialized(accountId, () => readIndex(accountId));
}

export const FOOD_TERMINAL_STATES = new Set([
  'fulfilled',
  'canceled',
  'rejected',
  'payment-expired',
]);

export const FOOD_POLL_MS = 10_000;
