import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPersonalImportId } from '@campus/shared';
import { File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';

// One atomic browser storage entry contains both the recovery marker and the payload.
function webJournalKey(key: string) {
  return `campus.personal-imports.rollback.v1:${sha256(key)}`;
}

type WebRollback = {
  id: string;
  original: string | null;
  before: string;
  attempted: string;
};

const fingerprint = (raw: string | null) => sha256(raw ?? 'null');

const lockStore = 'writes';

async function openWriteLockDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('campus.personal-imports.locks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(lockStore);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Some browser configurations allow localStorage while disabling IndexedDB.
    return undefined;
  }
}

export async function withPersonalImportWriteLock<T>(key: string, write: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'web') return write();
  const name = webJournalKey(key);
  if (navigator.locks) return navigator.locks.request(name, write);

  // An IndexedDB readwrite transaction serializes cooperating tabs on Web
  // previews served over HTTP, where Web Locks may be unavailable.
  const database = await openWriteLockDatabase();
  if (!database) return write();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(lockStore, 'readwrite');
      const store = transaction.objectStore(lockStore);
      let operation: Promise<T> | undefined;
      let finished = false;
      const keepLock = () => {
        if (finished) return;
        store.get(name).onsuccess = () => {
          if (!operation) {
            operation = write().finally(() => { finished = true; });
            // Observe rejection immediately. Deliver the result after releasing the lock.
            void operation.catch(() => undefined);
          }
          keepLock();
        };
      };
      transaction.onabort = () => reject(transaction.error);
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

const abandonedStageAge = 24 * 60 * 60 * 1000;

export async function commitWebPersonalImports(
  key: string,
  before: string | null,
  attempted: string,
  assertWritable: () => void,
  recovery?: { raw: string | null },
): Promise<string> {
  const storage = window.localStorage;
  const id = createPersonalImportId();
  const committed = JSON.stringify({ ...JSON.parse(attempted), webCommit: id });
  const conflict = () => new Error('匯入資料已在另一個分頁更新，請重新載入。');
  const publish = () => {
    assertWritable();
    // The primary stays authoritative until this single publication. Its new
    // generation also retires legacy recovery data without clearing shared keys.
    storage.setItem(key, committed);
    if (storage.getItem(key) !== committed) throw conflict();
    return committed;
  };
  if (!recovery) {
    if (storage.getItem(key) !== before) throw conflict();
    return publish();
  }

  const prefix = `${webJournalKey(key)}:stage:`;
  const now = Date.now();
  for (const entry of Object.keys(storage)) {
    if (!entry.startsWith(prefix)) continue;
    const started = Number(entry.slice(prefix.length).split(':', 1)[0]);
    // A suspended writer must recheck its stage before publishing.
    if (started < now - abandonedStageAge) storage.removeItem(entry);
  }

  const stageKey = `${prefix}${now}:${id}`;
  const encoded = JSON.stringify({
    id,
    original: recovery.raw,
    before: fingerprint(before),
    attempted: fingerprint(attempted),
  } satisfies WebRollback);
  const ownsStage = () => storage.getItem(stageKey) === encoded;
  try {
    await AsyncStorage.setItem(stageKey, encoded);
    assertWritable();
    if (!ownsStage() || storage.getItem(key) !== before) throw conflict();

    return publish();
  } finally {
    // Even if another tab publishes here, this key belongs only to this attempt.
    // No failure path writes the primary or clears a shared recovery key.
    try {
      if (ownsStage()) {
        const current = storage.getItem(key);
        if (current === before || current === committed) storage.removeItem(stageKey);
      }
    } catch {
      // An abandoned stage is inert and can be reclaimed by a later write.
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
