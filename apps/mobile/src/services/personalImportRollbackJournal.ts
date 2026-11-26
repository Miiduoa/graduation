import { createPersonalImportId } from '@campus/shared';
import {
  type capturePersonalImportBrowserRecovery,
  personalImportWebJournalPrefix as journalPrefix,
  serializePersonalImportBrowserCommit,
  writePersonalImportBrowserPrimary,
} from '@campus/shared/src/imports/browserRecovery';
import { Directory, File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';
const committedMarker = 'committed';
const rejectedMarker = 'rejected';
const resolvedRejection = 'restored';
const verifiedRejectionPrefix = 'verified:\n';
const rejectedPrefix = 'rejected:\n';
const rearmedPattern = /^rearmed(?::[^\n:]+)?:\n/;
const ordinaryAttemptPrefix = 'ordinary-';
const attemptPattern = /^attempt:([^:\n]+):([a-f0-9]{64}):([a-f0-9]{64})(?::([a-f0-9]{64}))?\n/;
const committedMarkerPrefix = committedMarker + '\n';
const committedPayloadPattern = /^committed:([a-f0-9]{64})\n/;
const committedReceiptPattern = /^([a-f0-9]{64})\n([a-f0-9]{64})$/;
const targetedRejectionPattern = /^rejected:([a-f0-9]{64}):([a-f0-9]{64})$/;
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
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(lockStore, 'readwrite');
  } catch {
    database.close();
    return writeWithLease(ledgerHash, write);
  }
  const useLease = Symbol();
  try {
    const result = await new Promise<T | typeof useLease>((resolve, reject) => {
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
        // Fall back only before the operation starts. An abort cannot undo a committed localStorage write.
        if (!operation) resolve(useLease);
        else if (committed) operation.then(resolve, reject);
        else reject(aborted);
      };
      transaction.oncomplete = () => {
        if (operation) operation.then(resolve, reject);
        else reject(new Error('無法取得匯入資料的寫入鎖定。'));
      };
      keepLock();
    });
    if (result !== useLease) return result;
  } finally {
    database.close();
  }
  return writeWithLease(ledgerHash, write);
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

function listedInDocumentDirectory(file: File): boolean | undefined {
  try {
    return new Directory(Paths.document).list().some((entry) => entry.uri === file.uri);
  } catch {
    return undefined;
  }
}

function probeJournalFile(file: File, strict = false): boolean | undefined {
  try {
    return fileExists(file);
  } catch (error) {
    const listed = listedInDocumentDirectory(file);
    if (listed === undefined && strict) throw error;
    return listed;
  }
}

type NativeCommitProof = {
  value: string | null | undefined;
  legacyBinding?: string;
  legacyPublication?: boolean;
  legacyPrimaryDigest?: boolean;
};

type NativeCommitProofContext = {
  attempt?: string;
  legacyBinding?: string;
  allowUnboundAttempt?: boolean;
  requireAttempt?: boolean;
  denials?: readonly (string | null | undefined)[];
  rejectedPrimaryHash?: string;
};

export function verifyNativeCommitProof(
  raw: string,
  proofs: readonly NativeCommitProof[],
  {
    attempt, legacyBinding, allowUnboundAttempt = false, requireAttempt = false, denials = [], rejectedPrimaryHash,
  }: NativeCommitProofContext = {},
): { legacyBinding?: string } | undefined {
  const hash = sha256(raw);
  if (rejectedPrimaryHash === hash || (attempt && denials.includes(attempt))) return undefined;
  const attemptHashes = attempt?.match(attemptPattern)?.slice(2);
  for (const proof of proofs) {
    const bound = proof.value?.match(attemptPattern);
    if (bound) {
      if ((attempt ? bound[0] === attempt : allowUnboundAttempt) && !denials.includes(bound[0]) &&
          bound.slice(2).includes(hash) && proof.value?.slice(bound[0].length) === hash) {
        return {};
      }
      continue;
    }
    if (requireAttempt || (attemptHashes && !attemptHashes.includes(hash))) continue;
    if (!legacyBinding && proof.legacyPrimaryDigest && proof.value === hash) return {};
    const legacy = proof.value?.match(committedReceiptPattern);
    if (legacyBinding && proof.legacyBinding && legacyBinding !== proof.legacyBinding) continue;
    const expected = legacyBinding ?? proof.legacyBinding;
    // Older publications carry the exact primary digest and the rollback-copy
    // digest. The latter is an additional check when the copy is readable.
    if (legacy && legacy[2] === hash && !denials.includes(proof.value) &&
        (expected ? legacy[1] === expected : proof.legacyPublication)) {
      return { legacyBinding: legacy[1] };
    }
  }
  return undefined;
}

function journalFiles(key: string, mode?: 'capture' | 'prepare') {
  const probe = (file: File) => mode ? probeJournalFile(file, mode === 'prepare') : fileExists(file);
  const files = (name: string) => {
    const marker = new File(Paths.document, name + markerSuffix);
    const payload = new File(Paths.document, name + '.rollback.json');
    const markerPresent = probe(marker);
    return { marker, payload, markerPresent, marked: markerPresent === true };
  };
  const findBoundOrphan = ({ payload, markerPresent }: ReturnType<typeof files>) => {
    if (mode !== 'capture' || markerPresent === true || probe(payload) === false) return undefined;
    try {
      const raw = readRollbackFile(payload);
      return attemptPattern.test(raw.replace(rearmedPattern, '')) ? { raw } : undefined;
    } catch (error) {
      return { error };
    }
  };

  // An existing legacy marker remains authoritative until its write commits.
  // The escaped storage key is ASCII, so its length is also its byte count.
  const legacyName = key.replace(/[%:~]/g, (character) => `~${character.charCodeAt(0).toString(16)}`);
  const legacy = legacyName.length + markerSuffix.length <= 255 ? files(legacyName) : undefined;
  if (legacy?.marked) return { ...legacy, orphan: undefined };

  const current = files(`personal-imports-${sha256(key)}`);
  if (current.marked) return { ...current, orphan: undefined };
  const orphan = findBoundOrphan(current);
  if (orphan?.raw !== undefined) return { ...current, marked: true, orphan };
  const legacyOrphan = legacy && findBoundOrphan(legacy);
  if (legacy && legacyOrphan?.raw !== undefined) return { ...legacy, marked: true, orphan: legacyOrphan };
  if (legacy && legacyOrphan && !orphan) return { ...legacy, orphan: legacyOrphan };
  return { ...current, orphan };
}

export function capturePersonalImportRollback(key: string) {
  const { payload, marker, markerPresent, marked, orphan } = journalFiles(key, 'capture');
  const rejection = rejectionFile(key);
  const rejectionExists = probeJournalFile(rejection);
  const rejectionValue = rejectionExists === false ? resolvedRejection : readOptionalFile(rejection) ??
    (!marked ? readOptionalFile(rejectionBackupFile(key)) : undefined);
  const verifiedReceipt = readRollbackResolution(rejectionValue);
  const rejectionRecorded = rejectionValue !== resolvedRejection && verifiedReceipt === undefined;
  const targetedRejection = rejectionValue?.match(targetedRejectionPattern);
  const rejectionHash = targetedRejection?.[1] ??
    (rejectionValue && primaryHashPattern.test(rejectionValue) ? rejectionValue : undefined);
  if (!marked && orphan?.error === undefined) {
    const verifiedBinding = verifiedReceipt?.match(committedReceiptPattern);
    // A primary-only write has no journal payload. Bind recovery to the
    // original bytes so an unrelated legacy checkpoint cannot be adopted.
    const checkpointHash = verifiedBinding?.[1] ?? rejectionHash;
    if (checkpointHash === undefined) return undefined;
    return {
      rejected: true,
      rejectionHash: checkpointHash,
      rejectedPrimaryHash: targetedRejection?.[2],
      verifiedReceipt,
      checkpointRejection: (raw: string | null) => checkpointHash === sha256(raw ?? 'null'),
    };
  }
  const retirement = retirementFile(key);
  const retirementPresent = probeJournalFile(retirement);
  const retirementProof = retirementPresent !== false ? readOptionalFile(retirement) : undefined;
  const deletionBinding = retirementProof?.startsWith(committedMarkerPrefix)
    ? retirementProof.slice(committedMarkerPrefix.length)
    : undefined;
  const retired = !deletionBinding && (retirementPresent === true || retirementProof !== undefined);
  let markerCommitted = false;
  let markerAttempt: RegExpMatchArray | undefined;
  let markerOriginalHash: string | undefined;
  let rejected = rejectionRecorded;
  // Distinguish an explicit rejection from an unreadable or malformed sidecar.
  let rejectionUnreadable = rejectionRecorded && rejectionValue !== rejectedMarker && rejectionHash === undefined;
  let markerError: unknown;
  try {
    const state = markerPresent === false ? undefined : readRollbackFile(marker);
    rejected ||= state === rejectedMarker;
    rejectionUnreadable &&= state !== rejectedMarker;
    const committedBinding = state?.startsWith(committedMarkerPrefix)
      ? state.slice(committedMarkerPrefix.length)
      : undefined;
    markerAttempt = committedBinding?.match(attemptPattern) ?? undefined;
    markerOriginalHash = markerAttempt ? committedBinding?.slice(markerAttempt[0].length) : undefined;
    markerCommitted = !rejected && (state === committedMarker || markerAttempt !== undefined);
  } catch (error) {
    markerError = error;
  }
  if (!marked && deletionBinding) {
    markerAttempt = deletionBinding.match(attemptPattern) ?? undefined;
    markerOriginalHash = markerAttempt ? deletionBinding.slice(markerAttempt[0].length) : undefined;
  }
  let stored = orphan?.raw;
  let payloadError: unknown = orphan?.error;
  if (orphan === undefined) {
    try {
      stored = readRollbackFile(payload);
    } catch (error) {
      payloadError = error;
    }
  }
  // Pending is created after the payload is verified. Verified cleanup can
  // remove the payload even when deleting an older rejection file fails.
  const payloadMissing = stored === undefined && probeJournalFile(payload) === false;
  if (payloadMissing && !markerAttempt &&
      (!rejected || (rejectionUnreadable && rejectionValue !== '')) &&
      probeJournalFile(rejectionBackupFile(key)) === false) return undefined;
  const rearmed = rearmedPattern.test(stored ?? '');
  const body = stored?.replace(rearmedPattern, '');
  const payloadAttempt = body?.match(attemptPattern);
  if (retired && !rejectionRecorded && stored !== undefined && !rearmed && !payloadAttempt) return undefined;
  const attempt = stored === undefined ? markerAttempt : payloadAttempt;
  const encoded = payloadAttempt ? body?.slice(payloadAttempt[0].length) : body;
  const matchesAttemptedPrimary = attempt && ((raw: string) => {
    const hash = sha256(raw);
    return hash === attempt[2] || hash === attempt[3];
  });
  // A fallback encoding needs the same attempt-bound proof as either guarded encoding.
  const fallbackHash = attempt?.[4];
  const matchesFallbackPrimary = fallbackHash ? (raw: string) => sha256(raw) === fallbackHash : undefined;
  const binding = encoded?.match(committedPayloadPattern);
  const rollbackRaw = binding ? encoded?.slice(binding[0].length) : encoded;
  // A rejection bound to this attempt can survive both marker reads failing.
  const rejectionBackup = rejectionBackupFile(key);
  const backupDenial = attempt && (rejectionUnreadable || markerError !== undefined) &&
    probeJournalFile(rejectionBackup) !== false ? readOptionalFile(rejectionBackup) : undefined;
  const deniedAttempt = backupDenial !== undefined && backupDenial === attempt?.[0];
  // A revoked publication can leave its verified encoding in AsyncStorage
  // if restoring the original bytes there also fails.
  const orphanRejectionHash = !markerPresent || (payloadMissing && !markerAttempt) ? rejectionHash : undefined;
  const rejectedRaw = encoded?.startsWith(rejectedPrefix) ? encoded.slice(rejectedPrefix.length) : undefined;
  if (deniedAttempt) {
    return {
      raw: rejectedRaw ?? rollbackRaw,
      rejected: true,
      // This denial matches the current attempt.
      hasRejectedPayload: true,
      matchesAttemptedPrimary,
      matchesFallbackPrimary,
    };
  }
  const proofs = readNativeFileCommitProofs(key, {
    stored, rearmed, attempt: attempt?.[0], embeddedHash: binding?.[1], retirementProof: retirementProof ?? null,
  });
  const canUseCommitProof = (!rejected || rejectionUnreadable) &&
    (rejectedRaw === undefined || attempt !== undefined);
  const unreadableCopy = stored === undefined && payloadError !== undefined;
  return {
    // An unreadable marker cannot establish retirement. Keep the payload
    // available so the caller can check it against the primary and publication evidence.
    raw: rejectedRaw ?? (markerCommitted ? undefined : rollbackRaw),
    // Retirement precedes publication, so either native encoding can still
    // need the old bytes until the exact primary is verified for publication.
    committedRaw: markerCommitted ? rollbackRaw : undefined,
    rejected: rejected || rejectedRaw !== undefined,
    hasRejectedPayload: rejectedRaw !== undefined,
    matchesAttemptedPrimary,
    matchesFallbackPrimary,
    verificationReceipt: attempt && ((raw: string) => attempt[0] + sha256(raw)),
    matchesRejectionAttempt: attempt && ((proof: string) => proof === attempt[0]),
    markerError: (rejected || rejectedRaw !== undefined) && encoded !== undefined ? undefined : markerError,
    payloadError: rejectedRaw === undefined ? payloadError : undefined,
    unreadableCopy,
    matchesCommittedCheckpoint: unreadableCopy && markerOriginalHash && primaryHashPattern.test(markerOriginalHash)
      ? (raw: string | null) => sha256(raw ?? 'null') === markerOriginalHash
      : undefined,
    commitProofs: proofs,
    commitProofContext: canUseCommitProof ? {
      attempt: attempt?.[0],
      allowUnboundAttempt: unreadableCopy,
      rejectedPrimaryHash: targetedRejection?.[2],
    } : undefined,
    readBackupDenial: unreadableCopy ? () => readOptionalFile(rejectionBackup) : undefined,
    verifiedReceipt,
    rejectionHash: orphanRejectionHash,
    checkpointRejection: orphanRejectionHash === undefined ? undefined
      : (raw: string | null) => orphanRejectionHash === sha256(raw ?? 'null'),
  };
}

export function readNativeFileCommitProofs(
  key: string,
  { stored, rearmed, attempt, embeddedHash, retirementProof = readOptionalFile(retirementFile(key)) }: {
    stored?: string;
    rearmed?: boolean;
    attempt?: string;
    embeddedHash?: string;
    retirementProof?: string | null;
  } = {},
): NativeCommitProof[] {
  const payloadHash = stored === undefined ? undefined : sha256(stored);
  const verification = readOptionalFile(verificationFile(key));
  const verificationProof = verification && primaryHashPattern.test(verification) && payloadHash && !rearmed
    ? payloadHash + '\n' + verification
    : verification;
  return [
    { value: verificationProof, legacyBinding: payloadHash, legacyPrimaryDigest: stored === undefined && !attempt },
    { value: embeddedHash && payloadHash ? (attempt ?? payloadHash + '\n') + embeddedHash : undefined, legacyBinding: payloadHash },
    { value: readOptionalFile(settlementFile(key)) },
    { value: retirementProof },
    { value: readNativeVerificationReceipt(key) },
    ...[publicationFile(key), publicationBackupFile(key)].map((file) => ({
      value: readOptionalFile(file), legacyBinding: payloadHash, legacyPublication: stored === undefined,
    })),
  ];
}

export function readPersonalImportRollback(key: string): string | undefined {
  const journal = capturePersonalImportRollback(key);
  if (journal?.markerError) throw journal.markerError;
  if (journal?.payloadError) throw journal.payloadError;
  return journal?.raw;
}

function readRollbackFile(file: File): string {
  try {
    return file.textSync();
  } catch {
    return file.textSync();
  }
}

function readOptionalFile(file: File): string | undefined {
  try {
    return readRollbackFile(file);
  } catch {
    // Auxiliary files can be unreadable even when AsyncStorage is healthy.
    return undefined;
  }
}

function readRollbackResolution(state: string | undefined): string | undefined {
  if (!state?.startsWith(verifiedRejectionPrefix)) return undefined;
  const receipt = state.slice(verifiedRejectionPrefix.length);
  if (committedReceiptPattern.test(receipt)) return receipt;
  const attempt = receipt.match(attemptPattern);
  if (attempt && primaryHashPattern.test(receipt.slice(attempt[0].length))) return receipt;
  return undefined;
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

function rejectionBackupFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.rejected.bak`);
}

export function publishNativeRollbackResolution(key: string, receipt: string): void {
  const file = rejectionFile(key);
  const resolution = verifiedRejectionPrefix + receipt;
  file.write(resolution);
  if (readOptionalFile(file) !== resolution) {
    throw new Error('無法確認匯入資料的還原狀態。');
  }
}

export function clearVerifiedNativeRollback(key: string): boolean {
  const clear = (file: File) => !fileExists(file) || deleteMarker(file);
  let rejectionCleared = false;
  let payloadCleared = false;
  try {
    rejectionCleared = clear(rejectionFile(key));
  } catch {
    // An unreadable rejection file still needs a publication proof.
  }
  try {
    const { payload, marked } = journalFiles(key);
    payloadCleared = !marked || clear(payload);
  } catch {
    // A failed existence probe cannot confirm that cleanup completed.
  }
  return rejectionCleared && payloadCleared;
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

function verificationReceiptFile(key: string): File {
  return new File(Paths.document, `personal-imports-${sha256(key)}.rollback.receipt`);
}

export function readNativeVerificationReceipt(key: string): string | undefined {
  const file = verificationReceiptFile(key);
  return readOptionalFile(file);
}

export function writeNativeVerificationReceipt(key: string, receipt: string): void {
  const file = verificationReceiptFile(key);
  file.write(receipt);
  if (readRollbackFile(file) !== receipt) {
    throw new Error('無法確認匯入資料的儲存憑據。');
  }
}

export function clearNativeVerificationReceipt(key: string): void {
  discardPayload(verificationReceiptFile(key));
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
  attemptedPrimary?: {
    first: string;
    replacement: string;
    fallback: string;
    preserveRejection?: boolean;
    restoredRejectionHash?: string;
    preferBoundPrimary?: boolean;
  },
) {
  const encoded = raw ?? 'null';
  const { payload, marker, marked } = journalFiles(key, 'prepare');
  let resetMarker = false;
  const rejection = rejectionFile(key);
  let hadRejection = probeJournalFile(rejection, true) === true;
  let retireRestoredRejection = false;
  let rejectionUnreadable = false;
  if (hadRejection) {
    const state = readOptionalFile(rejection);
    rejectionUnreadable = state === undefined;
    const verifiedReceipt = readRollbackResolution(state);
    const activeRejection = verifiedReceipt?.match(committedReceiptPattern)?.[1] ??
      state?.match(targetedRejectionPattern)?.[1] ?? state;
    retireRestoredRejection = !marked && attemptedPrimary?.restoredRejectionHash !== undefined &&
      !attemptedPrimary.preserveRejection &&
      (activeRejection === undefined || activeRejection === attemptedPrimary.restoredRejectionHash);
    if (state === resolvedRejection || verifiedReceipt !== undefined || retireRestoredRejection) hadRejection = false;
  }
  let markerRejected = marked && hadRejection;
  if (marked) {
    try {
      const state = readRollbackFile(marker);
      markerRejected ||= state === rejectedMarker;
      resetMarker = state === committedMarker || state.startsWith(committedMarkerPrefix) || markerRejected;
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
  const hadRetirement = probeJournalFile(retirement, true) === true;
  const previous = marked
    ? (primaryCommitted || hadRetirement ? readOptionalFile(payload) : readRollbackFile(payload))
    : undefined;
  const hadVerification = probeJournalFile(verification, true) === true;
  // Give each new attempt its own payload binding when old proofs may survive.
  const rearmed = hadRetirement || hadVerification || probeJournalFile(publication, true) === true ||
    probeJournalFile(publicationBackup, true) === true;
  const prefix = rearmed ? `rearmed:${createPersonalImportId()}:\n` : '';
  // Bind each possible write to this rollback copy without changing its row size.
  const ordinary = attemptedPrimary?.preferBoundPrimary && !attemptedPrimary.preserveRejection && !markerRejected;
  const attempt = attemptedPrimary
    ? `attempt:${ordinary ? ordinaryAttemptPrefix : ''}${createPersonalImportId()}:${sha256(attemptedPrimary.first)}:${sha256(attemptedPrimary.replacement)}:${sha256(attemptedPrimary.fallback)}\n`
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
      // With no pending marker or readable denial, the verified primary
      // can use the receipt path if the document directory is unavailable.
      if (!rejected && (!hadRejection || (!marked && primaryCommitted && rejectionUnreadable))) {
        throw new NativeRollbackUnavailableError(error);
      }
      throw error;
    }
    let written: string | undefined;
    try {
      written = marked && primaryCommitted ? readOptionalFile(payload) : readRollbackFile(payload);
    } catch (error) {
      if (!marked && !rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
    // On a read fault, the verified primary still holds the original bytes.
    if (written !== undefined && written !== writtenPayload) {
      const error = new Error('無法確認匯入資料的還原副本已寫入。');
      if (!rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
  }
  // Keep the restored primary's rejection binding until the new copy is verified.
  if (retireRestoredRejection && !deleteMarker(rejection)) {
    try {
      rejection.write(resolvedRejection);
      if (rejection.textSync() !== resolvedRejection) {
        throw new Error('無法更新匯入資料的還原標記。');
      }
    } catch (error) {
      throw new NativeRollbackUnavailableError(error);
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
    if (reset !== undefined && reset !== '') {
      const error = new Error('無法建立匯入資料的還原標記。');
      if (primaryCommitted && !rejected && !hadRejection) throw new NativeRollbackUnavailableError(error);
      throw error;
    }
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
      verification.write(attempt + hash);
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
    let deletionBound = !attempt;
    if (canDeleteMarker && attempt) {
      // Preserve the old digest independently of pending until settlement is readable.
      const recoveryBinding = committedMarkerPrefix + attempt + sha256(encoded);
      try {
        retirement.write(recoveryBinding);
        deletionBound = readRollbackFile(retirement) === recoveryBinding;
      } catch {
        // Keep pending in place if the deletion window cannot be recovered.
      }
    }
    if (canDeleteMarker && deletionBound && deleteMarker(marker)) {
      // Keep the bound rollback copy if publication fails after marker removal.
      try {
        if (primary !== undefined && !settle(sha256(primary))) return false;
      } catch {
        return false;
      }
      discardPayload(retirement);
      discardPayload(verification);
      discardPayload(publication);
      discardPayload(publicationBackup);
      clearNativeVerificationReceipt(key);
      discardPayload(payload);
      return true;
    }
    if (deletionBound && attempt && probeJournalFile(marker) === true) discardPayload(retirement);
    // Retain the recovery files when cleanup fails, but retire this rollback
    // durably so a restart exposes the verified primary.
    assertWritable();
    let markerReadBack = false;
    try {
      // Keep the attempt and original digest available if the copy cannot be read.
      // This marker is written before settlement and is only recovery evidence.
      const state = attempt ? committedMarkerPrefix + attempt + sha256(encoded) : committedMarker;
      marker.write(state);
      // Native writes throw on I/O failure. Preserve the outcome of the write
      // separately from the readback so publication can survive a read fault.
      retirementWriteCompleted = true;
      markerReadBack = marker.textSync() === state;
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
      if (!fileExists(retirement)) return false;
      if (primary === undefined) return true;
      const proof = attempt + sha256(primary);
      retirement.write(proof);
      return readRollbackFile(retirement) === proof;
    } catch {
      return false;
    }
  };
  return {
    retire,
    verificationReceipt(primary: string) {
      return attempt + sha256(primary);
    },
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
      let current: ReturnType<typeof capturePersonalImportRollback>;
      try {
        current = capturePersonalImportRollback(key);
        if (current?.commitProofContext && verifyNativeCommitProof(primary, current.commitProofs, {
          ...current.commitProofContext,
          attempt: attempt || current.commitProofContext.attempt,
          allowUnboundAttempt: false,
          requireAttempt: attempt !== '',
        })) return true;
      } catch {
        return false;
      }
      if (current?.rejected) return false;
      // The attempt binding stays verifiable even when the rollback copy is unreadable.
      const receipt = attempt ? attempt + hash : sha256(readOptionalFile(payload) ?? writtenPayload) + '\n' + hash;
      const verifyPublication = (file: File) => {
        try {
          file.write(receipt);
          return readOptionalFile(file) === receipt;
        } catch {
          return false;
        }
      };
      const published = verifyPublication(publication);
      if (verifyPublication(publicationBackup) || published) return true;
      // A readable rollback copy can bind settlement to this attempt even
      // when the pending marker could not be retired.
      if (rejected || (!retirementWriteCompleted && readOptionalFile(payload) !== writtenPayload)) {
        return false;
      }
      assertWritable();
      try {
        return settle(hash);
      } catch {
        return false;
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
    async retainRejection(recordDenial: (attempt: string) => Promise<void>) {
      // Preserve the attempt binding even when the rollback copy is unreadable.
      try {
        const rejectedPayload = wrap(rejectedPrefix + encoded);
        payload.write(rejectedPayload);
        if (ordinary && readRollbackFile(payload) !== rejectedPayload) {
          throw new Error('無法確認匯入資料的還原副本已寫入。');
        }
      } catch (error) {
        if (ordinary) {
          try {
            try {
              rejectionBackupFile(key).write(attempt);
            } finally {
              marker.write(rejectedMarker);
            }
          } finally {
            await recordDenial(attempt);
          }
        }
        throw error;
      } finally {
        discardPayload(verification);
        discardPayload(publication);
        discardPayload(publicationBackup);
        discardPayload(settlement);
      }
    },
  };
}

export function recordFailedPersonalImportRestoration(
  key: string,
  original: string | null,
  rejectedPrimary?: string,
): void {
  // Record rejection independently so a restart can distinguish an unreadable
  // rejected journal from auxiliary read failures after a verified commit.
  const rejection = rejectionFile(key);
  const { marker, marked } = journalFiles(key);
  try {
    if (!marked) {
      const originalHash = sha256(original ?? 'null');
      const evidence = rejectedPrimary === undefined
        ? originalHash
        : `rejected:${originalHash}:${sha256(rejectedPrimary)}`;
      try {
        rejectionBackupFile(key).write(evidence);
      } catch {
        // The other rejection file may still be writable.
      }
      rejection.write(evidence);
    } else if (!fileExists(rejection)) {
      rejection.create();
    } else {
      const state = readOptionalFile(rejection);
      if (state === undefined || state === resolvedRejection || state.startsWith(verifiedRejectionPrefix)) {
        rejection.write(rejectedMarker);
      }
    }
    if (fileExists(rejection)) return;
  } catch {
    // The pending marker can still preserve the rejection.
  }
  marker.write(rejectedMarker);
}

export function clearPersonalImportRollback(key: string): void {
  const { payload, marker, marked } = journalFiles(key);
  if (!marked || deleteMarker(marker)) {
    discardPayload(retirementFile(key));
    discardPayload(verificationFile(key));
    discardPayload(rejectionFile(key));
    discardPayload(rejectionBackupFile(key));
    discardPayload(publicationFile(key));
    discardPayload(publicationBackupFile(key));
    discardPayload(settlementFile(key));
    clearNativeVerificationReceipt(key);
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
