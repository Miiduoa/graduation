import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPersonalImportId } from '@campus/shared';
import { File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';
const journalPrefix = 'campus.personal-imports.rollback.v1:';
const legacyStagePattern = /^campus\.personal-imports\.rollback\.v1:([a-f0-9]{64}):stage:\d+:[^:]+$/;

// One atomic browser storage entry contains both the recovery marker and the payload.
function webJournalKey(key: string) {
  return journalPrefix + sha256(key);
}

type WebRollback = {
  id: string;
  original: string | null;
  before: string;
  attempted: string;
};

const fingerprint = (raw: string | null) => sha256(raw ?? 'null');

const lockStore = 'writes';
const stagePrefix = 'campus.personal-imports.stage.v2:';
const activeStages = new Set<string>();
const leasePrefix = 'campus.personal-imports.write.v1:';
const leaseDuration = 30_000;
const leasePattern = /^campus\.personal-imports\.write\.v1:([a-f0-9]{64}):[^:]+$/;

function isLiveLease(value: string | null): boolean {
  if (value === null) return false;
  const expires = Number(value);
  const now = Date.now();
  return Number.isSafeInteger(expires) && expires > now && expires <= now + leaseDuration;
}

function hasLiveWriter(storage: Storage, hash: string): boolean {
  return Object.keys(storage).some((entry) =>
    leasePattern.exec(entry)?.[1] === hash && isLiveLease(storage.getItem(entry)));
}

function sweepExpiredLeases(storage: Storage): void {
  for (const entry of Object.keys(storage)) {
    if (!leasePattern.test(entry)) continue;
    const value = storage.getItem(entry);
    if (value !== null && !isLiveLease(value) && storage.getItem(entry) === value) {
      storage.removeItem(entry);
    }
  }
}

type BrowserWrite<T> = (assertLockHeld: () => void, leaseQuotaError?: DOMException) => Promise<T>;

function isQuotaExceeded(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

async function writeWithLease<T>(
  ledgerHash: string,
  write: BrowserWrite<T>,
): Promise<T> {
  const storage = window.localStorage;
  // Reclaim existing entries before reserving even the small lease at quota.
  await sweepLegacyStages();
  sweepExpiredLeases(storage);

  const leaseKey = leasePrefix + ledgerHash + ':' + createPersonalImportId();
  const lostLease = new Error('匯入資料的寫入標記已失效，請稍後再試。');
  let value = String(Date.now() + leaseDuration);
  let stopped = false;
  let leaseQuotaError: DOMException | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const assertLease = () => {
    if (stopped || !isLiveLease(value) ||
        (!leaseQuotaError && storage.getItem(leaseKey) !== value)) throw lostLease;
  };
  const stop = () => {
    stopped = true;
    clearInterval(heartbeat);
    try {
      if (storage.getItem(leaseKey) === value) storage.removeItem(leaseKey);
    } catch {
      // A marker the browser won't remove still expires.
    }
  };

  try {
    window.addEventListener('pagehide', stop);
    try {
      storage.setItem(leaseKey, value);
    } catch (error) {
      if (!isQuotaExceeded(error)) throw error;
      // Without a persisted lease this attempt may only publish a shrinking
      // replacement atomically. It cannot create or reuse a recovery stage.
      leaseQuotaError = error;
    }
    assertLease();
    if (leaseQuotaError) return await write(assertLease, leaseQuotaError);
    heartbeat = setInterval(() => {
      try {
        assertLease();
        const next = String(Date.now() + leaseDuration);
        storage.setItem(leaseKey, next);
        value = next;
        assertLease();
      } catch {
        stop();
      }
    }, leaseDuration / 3);
    return await write(assertLease);
  } finally {
    window.removeEventListener('pagehide', stop);
    stop();
  }
}

async function openWriteLockDatabase(ledgerHash: string): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`campus.personal-imports.locks:${ledgerHash}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(lockStore);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Some browser configurations allow localStorage while disabling IndexedDB.
    return undefined;
  }
}

// Older builds staged in origin-wide storage. Respect the original per-ledger
// locks when available and the attempt leases used by writers without a lock.
async function sweepLegacyStages(ledgerHash?: string): Promise<void> {
  const storage = window.localStorage;
  const stages = new Map<string, Map<string, string>>();
  for (const entry of Object.keys(storage)) {
    const hash = legacyStagePattern.exec(entry)?.[1];
    if (!hash) continue;
    const value = storage.getItem(entry);
    if (value === null) continue;
    const entries = stages.get(hash) ?? new Map<string, string>();
    entries.set(entry, value);
    stages.set(hash, entries);
  }
  await Promise.all([...stages].map(async ([hash, entries]) => {
    const remove = () => {
      for (const [entry, value] of entries) {
        // The legacy key has no lease ID. Any live attempt for its ledger may
        // own it. Recheck both the captured copy and ownership before deletion.
        if (storage.getItem(entry) === value && !hasLiveWriter(storage, hash) &&
            storage.getItem(entry) === value) storage.removeItem(entry);
      }
    };
    if (hash === ledgerHash || (typeof indexedDB === 'undefined' && !navigator.locks)) {
      remove();
      return;
    }
    if (navigator.locks) {
      await navigator.locks.request(journalPrefix + hash, { ifAvailable: true }, (lock) => {
        if (lock) remove();
      });
      return;
    }
    await sweepLegacyIndexedDBStages(hash, remove, ledgerHash === undefined);
  }));
}

async function sweepLegacyIndexedDBStages(
  hash: string,
  remove: () => void,
  allowUnlockedSweep: boolean,
): Promise<void> {
  // IndexedDB has no try-lock. Bound the probe so another ledger's active
  // transaction cannot make this ledger wait for its mutation to finish.
  let expired = false;
  let transaction: IDBTransaction | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = async () => {
    const database = await openWriteLockDatabase(hash);
    if (!database) {
      if (!expired && allowUnlockedSweep) remove();
      return;
    }
    try {
      if (expired) return;
      await new Promise<void>((resolve, reject) => {
        transaction = database.transaction(lockStore, 'readwrite');
        transaction.onabort = () => resolve();
        transaction.oncomplete = () => resolve();
        transaction.objectStore(lockStore).get('lock').onsuccess = () => {
          if (expired) return;
          try {
            remove();
          } catch (error) {
            reject(error);
          }
        };
      });
    } finally {
      database.close();
    }
  };
  try {
    await Promise.race([probe(), new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        resolve();
        try {
          transaction?.abort();
        } catch {
          // The probe already finished.
        }
      }, 100);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const noLockCheck = () => {};

export async function withPersonalImportWriteLock<T>(
  key: string,
  write: BrowserWrite<T>,
): Promise<T> {
  if (Platform.OS !== 'web') return write(noLockCheck);
  const ledgerHash = sha256(key);
  const writeWithCleanup = async (assertLockHeld: () => void) => {
    await sweepLegacyStages(ledgerHash);
    sweepExpiredLeases(window.localStorage);
    assertLockHeld();
    return write(assertLockHeld);
  };
  if (navigator.locks) {
    return navigator.locks.request(journalPrefix + ledgerHash, () => writeWithCleanup(noLockCheck));
  }

  // IndexedDB serializes readwrite transactions by object store. Use a
  // database per ledger so opening a new ledger also needs no shared upgrade.
  const database = await openWriteLockDatabase(ledgerHash);
  if (!database) return writeWithLease(ledgerHash, write);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(lockStore, 'readwrite');
      const store = transaction.objectStore(lockStore);
      let operation: Promise<T> | undefined;
      let finished = false;
      let aborted: Error | undefined;
      const assertLockHeld = () => {
        if (aborted) throw aborted;
      };
      const keepLock = () => {
        if (finished) return;
        store.get('lock').onsuccess = () => {
          if (finished) return;
          if (!operation) {
            operation = writeWithCleanup(assertLockHeld).finally(() => { finished = true; });
            // Observe rejection immediately. Deliver the result after releasing the lock.
            void operation.catch(() => undefined);
          }
          keepLock();
        };
      };
      transaction.onabort = () => {
        aborted = transaction.error ?? new Error('匯入資料的寫入鎖定已中止，請稍後再試。');
        finished = true;
        reject(aborted);
      };
      transaction.oncomplete = () => {
        if (operation) operation.then(resolve, reject);
        else reject(new Error('無法取得匯入資料的寫入鎖定。'));
      };
      keepLock();
    });
  } finally {
    database.close();
  }
}

async function readWebRollback(key: string): Promise<string | undefined> {
  const storage = window.localStorage;
  const backupKey = webJournalKey(key);
  for (;;) {
    const encoded = storage.getItem(backupKey);
    if (encoded === null) return undefined;
    const journal = JSON.parse(encoded) as WebRollback | { version: number } | null;
    // Older Web builds stored the ledger bytes directly.
    if (journal === null || (typeof journal === 'object' && 'version' in journal)) return encoded;
    if (!journal || typeof journal !== 'object' || !('id' in journal) ||
        typeof journal.id !== 'string' || typeof journal.before !== 'string' ||
        typeof journal.attempted !== 'string' ||
        (journal.original !== null && typeof journal.original !== 'string')) {
      throw new Error('儲存的匯入資料還原副本無法讀取，請稍後重試。');
    }
    const current = fingerprint(await AsyncStorage.getItem(key));
    if (storage.getItem(backupKey) !== encoded) continue;
    return current === journal.before || current === journal.attempted
      ? journal.original ?? 'null'
      : undefined;
  }
}

export function hasWebPersonalImportCommit(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && typeof value.webCommit === 'string';
  } catch {
    // The ledger parser reports invalid primary data if there is no recovery copy.
    return false;
  }
}

function sweepSessionStages(storage: Storage): void {
  for (const entry of Object.keys(storage)) {
    if (entry.startsWith(stagePrefix) && !activeStages.has(entry)) storage.removeItem(entry);
  }
}

export function commitWebPersonalImports(
  key: string,
  before: string | null,
  attempted: string,
  assertWritable: () => void,
  recovery?: { raw: string | null },
  leaseQuotaError?: DOMException,
): string {
  const storage = window.localStorage;
  const id = createPersonalImportId();
  const committed = JSON.stringify({ ...JSON.parse(attempted), webCommit: id });
  const conflict = () => new Error('匯入資料已在另一個分頁更新，請重新載入。');
  const shrinking = before !== null && attempted.length < before.length;
  const publish = (ownsStage = () => true) => {
    const replace = (raw: string) => {
      assertWritable();
      if (!ownsStage() || storage.getItem(key) !== before) throw conflict();
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw conflict();
      return raw;
    };
    try {
      // The primary stays authoritative until this single publication. Its new
      // generation also retires legacy recovery data without clearing shared keys.
      return replace(committed);
    } catch (error) {
      if (!isQuotaExceeded(error) || !shrinking ||
          storage.getItem(webJournalKey(key)) !== null) throw error;
      // Pre-generation ledgers may only have room for the replacement bytes.
      // With no legacy journal the plain ledger is already authoritative.
      return replace(attempted);
    }
  };
  if (!recovery && !leaseQuotaError) return publish();

  const stages = window.sessionStorage;
  sweepSessionStages(stages);
  if (leaseQuotaError) {
    if (!shrinking) throw leaseQuotaError;
    return publish();
  }

  // This attempt owns a private, verbatim copy. Encoding it as a JSON string
  // would expand every quote and backslash and consume extra session quota.
  const stageKey = stagePrefix + id;
  const encoded = recovery?.raw ?? 'null';
  const ownsStage = () => stages.getItem(stageKey) === encoded;
  assertWritable();
  activeStages.add(stageKey);
  try {
    try {
      stages.setItem(stageKey, encoded);
    } catch (error) {
      if (!isQuotaExceeded(error) || !shrinking) throw error;
      // A single atomic replacement leaves the original intact on failure.
      return publish();
    }
    return publish(ownsStage);
  } finally {
    // Stages are private to an attempt and are never read for recovery.
    // Reclaim this stage even if another tab has already published.
    try {
      if (ownsStage()) stages.removeItem(stageKey);
    } catch {
      // An abandoned stage is inert and can be reclaimed by a later write.
    } finally {
      activeStages.delete(stageKey);
    }
  }
}

function journalFiles(key: string) {
  const directory = Paths.document;
  // An existing legacy marker remains authoritative until its write commits.
  // The escaped storage key is ASCII, so its length is also its byte count.
  const legacyName = key.replace(/[%:~]/g, (character) => `~${character.charCodeAt(0).toString(16)}`);
  if (legacyName.length + markerSuffix.length <= 255) {
    const marker = new File(directory, legacyName + markerSuffix);
    if (marker.info().exists) {
      return { marker, payload: new File(directory, `${legacyName}.rollback.json`), marked: true };
    }
  }

  const name = `personal-imports-${sha256(key)}`;
  const marker = new File(directory, name + markerSuffix);
  return { marker, payload: new File(directory, `${name}.rollback.json`), marked: marker.info().exists };
}

export async function readPersonalImportRollback(key: string): Promise<string | undefined> {
  // Expo's Web implementation cannot construct a Directory or File.
  if (Platform.OS === 'web') return readWebRollback(key);
  const { payload, marked } = journalFiles(key);
  return marked ? payload.textSync() : undefined;
}

export function preparePersonalImportRollback(key: string, raw: string | null): () => void {
  const encoded = raw ?? 'null';
  const { payload, marker, marked } = journalFiles(key);
  // The document directory survives process restarts and is outside AsyncStorage's quota.
  // A retry can reuse the verified copy without rewriting it.
  if (!marked || payload.textSync() !== encoded) {
    payload.write(encoded);
    if (payload.textSync() !== encoded) {
      throw new Error('無法確認匯入資料的還原副本已寫入。');
    }
  }
  if (!marked) {
    marker.create();
    // On iOS, create() can return normally even if FileManager did not create the file.
    if (!marker.info().exists) throw new Error('無法建立匯入資料的還原標記。');
  }
  return () => {
    // Commit synchronously so verification and commit cannot be separated by another JS event.
    marker.delete();
    discardPayload(payload);
  };
}

export function clearPersonalImportRollback(key: string): void {
  const { payload, marker, marked } = journalFiles(key);
  if (marked) marker.delete();
  discardPayload(payload);
}

function discardPayload(payload: File): void {
  try {
    if (payload.info().exists) payload.delete();
  } catch {
    // The unmarked payload is inert. The next guarded write replaces it.
  }
}
