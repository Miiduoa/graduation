/** Google platform favorites on this browser only; never reads school or guest data. */
const PREFIX = 'campus-one:device-map-favorites:v1:platform:';
const ACCOUNT_ID = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCHOOL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype', '.', '..']);
const ENTRY_RAW_LIMIT = 2048;
const STORAGE_KEY_SCAN_LIMIT = 20_000;

export const DEVICE_MAP_FAVORITES_LIMIT = 500;
/** Bounds use JavaScript string code units, before JSON parsing. */
export const DEVICE_MAP_FAVORITES_RAW_LIMIT = 128 * 1024;

type FailureCode =
  | 'invalid-scope'
  | 'invalid-location'
  | 'scope-changed'
  | 'storage-unavailable'
  | 'storage-changed'
  | 'corrupt-data'
  | 'limit-reached'
  | 'write-failed'
  | 'readback-failed';

export class DeviceMapFavoritesError extends Error {
  constructor(readonly code: FailureCode, message: string) {
    super(message);
    this.name = 'DeviceMapFavoritesError';
  }
}

/** Prefix, including its final separator; storage listeners should use startsWith. */
export function deviceMapFavoritesKey(accountId: string, schoolId: string): string {
  if (
    typeof accountId !== 'string' ||
    accountId.length !== 39 ||
    !ACCOUNT_ID.test(accountId) ||
    typeof schoolId !== 'string' ||
    schoolId.trim() !== schoolId ||
    !SCHOOL_ID.test(schoolId) ||
    RESERVED_IDS.has(schoolId)
  ) {
    throw new DeviceMapFavoritesError('invalid-scope', '地圖收藏的帳號或校園範圍不正確。');
  }
  return `${PREFIX}${accountId}:${schoolId}:`;
}

function validLocationId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    value.trim() !== value ||
    value.includes('/') ||
    value.includes('\\') ||
    RESERVED_IDS.has(value)
  ) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || (code >= 127 && code <= 159)) return false;
  }
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function corruptData(): never {
  throw new DeviceMapFavoritesError(
    'corrupt-data',
    '這份裝置收藏無法讀取，原始資料仍保留。請重新讀取，或明確清除此帳號在本校園的裝置收藏。',
  );
}

function storageChanged(): never {
  throw new DeviceMapFavoritesError('storage-changed', '裝置收藏已由其他分頁更新，請重新讀取後再試。');
}

function storage(): Storage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* Access can be denied before getItem is called. */ }
  throw new DeviceMapFavoritesError('storage-unavailable', '目前無法讀取此瀏覽器的裝置收藏。');
}

function readRaw(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    throw new DeviceMapFavoritesError('storage-unavailable', '目前無法讀取此瀏覽器的裝置收藏。');
  }
}

function scopedKeys(store: Storage, prefix: string): string[] {
  try {
    const length = store.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > STORAGE_KEY_SCAN_LIMIT) {
      throw new DeviceMapFavoritesError('storage-unavailable', '瀏覽器的儲存項目過多，暫時無法完整讀取裝置收藏。');
    }
    const seen = new Set<string>();
    const keys: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = store.key(index);
      if (key === null || seen.has(key)) storageChanged();
      seen.add(key);
      if (key.startsWith(prefix)) keys.push(key);
    }
    if (store.length !== length) storageChanged();
    return keys.sort();
  } catch (error) {
    if (error instanceof DeviceMapFavoritesError) throw error;
    throw new DeviceMapFavoritesError('storage-unavailable', '目前無法完整讀取此瀏覽器的裝置收藏。');
  }
}

function parseEntry(raw: string | null, key: string, prefix: string, accountId: string, schoolId: string): string {
  if (raw === null) storageChanged();
  if (
    typeof raw !== 'string' ||
    raw.length > ENTRY_RAW_LIMIT ||
    key.length > prefix.length + 200 * 9
  ) corruptData();
  let value: unknown;
  let locationId: string;
  try {
    locationId = decodeURIComponent(key.slice(prefix.length));
    value = JSON.parse(raw);
  } catch {
    corruptData();
  }
  if (!validLocationId(locationId) || key !== `${prefix}${encodeURIComponent(locationId)}`) corruptData();
  if (!value || typeof value !== 'object' || Array.isArray(value)) corruptData();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    keys.some((field) => !['version', 'accountId', 'schoolId', 'locationId'].includes(field)) ||
    record.version !== 1 ||
    record.accountId !== accountId ||
    record.schoolId !== schoolId ||
    record.locationId !== locationId
  ) corruptData();
  return locationId;
}

function readScope(store: Storage, prefix: string, accountId: string, schoolId: string) {
  const keys = scopedKeys(store, prefix);
  if (keys.length > DEVICE_MAP_FAVORITES_LIMIT) {
    throw new DeviceMapFavoritesError('limit-reached', '此校園的裝置收藏已超過 500 筆，請明確清除後重新收藏。');
  }
  let rawSize = 0;
  const ids = keys.map((key) => {
    const raw = readRaw(store, key);
    rawSize += raw?.length ?? 0;
    if (rawSize > DEVICE_MAP_FAVORITES_RAW_LIMIT) corruptData();
    return parseEntry(raw, key, prefix, accountId, schoolId);
  });
  const afterKeys = scopedKeys(store, prefix);
  if (keys.length !== afterKeys.length || keys.some((key, index) => key !== afterKeys[index])) {
    storageChanged();
  }
  return { ids, rawSize };
}

export function readDeviceMapFavorites(accountId: string, schoolId: string): string[] {
  const prefix = deviceMapFavoritesKey(accountId, schoolId);
  return readScope(storage(), prefix, accountId, schoolId).ids;
}

function assertCurrent(current: () => boolean): void {
  let active = false;
  try {
    active = current() === true;
  } catch { /* An unavailable identity is never permission to mutate storage. */ }
  if (!active) {
    throw new DeviceMapFavoritesError('scope-changed', '帳號或校園已切換，請重新操作收藏。');
  }
}

async function withScopeLock<T>(prefix: string, operation: () => T): Promise<T> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
      return await navigator.locks.request(prefix, { mode: 'exclusive' }, operation);
    }
    // Separate entry keys keep different locations independent even without Web Locks.
    return operation();
  } catch (error) {
    if (error instanceof DeviceMapFavoritesError) throw error;
    throw new DeviceMapFavoritesError('storage-unavailable', '目前無法更新裝置收藏，請稍後再試。');
  }
}

function unconfirmed(): never {
  throw new DeviceMapFavoritesError('readback-failed', '無法確認裝置收藏的儲存結果，請重新讀取後再試。');
}

export async function setDeviceMapFavorite(
  accountId: string,
  schoolId: string,
  locationId: string,
  saved: boolean,
  current: () => boolean,
): Promise<string[]> {
  const prefix = deviceMapFavoritesKey(accountId, schoolId);
  if (!validLocationId(locationId) || typeof saved !== 'boolean') {
    throw new DeviceMapFavoritesError('invalid-location', '這個地點無法加入裝置收藏。');
  }
  const key = `${prefix}${encodeURIComponent(locationId)}`;
  assertCurrent(current);
  const result = await withScopeLock(prefix, () => {
    assertCurrent(current);
    const store = storage();
    // Removal must remain possible after an unlocked cross-tab capacity race.
    const before = saved ? readScope(store, prefix, accountId, schoolId) : null;
    const existing = readRaw(store, key);
    if (existing !== null) parseEntry(existing, key, prefix, accountId, schoolId);
    const serialized = JSON.stringify({ version: 1, accountId, schoolId, locationId });
    if (serialized.length > ENTRY_RAW_LIMIT || (saved && existing === null && before && (
      before.ids.length >= DEVICE_MAP_FAVORITES_LIMIT ||
      before.rawSize + serialized.length > DEVICE_MAP_FAVORITES_RAW_LIMIT
    ))) {
      throw new DeviceMapFavoritesError('limit-reached', '此校園的裝置收藏已達上限，請先移除一些地點。');
    }
    assertCurrent(current);
    try {
      if (saved && existing === null) store.setItem(key, serialized);
      else if (!saved && existing !== null) store.removeItem(key);
    } catch {
      throw new DeviceMapFavoritesError('write-failed', '無法儲存裝置收藏，請確認瀏覽器的儲存空間與權限後重試。');
    }
    let receipt: string[];
    try {
      receipt = readScope(store, prefix, accountId, schoolId).ids;
      if (receipt.includes(locationId) !== saved) unconfirmed();
    } catch {
      unconfirmed();
    }
    assertCurrent(current);
    return receipt;
  });
  assertCurrent(current);
  return result;
}

/** Explicit recovery only: do not clear automatically after a read error or logout. */
export async function clearDeviceMapFavorites(
  accountId: string,
  schoolId: string,
  current: () => boolean,
): Promise<void> {
  const prefix = deviceMapFavoritesKey(accountId, schoolId);
  assertCurrent(current);
  await withScopeLock(prefix, () => {
    assertCurrent(current);
    const store = storage();
    // This explicit operation can remove malformed entries in exactly this scope.
    const keys = scopedKeys(store, prefix);
    for (const key of keys) {
      assertCurrent(current);
      try {
        store.removeItem(key);
      } catch {
        throw new DeviceMapFavoritesError('write-failed', '無法清除裝置收藏，請確認瀏覽器的儲存權限後重試。');
      }
    }
    try {
      if (scopedKeys(store, prefix).length !== 0) unconfirmed();
    } catch {
      unconfirmed();
    }
    assertCurrent(current);
  });
  assertCurrent(current);
}
