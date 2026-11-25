import { createPersonalImportId } from '@campus/shared';
import {
  type capturePersonalImportBrowserRecovery,
  personalImportWebJournalPrefix as journalPrefix,
  serializePersonalImportBrowserCommit,
} from '@campus/shared/src/imports/browserRecovery';
import { File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';
const committedMarker = 'committed';
const rejectedPrefix = 'rejected:\n';
const committedPayloadPattern = /^committed:([a-f0-9]{64})\n/;
const primaryHashPattern = /^[a-f0-9]{64}$/;
const verifiedPrimaries = new Map<string, string>();
const legacyStagePattern = /^campus\.personal-imports\.rollback\.v1:([a-f0-9]{64}):stage:\d+:[^:]+$/;
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
    try {
      const value = storage.getItem(entry);
      if (value !== null && !isLiveLease(value) && storage.getItem(entry) === value) {
        storage.removeItem(entry);
      }
    } catch {
      // A lease that cannot be inspected is left in place.
    }
  }
}

type BrowserLease = {
  canStage: () => boolean;
  releaseForAtomicWrite: () => void;
};
type BrowserWrite<T> = (assertLockHeld: () => void, lease?: BrowserLease) => Promise<T>;

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
  let reserved = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const assertLease = () => {
    if (stopped) throw lostLease;
    if (!reserved) return;
    if (!isLiveLease(value)) throw lostLease;
    let stored: string | null;
    try {
      stored = storage.getItem(leaseKey);
    } catch {
      // A blocked lease check leaves only the atomic primary snapshot path.
      reserved = false;
      clearInterval(heartbeat);
      try {
        storage.removeItem(leaseKey);
      } catch {
        // Each attempt owns its lease key. If removal fails, it expires.
      }
      return;
    }
    if (stored !== value) throw lostLease;
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
      reserved = true;
    } catch {
      // Without a persisted lease this attempt may only publish an in-place
      // replacement atomically. It cannot create or reuse a recovery stage.
    }
    assertLease();
    if (reserved) {
      heartbeat = setInterval(() => {
        try {
          assertLease();
          if (!reserved) return;
          const next = String(Date.now() + leaseDuration);
          storage.setItem(leaseKey, next);
          value = next;
          assertLease();
        } catch {
          stop();
        }
      }, leaseDuration / 3);
    }
    return await write(assertLease, {
      canStage: () => reserved,
      releaseForAtomicWrite: () => {
        assertLease();
        if (!reserved) return;
        storage.removeItem(leaseKey);
        reserved = false;
        clearInterval(heartbeat);
      },
    });
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
    let value: string | null;
    try {
      value = storage.getItem(entry);
    } catch {
      // An unreadable legacy stage cannot be reclaimed safely.
      continue;
    }
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
        try {
          if (storage.getItem(entry) === value && !hasLiveWriter(storage, hash) &&
              storage.getItem(entry) === value) storage.removeItem(entry);
        } catch {
          // Keep the stage if its ownership or contents cannot be confirmed.
        }
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
    // Share the calendar lock and retain the legacy Expo lock while older tabs
    // can still be writing or sweeping this ledger.
    return navigator.locks.request(key, () =>
      navigator.locks.request(journalPrefix + ledgerHash, () => writeWithCleanup(noLockCheck)));
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

export { hasWebPersonalImportCommit } from '@campus/shared/src/imports/browserRecovery';

function sweepSessionStages(storage: Storage): void {
  for (const entry of Object.keys(storage)) {
    if (!entry.startsWith(stagePrefix) || activeStages.has(entry)) continue;
    try {
      storage.removeItem(entry);
    } catch {
      // Stale stages are private and never used for recovery.
    }
  }
}

export function commitWebPersonalImports(
  key: string,
  before: string | null,
  attempted: string,
  assertWritable: () => void,
  recoveryCopies: ReturnType<typeof capturePersonalImportBrowserRecovery>,
  recoveryCheck: { verifyCheckpoint: boolean; verifyJournal: boolean; adopted?: 'checkpoint' | 'journal' },
  recovery?: { raw: string | null },
  lease?: BrowserLease,
): string {
  const storage = window.localStorage;
  const id = createPersonalImportId();
  const committed = JSON.stringify({ ...JSON.parse(attempted), webCommit: id });
  const conflict = () => new Error('匯入資料已在另一個分頁更新，請重新載入。');
  const replace = (raw: string, ownsStage: () => boolean) => {
    const published = recoveryCopies.detachJournal(raw);
    assertWritable();
    if (!ownsStage()) throw conflict();
    recoveryCopies.assertSnapshot(before, recoveryCheck.verifyCheckpoint, recoveryCheck.verifyJournal);
    storage.setItem(key, published);
    if (storage.getItem(key) !== published) throw conflict();
    return published;
  };
  const publish = (ownsStage = () => true) => {
    try {
      return replace(committed, ownsStage);
    } catch (error) {
      if (!isQuotaExceeded(error)) throw error;
      // Keep the marker and version in the same entry at the original byte count.
      return replace(
        recoveryCopies.mayHaveCopies ? serializePersonalImportBrowserCommit(JSON.parse(attempted)) : attempted,
        ownsStage,
      );
    }
  };
  const publishWithQuotaRetry = (ownsStage?: () => boolean, discardStage?: () => void) => {
    try {
      return publish(ownsStage);
    } catch (error) {
      if (!isQuotaExceeded(error) || !lease?.canStage()) throw error;
      // Give the primary back the lease's quota. The retry uses only the
      // primary snapshot and must never rely on a stage after releasing ownership.
      discardStage?.();
      assertWritable();
      lease.releaseForAtomicWrite();
      return publish();
    }
  };
  const commit = () => {
    if (!recovery || lease?.canStage() === false) return publishWithQuotaRetry();

    let stages: Storage;
    try {
      stages = window.sessionStorage;
      sweepSessionStages(stages);
    } catch {
      return publishWithQuotaRetry();
    }

    // The private copy uses the verbatim ledger without JSON string escaping.
    const stageKey = stagePrefix + id;
    const encoded = recovery.raw ?? 'null';
    const readStage = () => {
      try {
        return stages.getItem(stageKey);
      } catch {
        return undefined;
      }
    };
    const ownsStage = () => {
      const staged = readStage();
      return staged === undefined || staged === encoded;
    };
    const discardStage = () => {
      try {
        if (readStage() === encoded) stages.removeItem(stageKey);
      } catch {
        // An abandoned stage is inert and can be reclaimed by a later write.
      }
    };
    assertWritable();
    activeStages.add(stageKey);
    try {
      try {
        stages.setItem(stageKey, encoded);
      } catch {
        // The primary can still be published under the lock and snapshot check.
        return publishWithQuotaRetry();
      }
      return publishWithQuotaRetry(ownsStage, discardStage);
    } finally {
      discardStage();
      activeStages.delete(stageKey);
    }
  };

  const published = commit();
  if (recoveryCheck.adopted) recoveryCopies.retire(published, recoveryCheck.adopted);
  return published;
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

export function capturePersonalImportRollback(key: string) {
  if (retirementFile(key).info().exists) return undefined;
  const { payload, marker, marked } = journalFiles(key);
  if (!marked) return undefined;
  let committed: boolean;
  let markerError: unknown;
  try {
    committed = marker.textSync() === committedMarker;
  } catch (error) {
    markerError = error;
    committed = true;
  }
  const encoded = committed ? readRetiredPayload(payload) : payload.textSync();
  // A revoked publication can leave its verified encoding in AsyncStorage
  // if restoring the original bytes there also fails.
  if (encoded?.startsWith(rejectedPrefix)) {
    return { raw: encoded.slice(rejectedPrefix.length), rejected: true };
  }
  const binding = encoded?.match(committedPayloadPattern);
  const recordedHash = readRetiredPayload(verificationFile(key));
  const verifiedHash = recordedHash && primaryHashPattern.test(recordedHash)
    ? recordedHash
    : verifiedPrimaries.get(key) ?? binding?.[1];
  return {
    raw: committed ? undefined : binding ? encoded?.slice(binding[0].length) : encoded,
    rejected: false,
    markerError,
    matchesVerifiedPrimary: verifiedHash ? (raw: string) => sha256(raw) === verifiedHash : undefined,
  };
}

export function readPersonalImportRollback(key: string): string | undefined {
  const journal = capturePersonalImportRollback(key);
  if (journal?.markerError) throw journal.markerError;
  return journal?.raw;
}

function readRetiredPayload(payload: File): string | undefined {
  try {
    return payload.textSync();
  } catch {
    // A retired journal need not have a readable payload.
    return undefined;
  }
}

function retirementFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.committed`);
}

function verificationFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.verified`);
}

export function preparePersonalImportRollback(key: string, raw: string | null, primaryCommitted = false) {
  const encoded = raw ?? 'null';
  const { payload, marker, marked } = journalFiles(key);
  let markerUnreadable = false;
  let resetMarker = false;
  if (marked) {
    try {
      resetMarker = marker.textSync() === committedMarker;
    } catch (error) {
      if (!primaryCommitted) throw error;
      // A verified primary supplies the rollback bytes even when the old
      // marker cannot report its state. Rearm it for the next guarded write.
      markerUnreadable = true;
      resetMarker = true;
    }
  }
  // The document directory survives process restarts and is outside AsyncStorage's quota.
  // A retry can reuse the verified copy without rewriting it.
  const previous = marked ? payload.textSync() : undefined;
  const rejected = previous === rejectedPrefix + encoded;
  if (previous !== encoded && !rejected) {
    payload.write(encoded);
    if (payload.textSync() !== encoded) {
      throw new Error('無法確認匯入資料的還原副本已寫入。');
    }
  }
  if (!marked) {
    marker.create();
    // On iOS, create() can return normally even if FileManager did not create the file.
    if (!marker.info().exists) throw new Error('無法建立匯入資料的還原標記。');
  } else if (resetMarker) {
    marker.write('');
    let reset: string | undefined;
    try {
      reset = marker.textSync();
    } catch (error) {
      if (!markerUnreadable) throw error;
    }
    if (reset !== undefined && reset !== '') throw new Error('無法建立匯入資料的還原標記。');
  }
  const retirement = retirementFile(key);
  if (retirement.info().exists && !deleteMarker(retirement)) {
    throw new Error('無法重新啟用匯入資料的還原標記。');
  }
  const verification = verificationFile(key);
  if (verification.info().exists && !deleteMarker(verification)) {
    throw new Error('無法清除上次匯入資料的寫入驗證。');
  }
  verifiedPrimaries.delete(key);
  const retire = (assertWritable = () => {}, canDeleteMarker = true) => {
    // Commit synchronously so verification and commit cannot be separated by another JS event.
    if (canDeleteMarker && deleteMarker(marker)) {
      discardPayload(payload);
      return true;
    }
    // Retain the recovery files when cleanup fails, but retire this rollback
    // durably so a restart exposes the verified primary.
    assertWritable();
    try {
      marker.write(committedMarker);
      if (marker.textSync() === committedMarker && !rejected) return true;
    } catch {
      // A separate file can record retirement even if this marker cannot be updated.
    }
    try {
      assertWritable();
    } catch (error) {
      // The write may have reached disk before the readback failed.
      try {
        marker.write('');
      } catch {
        // Preserve the rollback payload for the restoration path.
      }
      throw error;
    }
    try {
      retirement.create();
      return retirement.info().exists;
    } catch {
      return false;
    }
  };
  return {
    retire,
    recordVerifiedPrimary(primary: string) {
      try {
        // Record the first verified write before attempting another primary write.
        // Keep the rollback payload independent of this verification.
        verification.write(sha256(primary));
      } catch {
        // The in-place commit and rollback payload remain available.
      }
    },
    retainVerifiedPrimary(primary: string) {
      const hash = sha256(primary);
      try {
        // Tie retirement to the verified bytes while keeping the rollback copy.
        payload.write(`committed:${hash}\n${encoded}`);
      } catch {
        // Keep the verified primary visible in this process if the journal
        // also becomes unwritable.
        verifiedPrimaries.set(key, hash);
      }
    },
    preparePrimaryCommit() {
      // The tentative write is verified now, so a rejected primary from a
      // previous attempt can no longer be exposed by clearing this flag.
      if (!rejected) return;
      payload.write(encoded);
      if (payload.textSync() !== encoded) {
        throw new Error('無法確認匯入資料的還原副本已寫入。');
      }
    },
  };
}

export function retainRejectedPersonalImportRollback(key: string, raw: string | null): void {
  verifiedPrimaries.delete(key);
  const { payload } = journalFiles(key);
  // Keep the old ledger authoritative when the in-place commit encoding may
  // have reached disk before the final authority check failed.
  try {
    payload.write(rejectedPrefix + (raw ?? 'null'));
  } finally {
    discardPayload(verificationFile(key));
  }
}

export function clearPersonalImportRollback(key: string): void {
  const { payload, marker, marked } = journalFiles(key);
  if (!marked || deleteMarker(marker)) {
    verifiedPrimaries.delete(key);
    discardPayload(retirementFile(key));
    discardPayload(verificationFile(key));
    discardPayload(payload);
  }
}

function deleteMarker(marker: File): boolean {
  try {
    marker.delete();
    return !marker.info().exists;
  } catch {
    return false;
  }
}

function discardPayload(payload: File): void {
  try {
    if (payload.info().exists) payload.delete();
  } catch {
    // The unmarked payload is inert. The next guarded write replaces it.
  }
}
