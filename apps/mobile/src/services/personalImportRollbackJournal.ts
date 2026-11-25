import { createPersonalImportId } from '@campus/shared';
import {
  type capturePersonalImportBrowserRecovery,
  personalImportWebJournalPrefix as journalPrefix,
  serializePersonalImportBrowserCommit,
  writePersonalImportBrowserPrimary,
} from '@campus/shared/src/imports/browserRecovery';
import { File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';
const committedMarker = 'committed';
const rejectedMarker = 'rejected';
const rejectedPrefix = 'rejected:\n';
const rearmedPattern = /^rearmed(?::[^\n:]+)?:\n/;
const attemptPattern = /^attempt:([^:\n]+):([a-f0-9]{64}):([a-f0-9]{64})\n/;
const committedPayloadPattern = /^committed:([a-f0-9]{64})\n/;
const committedReceiptPattern = /^([a-f0-9]{64})\n([a-f0-9]{64})$/;
const primaryHashPattern = /^[a-f0-9]{64}$/;
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
type BrowserWrite<T> = (
  assertLockHeld: () => void,
  lease?: BrowserLease,
  markCommitted?: () => void,
) => Promise<T>;

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
  const abandonLease = () => {
    reserved = false;
    clearInterval(heartbeat);
    try {
      storage.removeItem(leaseKey);
    } catch {
      // Each attempt owns its lease key. If removal fails, it expires.
    }
  };
  const assertLease = () => {
    if (stopped) throw lostLease;
    if (!reserved) return;
    if (!isLiveLease(value)) throw lostLease;
    let stored: string | null;
    try {
      stored = storage.getItem(leaseKey);
    } catch {
      // A blocked lease check leaves only the atomic primary snapshot path.
      abandonLease();
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
          try {
            storage.setItem(leaseKey, next);
          } catch {
            abandonLease();
            return;
          }
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
    try {
      if (navigator.locks) {
        await navigator.locks.request(journalPrefix + hash, { ifAvailable: true }, (lock) => {
          if (lock) remove();
        });
      } else {
        await sweepLegacyIndexedDBStages(hash, remove, ledgerHash === undefined);
      }
    } catch {
      // Leave this ledger's stages alone if its lock cannot be acquired.
    }
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
  const writeWithCleanup = async (assertLockHeld: () => void, markCommitted?: () => void) => {
    await sweepLegacyStages(ledgerHash);
    sweepExpiredLeases(window.localStorage);
    assertLockHeld();
    return write(assertLockHeld, undefined, markCommitted);
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
      let committed = false;
      let aborted: Error | undefined;
      const markCommitted = () => { committed = true; };
      const assertLockHeld = () => {
        if (aborted) throw aborted;
      };
      const keepLock = () => {
        if (finished) return;
        store.get('lock').onsuccess = () => {
          if (finished) return;
          if (!operation) {
            operation = writeWithCleanup(assertLockHeld, markCommitted).finally(() => { finished = true; });
            // Observe rejection immediately. Deliver the result after releasing the lock.
            void operation.catch(() => undefined);
          }
          keepLock();
        };
      };
      transaction.onabort = () => {
        aborted = transaction.error ?? new Error('匯入資料的寫入鎖定已中止，請稍後再試。');
        finished = true;
        // IndexedDB only holds the lock. Its abort cannot undo completed localStorage writes.
        if (committed && operation) operation.then(resolve, reject);
        else reject(aborted);
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
    recoveryCopies.assertSnapshot(
      before, recoveryCheck.verifyCheckpoint, recoveryCheck.verifyJournal, recoveryCheck.adopted,
    );
    writePersonalImportBrowserPrimary(storage, key, published);
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

function fileExists(file: File): boolean {
  try {
    return file.info().exists;
  } catch {
    // Existence can still be checked when metadata such as file size is unreadable.
    return file.exists;
  }
}

function journalFiles(key: string) {
  const directory = Paths.document;
  // An existing legacy marker remains authoritative until its write commits.
  // The escaped storage key is ASCII, so its length is also its byte count.
  const legacyName = key.replace(/[%:~]/g, (character) => `~${character.charCodeAt(0).toString(16)}`);
  if (legacyName.length + markerSuffix.length <= 255) {
    const marker = new File(directory, legacyName + markerSuffix);
    if (fileExists(marker)) {
      return { marker, payload: new File(directory, `${legacyName}.rollback.json`), marked: true };
    }
  }

  const name = `personal-imports-${sha256(key)}`;
  const marker = new File(directory, name + markerSuffix);
  return { marker, payload: new File(directory, `${name}.rollback.json`), marked: fileExists(marker) };
}

export function capturePersonalImportRollback(key: string) {
  const { payload, marker, marked } = journalFiles(key);
  if (!marked) return undefined;
  const rejectionRecorded = fileExists(rejectionFile(key));
  const retired = fileExists(retirementFile(key));
  const retiredPayload = retired && !rejectionRecorded ? readOptionalFile(payload) : undefined;
  if (retired && !rejectionRecorded && !rearmedPattern.test(retiredPayload ?? '')) return undefined;
  let markerCommitted = false;
  let rejected = rejectionRecorded;
  let markerError: unknown;
  try {
    const state = marker.textSync();
    rejected ||= state === rejectedMarker;
    markerCommitted = !rejected && state === committedMarker;
  } catch (error) {
    markerError = error;
  }
  let stored = retiredPayload;
  let payloadError: unknown;
  if (!retired || rejectionRecorded) {
    try {
      stored = payload.textSync();
    } catch (error) {
      if (!markerCommitted) payloadError = error;
    }
  }
  const rearmed = rearmedPattern.test(stored ?? '');
  const body = stored?.replace(rearmedPattern, '');
  const attempt = body?.match(attemptPattern);
  const encoded = attempt ? body?.slice(attempt[0].length) : body;
  const matchesAttemptedPrimary = attempt && ((raw: string) => {
    const hash = sha256(raw);
    return hash === attempt[2] || hash === attempt[3];
  });
  // A revoked publication can leave its verified encoding in AsyncStorage
  // if restoring the original bytes there also fails.
  if (encoded?.startsWith(rejectedPrefix)) {
    return {
      raw: encoded.slice(rejectedPrefix.length),
      rejected: true,
      // Preparing a retry can replace the attempt hashes before the primary
      // changes. The explicit rejection still protects the original bytes.
      hasRejectedPayload: true,
      matchesAttemptedPrimary,
    };
  }
  const binding = encoded?.match(committedPayloadPattern);
  const verification = readOptionalFile(verificationFile(key));
  // A surviving sidecar can verify a rearmed journal only when it describes
  // the same payload.
  const bindingPrefix = rearmed && stored !== undefined ? sha256(stored) + '\n' : '';
  const recordedHash = verification?.startsWith(bindingPrefix) ? verification.slice(bindingPrefix.length) : undefined;
  const verifiedHash = recordedHash && primaryHashPattern.test(recordedHash)
    ? recordedHash
    : undefined;
  const receipt = stored === undefined ? undefined : (
    readOptionalFile(publicationFile(key)) ?? readOptionalFile(publicationBackupFile(key))
  )?.match(committedReceiptPattern);
  const receiptHash = receipt && stored !== undefined && receipt[1] === sha256(stored)
    ? receipt[2]
    : undefined;
  const rollbackRaw = binding ? encoded?.slice(binding[0].length) : encoded;
  const settlement = readOptionalFile(settlementFile(key));
  const settlementPrefix = attempt?.[0] ?? '';
  const settled = settlement?.startsWith(settlementPrefix)
    ? settlement.slice(settlementPrefix.length)
    : undefined;
  const settledHash = settled && primaryHashPattern.test(settled) ? settled : undefined;
  return {
    // An unreadable marker cannot establish retirement. Keep the payload
    // available so the caller can check it against the primary and publication evidence.
    raw: markerCommitted ? undefined : rollbackRaw,
    // Retirement precedes publication, so either native encoding can still
    // need the old bytes until the exact primary is verified for publication.
    committedRaw: markerCommitted ? rollbackRaw : undefined,
    rejected,
    hasRejectedPayload: false,
    matchesAttemptedPrimary,
    markerError: rejected && encoded !== undefined ? undefined : markerError,
    payloadError,
    matchesVerifiedPrimary: verifiedHash || binding || receiptHash || settledHash ? (raw: string) => {
      const hash = sha256(raw);
      return hash === verifiedHash || hash === binding?.[1] || hash === receiptHash || hash === settledHash;
    } : undefined,
  };
}

export function readPersonalImportRollback(key: string): string | undefined {
  const journal = capturePersonalImportRollback(key);
  if (journal?.markerError) throw journal.markerError;
  if (journal?.payloadError) throw journal.payloadError;
  return journal?.raw;
}

function readOptionalFile(payload: File): string | undefined {
  try {
    return payload.textSync();
  } catch {
    // Auxiliary files can be unreadable even when AsyncStorage is healthy.
    return undefined;
  }
}

function retirementFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.committed`);
}

function verificationFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.verified`);
}

function rejectionFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.rejected`);
}

function publicationFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.published`);
}

function publicationBackupFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.published.bak`);
}

function settlementFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.settled`);
}

export class NativeRollbackUnavailableError extends Error {
  constructor(readonly failure: unknown) {
    super('無法準備匯入資料的還原副本。');
  }
}

export function preparePersonalImportRollback(
  key: string,
  raw: string | null,
  primaryCommitted = false,
  attemptedPrimary?: { first: string; replacement: string; preserveRejection?: boolean },
) {
  const encoded = raw ?? 'null';
  const { payload, marker, marked } = journalFiles(key);
  let resetMarker = false;
  const rejection = rejectionFile(key);
  const hadRejection = fileExists(rejection);
  let markerRejected = marked && hadRejection;
  if (marked) {
    try {
      const state = marker.textSync();
      markerRejected ||= state === rejectedMarker;
      resetMarker = state === committedMarker || markerRejected;
    } catch (error) {
      if (!primaryCommitted) throw error;
      // A verified primary supplies the rollback bytes even when the old
      // marker cannot report its state. Rearm it for the next guarded write.
      resetMarker = true;
    }
  }
  // The document directory survives process restarts and is outside AsyncStorage's quota.
  // A retry can reuse the verified copy without rewriting it.
  const retirement = retirementFile(key);
  const verification = verificationFile(key);
  const publication = publicationFile(key);
  const publicationBackup = publicationBackupFile(key);
  const settlement = settlementFile(key);
  const hadRetirement = fileExists(retirement);
  const previous = marked
    ? (primaryCommitted || hadRetirement ? readOptionalFile(payload) : payload.textSync())
    : undefined;
  const hadVerification = fileExists(verification);
  // Give each new attempt its own payload binding when old proofs may survive.
  const rearmed = hadRetirement || hadVerification || fileExists(publication) || fileExists(publicationBackup);
  const prefix = rearmed ? `rearmed:${createPersonalImportId()}:\n` : '';
  // Bind both possible writes to this rollback copy without changing their row size.
  const attempt = attemptedPrimary
    ? `attempt:${createPersonalImportId()}:${sha256(attemptedPrimary.first)}:${sha256(attemptedPrimary.replacement)}\n`
    : '';
  const wrap = (value: string) => prefix + attempt + value;
  const previousBody = previous?.replace(rearmedPattern, '').replace(attemptPattern, '');
  // An adopted rollback may have only the previous attempt hashes to reject
  // the primary. Carry that rejection across the payload overwrite.
  const rejected = markerRejected || attemptedPrimary?.preserveRejection ||
    previousBody === rejectedPrefix + encoded;
  let writtenPayload = wrap(rejected ? rejectedPrefix + encoded : encoded);
  if (previous !== writtenPayload) {
    try {
      payload.write(writtenPayload);
    } catch (error) {
      if (!rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
    let written: string | undefined;
    try {
      written = marked && primaryCommitted ? readOptionalFile(payload) : payload.textSync();
    } catch (error) {
      if (!marked && !rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
    // On a read fault, the verified primary still holds the original bytes.
    if (written !== undefined && written !== writtenPayload) {
      throw new Error('無法確認匯入資料的還原副本已寫入。');
    }
  }
  if (!marked) {
    try {
      marker.create();
      // On iOS, create() can return normally even if FileManager did not create the file.
      if (!fileExists(marker)) throw new Error('無法建立匯入資料的還原標記。');
    } catch (error) {
      if (!rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
  } else if (resetMarker) {
    try {
      marker.write('');
    } catch (error) {
      if (primaryCommitted && !rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
    let reset: string | undefined;
    try {
      reset = marker.textSync();
    } catch (error) {
      if (!primaryCommitted) throw error;
    }
    if (reset !== undefined && reset !== '') throw new Error('無法建立匯入資料的還原標記。');
  }
  // A surviving settlement belongs to its original attempt.
  discardPayload(settlement);
  // A retry carries the rejection in its verified payload until publication.
  if (hadRejection && !deleteMarker(rejection)) {
    throw new Error('無法更新匯入資料的還原標記。');
  }
  if (hadRetirement) deleteMarker(retirement);
  if (hadVerification) deleteMarker(verification);
  discardPayload(publication);
  discardPayload(publicationBackup);
  let retirementWriteCompleted = false;
  const recordVerification = (hash: string) => {
    try {
      verification.write(rearmed ? sha256(writtenPayload) + '\n' + hash : hash);
    } catch {
      // The other proofs can still settle this write.
    }
  };
  const settle = (hash: string) => {
    const proof = attempt + hash;
    settlement.write(proof);
    return settlement.textSync() === proof;
  };
  const retire = (assertWritable = () => {}, canDeleteMarker = true, primary?: string) => {
    // Commit synchronously so verification and commit cannot be separated by another JS event.
    if (canDeleteMarker && deleteMarker(marker)) {
      discardPayload(retirement);
      discardPayload(verification);
      discardPayload(publication);
      discardPayload(publicationBackup);
      discardPayload(payload);
      return true;
    }
    // Retain the recovery files when cleanup fails, but retire this rollback
    // durably so a restart exposes the verified primary.
    assertWritable();
    let markerReadBack = false;
    try {
      marker.write(committedMarker);
      // Native writes throw on I/O failure. Preserve the outcome of the write
      // separately from the readback so publication can survive a read fault.
      retirementWriteCompleted = true;
      markerReadBack = marker.textSync() === committedMarker;
      retirementWriteCompleted = markerReadBack;
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
    if (markerReadBack && !rejected) {
      try {
        // Keep proof of publication readable independently of the pending marker.
        // A failed marker readback still goes through the replacement path.
        if (primary === undefined) return true;
        const hash = sha256(primary);
        if (settle(hash)) {
          recordVerification(hash);
          return true;
        }
      } catch {
        // The retirement file or verified replacement can still publish the write.
      }
    }
    if (rearmed) return false;
    try {
      retirement.create();
      return fileExists(retirement);
    } catch {
      return false;
    }
  };
  return {
    retire,
    publishVerifiedPrimary(primary: string, assertWritable: () => void) {
      const hash = sha256(primary);
      recordVerification(hash);
      try {
        // Tie retirement to the verified bytes while keeping the rollback copy.
        const committedPayload = wrap(`committed:${hash}\n${encoded}`);
        payload.write(committedPayload);
        writtenPayload = committedPayload;
      } catch {
        // The verification file or publication receipt can still settle this write.
      }
      const current = capturePersonalImportRollback(key);
      if (!fileExists(marker) || (current && !current.rejected &&
          current.matchesVerifiedPrimary?.(primary))) return;
      if (current?.rejected) throw new Error('無法確認匯入資料已儲存，請稍後再試。');
      // Bind proof of publication to the rollback copy and the verified primary.
      const receipt = sha256(readOptionalFile(payload) ?? writtenPayload) + '\n' + hash;
      try {
        publication.write(receipt);
        const writtenReceipt = readOptionalFile(publication);
        if (writtenReceipt !== undefined && writtenReceipt !== receipt) {
          throw new Error('無法確認匯入資料已儲存，請稍後再試。');
        }
        // Verify the backup even if the original receipt is still temporarily unreadable.
        publicationBackup.write(receipt);
        if (publicationBackup.textSync() !== receipt) {
          throw new Error('無法確認匯入資料已儲存，請稍後再試。');
        }
      } catch (error) {
        if (!retirementWriteCompleted || rejected) throw error;
        // The earlier marker can be unreadable on restart and predates any
        // replacement write. Persist proof of the exact bytes verified after it.
        assertWritable();
        if (!settle(hash)) throw error;
      }
    },
    preparePrimaryCommit() {
      // The tentative write is verified now, so a rejected primary from a
      // previous attempt can no longer be exposed by clearing this flag.
      if (!rejected) return;
      const clearedPayload = wrap(encoded);
      payload.write(clearedPayload);
      writtenPayload = clearedPayload;
      if (payload.textSync() !== clearedPayload) {
        throw new Error('無法確認匯入資料的還原副本已寫入。');
      }
    },
    retainRejection() {
      // Preserve the attempt binding even when the rollback copy is unreadable.
      try {
        payload.write(wrap(rejectedPrefix + encoded));
      } finally {
        discardPayload(verification);
        discardPayload(publication);
        discardPayload(publicationBackup);
        discardPayload(settlement);
      }
    },
  };
}

export function recordFailedPersonalImportRestoration(key: string): void {
  // Record rejection independently so a restart can distinguish an unreadable
  // rejected journal from auxiliary read failures after a verified commit.
  const rejection = rejectionFile(key);
  try {
    if (!fileExists(rejection)) {
      rejection.create();
    }
    if (fileExists(rejection)) return;
  } catch {
    // The pending marker can still preserve the rejection.
  }
  journalFiles(key).marker.write(rejectedMarker);
}

export function clearPersonalImportRollback(key: string): void {
  const { payload, marker, marked } = journalFiles(key);
  if (!marked || deleteMarker(marker)) {
    discardPayload(retirementFile(key));
    discardPayload(verificationFile(key));
    discardPayload(rejectionFile(key));
    discardPayload(publicationFile(key));
    discardPayload(publicationBackupFile(key));
    discardPayload(settlementFile(key));
    discardPayload(payload);
  }
}

function deleteMarker(marker: File): boolean {
  try {
    marker.delete();
    return !fileExists(marker);
  } catch {
    return false;
  }
}

function discardPayload(payload: File): void {
  try {
    if (fileExists(payload)) payload.delete();
  } catch {
    // The unmarked payload is inert. The next guarded write replaces it.
  }
}
