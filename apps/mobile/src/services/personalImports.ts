import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';
import {
  capturePersonalImportBrowserRecovery,
  parsePersonalImportLedger,
  parsePersonalImportLedgerBody,
  type PersonalImportLedger,
  selectPersonalImportBrowserRecovery,
  personalImportCheckpointKey,
  unwrapPersonalImportCheckpoint,
} from '@campus/shared/src/imports/browserRecovery';
import { findCatalogSameSlotChange } from './publicCourseTimetableImport';
import {
  capturePersonalImportRollback,
  clearNativeVerificationReceipt,
  clearPersonalImportRollback,
  commitWebPersonalImports,
  clearVerifiedNativeRollback,
  NativeRollbackUnavailableError,
  preparePersonalImportRollback,
  publishNativeRollbackResolution,
  readNativeVerificationReceipt,
  recordFailedPersonalImportRestoration,
  withPersonalImportWriteLock,
  writeNativeVerificationReceipt,
} from './personalImportRollbackJournal';
import {
  createPersonalImportId,
  periodCount,
  periodProfileForSchool,
  planPersonalImport,
  preparePersonalImportBackupRestore,
  PERSONAL_IMPORT_BACKUP_MAX_RECORDS,
  personalImportKey,
  mapPersonalImportPeriods,
  samePersonalCourse,
  validatePersonalImportRow,
  type PersonalImportRow,
  type PersonalImportRecord,
  type PersonalCourse,
} from '@campus/shared';

export type PersonalImportScope = { owner: string; schoolId: string };
export type { PersonalImportLedger } from '@campus/shared/src/imports/browserRecovery';
export const personalImportStorageKey = (scope: PersonalImportScope) =>
  `campus.personal-imports.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
const nativeReceiptKey = (key: string) => key + ':verified-write';
const nativeBackupReceiptKey = (key: string) => key + ':verified-write-backup';
const nativeRollbackResolutionKey = (key: string) => key + ':rollback-resolution';
const nativeRejectionAttemptKey = (key: string) => key + ':rollback-rejected-attempt';
// Native primary-only writes can outlive an earlier rejection file.
const nativeRestoredRejectionPattern = /,"nativeRestoredRejection":"([a-f0-9]{64})"}$/;
const checkpointPublicationPattern = /^verified:([a-z0-9:-]+(?: [a-z0-9:-]+)+)\n/;

const empty = (): PersonalImportLedger => ({ version: 1, records: [], batches: [] });
const locks = new Map<string, Promise<unknown>>();
const pendingWrites = new Map<string, Promise<void>>();
type Recovery = { raw: string | null; source?: 'checkpoint' | 'journal'; checkpoint?: string };
const pendingRestorations = new Map<string, Recovery>();
let writeSequence = 0;

function isStorageRowTooLarge(error: unknown): boolean {
  // Android AsyncStorage forwards the SQLite exception message without its class.
  return (
    error instanceof Error &&
    /^(?:SQLiteBlobTooBigException\b|Row too big to fit into CursorWindow\b)/.test(error.message)
  );
}

async function readNativeStorage(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function readNativeReceipt(receiptKey: string, useBatchFallback = false): Promise<string | null> {
  const read = useBatchFallback ? readNativeStorageWithBatchFallback : readNativeStorage;
  return read(receiptKey).catch(() => null);
}

async function readNativeStorageWithBatchFallback(key: string): Promise<string | null> {
  try {
    return await readNativeStorage(key);
  } catch {
    const [[, encoded]] = await AsyncStorage.multiGet([key]);
    return encoded;
  }
}

async function writeNativeReceipt(receiptKey: string, receipt: string) {
  try {
    await AsyncStorage.setItem(receiptKey, receipt);
  } catch {
    await AsyncStorage.multiSet([[receiptKey, receipt]]);
  }
}

async function readLedgerSnapshot(
  key: string,
  scope: PersonalImportScope,
  allowEmptyPrimary = false,
) {
  const web = Platform.OS === 'web';
  const restorationPending = !web && pendingRestorations.has(key);
  const journal = web ? undefined : capturePersonalImportRollback(key);
  const checkpoint = journal?.raw !== undefined || journal?.committedRaw !== undefined
    ? await readLegacyCheckpoint(key, scope).catch(() => null)
    : undefined;
  let primary: string | null = null;
  let primaryError: unknown;
  if (!restorationPending) {
    try {
      // With rollback evidence, retry before a transient primary read can
      // send recovery down the path for a missing ledger.
      primary = await (journal ? readNativeStorage(key) : AsyncStorage.getItem(key));
    } catch (error) {
      if (web) throw error;
      primaryError = error;
    }
  }
  const browserRecovery = web
    ? capturePersonalImportBrowserRecovery(window.localStorage, key)
    : undefined;
  const primaryVerified = isReadableLedger(primary, scope);
  const rejectionMatches = journal?.checkpointRejection;
  // A rejected primary-only write may already have restored the original bytes.
  const restoredEmpty = primary === null && !primaryError && !restorationPending &&
    rejectionMatches?.(null) === true;
  const attemptedPrimary = primary !== null && journal?.matchesAttemptedPrimary?.(primary) === true;
  const fallbackPrimary = primary !== null && journal?.matchesFallbackPrimary?.(primary) === true;
  // A failed rollback-copy rewrite can leave the ordinary attempt intact.
  // Only a denial carrying that exact attempt binding can override it.
  const denial = journal?.matchesRejectionAttempt &&
    ((primaryVerified && (attemptedPrimary || fallbackPrimary)) || journal.rejected)
    ? await readNativeReceipt(nativeRejectionAttemptKey(key), true)
    : null;
  const deniedAttempt = (attemptedPrimary || fallbackPrimary) &&
    denial !== null && journal?.matchesRejectionAttempt?.(denial) === true;
  const candidatePrimary = attemptedPrimary || fallbackPrimary;
  const nativeRejectionBinding = primary?.match(nativeRestoredRejectionPattern)?.[1];
  const needsReceipt = !deniedAttempt && primaryVerified && (candidatePrimary || rejectionMatches !== undefined || nativeRejectionBinding !== undefined);
  const receipt = needsReceipt ? await readNativeReceipt(nativeReceiptKey(key), true) : null;
  const fileReceipt = needsReceipt ? readNativeVerificationReceipt(key) : undefined;
  const backupReceipt = needsReceipt ? await readNativeReceipt(nativeBackupReceiptKey(key), true) : null;
  const rollbackResolution = needsReceipt ? await readNativeReceipt(nativeRollbackResolutionKey(key), true) : null;
  const checkpointPublication = needsReceipt
    ? await readNativeReceipt(personalImportCheckpointKey(key), true)
    : null;
  const checkpointReceipt = checkpointPublication?.match(checkpointPublicationPattern)?.[1].replace(/ /g, '\n');
  const receipts = [receipt, fileReceipt, backupReceipt, journal?.verifiedReceipt, rollbackResolution, checkpointReceipt];
  const rejectionHash = journal?.rejectionHash;
  const primaryHash = primaryVerified && primary !== null && (rejectionMatches || nativeRejectionBinding) ? sha256(primary) : undefined;
  const explicitlyRejected = primaryHash !== undefined && journal?.rejectedPrimaryHash === primaryHash;
  const publishedRejectionHash = primaryHash === undefined || explicitlyRejected ? undefined : receipts
    .map((proof) => proof?.match(/^([a-f0-9]{64})\n([a-f0-9]{64})$/))
    .find((proof) => proof && (proof[1] === (rejectionHash ?? nativeRejectionBinding)) &&
      proof[2] === primaryHash)?.[1];
  const boundRestoredRejection = primaryHash !== undefined && rejectionHash !== undefined &&
    !explicitlyRejected && nativeRejectionBinding === rejectionHash
    ? rejectionHash
    : undefined;
  const restoredRejectionHash = publishedRejectionHash ?? boundRestoredRejection ??
    ((primaryVerified || restoredEmpty) && rejectionMatches?.(primary) ? rejectionHash : undefined);
  const verifiedByJournal = primary !== null && (
    publishedRejectionHash !== undefined ||
    journal?.matchesVerifiedPrimary?.(primary) === true ||
    receipts.some((proof) => typeof proof === 'string' && journal?.matchesVerifiedReceipt?.(primary, proof))
  );
  const checkpointRejection = restoredRejectionHash || verifiedByJournal ? undefined : rejectionMatches;
  const uncommittedPrimary = candidatePrimary && !verifiedByJournal;
  const rejectedPrimary = deniedAttempt || journal?.rejected && !verifiedByJournal && (
    journal.hasRejectedPayload || candidatePrimary || journal.raw === primary ||
    (nativeRejectionBinding !== undefined && rejectionMatches === undefined) ||
    (journal.payloadError && hasNativeCommitEncoding(primary))
  );
  if (!primaryVerified || rejectedPrimary) {
    if (journal?.markerError && !deniedAttempt) throw journal.markerError;
    if (journal?.payloadError) throw journal.payloadError;
  }
  // Legacy v1 ledgers may use the same field order as a guarded write.
  // Only a rollback bound to these primary bytes can supersede a readable ledger.
  const nativeJournal = !primaryVerified || rejectedPrimary || uncommittedPrimary
    ? journal?.raw ?? (candidatePrimary ? journal?.committedRaw : undefined)
    : undefined;
  if (primaryError && !isStorageRowTooLarge(primaryError) &&
      (!journal?.rejected || nativeJournal === undefined)) {
    throw primaryError;
  }
  const recovery: (Recovery & { ledger: PersonalImportLedger }) | null = browserRecovery
    ? selectPersonalImportBrowserRecovery(browserRecovery, primary, primaryVerified, (raw) => parseLedger(raw, scope))
    : await readNativeRecovery(
        key, scope, primaryVerified, nativeJournal, restoredEmpty ? null : checkpoint, deniedAttempt || journal?.rejected,
        allowEmptyPrimary && primary === null && !primaryError && !journal && !restorationPending,
        checkpointRejection,
      );
  if (!recovery && primaryError) throw primaryError;
  if (!recovery && (deniedAttempt || uncommittedPrimary)) {
    throw new Error('無法確認匯入資料已還原，請保留此裝置上的資料並稍後重試。');
  }
  // A pending restoration bypasses the primary read, so its on-disk bytes
  // cannot be checked against the previous attempt before replacing the hashes.
  const preserveAttemptRejection = restorationPending || deniedAttempt || checkpointRejection !== undefined ||
    (uncommittedPrimary && recovery !== null && recovery.raw !== primary);
  return {
    primary, primaryVerified, browserRecovery, recovery, preserveAttemptRejection,
    restoredRejectionHash, receipt, backupReceipt,
  };
}

function isReadableLedger(raw: string | null, scope: PersonalImportScope): boolean {
  if (raw === null) return false;
  try {
    parsePersonalImportLedgerBody(raw, scope.schoolId, Platform.OS === 'web');
    return true;
  } catch {
    return false;
  }
}

async function readNativeRecovery(
  key: string,
  scope: PersonalImportScope,
  primaryVerified: boolean,
  nativeJournal: string | undefined,
  capturedCheckpoint?: Awaited<ReturnType<typeof readLegacyCheckpoint>>,
  rejected = false,
  allowEmptyPrimary = false,
  checkpointRejection?: (raw: string | null) => boolean,
): Promise<(Recovery & { ledger: PersonalImportLedger }) | null> {
  // A marked journal, bound checkpoint, or in-process rollback can
  // supersede an interrupted primary write.
  const pending = pendingRestorations.get(key);
  if (!primaryVerified || nativeJournal !== undefined || checkpointRejection) {
    const checkpoint = capturedCheckpoint !== undefined
      ? capturedCheckpoint
      : await readLegacyCheckpoint(key, scope).catch((error: unknown) => {
          // The legacy copy is optional when another rollback has authoritative bytes.
          if (!allowEmptyPrimary && pending === undefined && nativeJournal === undefined) throw error;
          return null;
        });
    if (checkpoint &&
        (!checkpointRejection || checkpointRejection(checkpoint.raw)) &&
        (pending === undefined || checkpoint.raw === pending.raw) &&
        (nativeJournal === undefined || (checkpoint.raw ?? 'null') === nativeJournal)) {
      return checkpoint;
    }
    if (pending) return { ...pending, ledger: parseLedger(pending.raw, scope) };
  }

  if (checkpointRejection) {
    throw new Error('無法確認匯入資料已還原，請保留此裝置上的資料並稍後重試。');
  }
  if (nativeJournal === undefined) return null;
  const raw = nativeJournal === 'null' ? null : nativeJournal;
  try {
    if (!nativeJournal) throw new Error('儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。');
    return { raw, ledger: parseLedger(raw, scope), source: 'journal' };
  } catch (error) {
    if (primaryVerified && !rejected) return null;
    throw error;
  }
}

async function readLegacyCheckpoint(
  key: string,
  scope: PersonalImportScope,
): Promise<(Recovery & { ledger: PersonalImportLedger }) | null> {
  const checkpoint = personalImportCheckpointKey(key);
  let encoded: string | null;
  try {
    [[, encoded]] = await AsyncStorage.multiGet([checkpoint]);
  } catch (error) {
    if (!isStorageRowTooLarge(error)) throw error;
    // JS multiGet coalesces requests and can report another key's error.
    // getItem issues its own native read, so only its error identifies this row.
    try {
      encoded = await AsyncStorage.getItem(checkpoint);
    } catch (checkpointError) {
      // A legacy wrapped ledger can exceed the row limit even when the primary fits.
      if (!isStorageRowTooLarge(checkpointError)) throw checkpointError;
      encoded = null;
    }
  }
  if (encoded !== null) {
    try {
      // Older builds wrapped the original ledger in a second layer of JSON.
      const publication = encoded.match(checkpointPublicationPattern);
      const stored = publication ? encoded.slice(publication[0].length) : encoded;
      if (!stored) return null;
      const raw: unknown = unwrapPersonalImportCheckpoint(stored);
      if (raw === null) return { raw: null, ledger: empty(), source: 'checkpoint', checkpoint: encoded };
      if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
        return { raw, ledger: parseLedger(raw, scope), source: 'checkpoint', checkpoint: encoded };
      }
    } catch {
      // An invalid legacy checkpoint cannot supply the ledger.
    }
  }

  return null;
}

async function retireNativeCheckpoint(
  key: string,
  adopted: string | undefined,
  assertWritable: () => void,
) {
  if (adopted === undefined) return true;
  const checkpoint = personalImportCheckpointKey(key);
  let current: string | null;
  try {
    current = await AsyncStorage.getItem(checkpoint);
  } catch {
    return false;
  }
  if (current === null) return true;
  if (current !== adopted) throw new Error('匯入資料已更新，請重新載入。');
  assertWritable();
  try {
    await AsyncStorage.multiRemove([checkpoint]);
    return await AsyncStorage.getItem(checkpoint) === null;
  } catch {
    return false;
  }
}

async function verifyNativeLedgerWrite(key: string, raw: string | null, retryRead = true) {
  // Android can store a SQLite row that CursorWindow cannot read back.
  if (await (retryRead ? readNativeStorage(key) : AsyncStorage.getItem(key)) !== raw) {
    throw new Error('無法確認匯入資料已儲存，請稍後再試。');
  }
}

async function restoreLedger(
  key: string,
  { raw, checkpoint }: Recovery,
  assertWritable: () => void,
  keepJournal: boolean,
) {
  if (raw === null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, raw);
  // Keep durable rejection evidence if restoration cannot be confirmed immediately.
  await verifyNativeLedgerWrite(key, raw, false);
  pendingRestorations.delete(key);
  if (keepJournal) return;
  try {
    if (!await retireNativeCheckpoint(key, checkpoint, assertWritable)) return;
    assertWritable();
  } catch {
    // The original bytes are restored. Keep restart recovery until a verified write.
    return;
  }
  clearPersonalImportRollback(key);
}

async function rollbackLedger(
  key: string,
  raw: string | null,
  assertWritable: () => void,
  keepJournal: boolean,
  rejectedPrimary?: string,
  retryPrimaryRestoration = false,
) {
  const recovery: Recovery = { raw };
  pendingRestorations.set(key, recovery);
  try {
    const checkpoint = personalImportCheckpointKey(key);
    if (await AsyncStorage.getItem(checkpoint) === null) {
      const encoded = raw ?? 'null';
      await AsyncStorage.multiSet([[checkpoint, encoded]]);
      recovery.checkpoint = encoded;
    }
  } catch {
    // Try restoring the primary anyway. The journal still holds the verified bytes.
  }
  try {
    await restoreLedger(key, recovery, assertWritable, keepJournal);
  } catch (error) {
    try {
      recordFailedPersonalImportRestoration(key, raw, rejectedPrimary);
    } catch {
      // The rollback payload and checkpoint may still preserve the original.
    }
    if (retryPrimaryRestoration) {
      // Repair the primary independently of the rejection sidecars.
      if (raw !== null) {
        try {
          await AsyncStorage.multiSet([[key, raw]]);
          if (await readNativeStorageWithBatchFallback(key) === raw) {
            pendingRestorations.delete(key);
            return;
          }
        } catch {
          // Keep the journal and checkpoint and invalidate the candidate.
        }
      }
      try {
        await AsyncStorage.removeItem(key).catch(() => AsyncStorage.multiRemove([key]));
        return;
      } catch {
        // The retained rejection evidence remains available for recovery.
      }
    }
    throw error;
  }
}

async function trackWrite(key: string, write: () => Promise<void>) {
  writeSequence += 1;
  const operation = Promise.resolve().then(write).finally(() => pendingWrites.delete(key));
  pendingWrites.set(key, operation.then(() => undefined, () => undefined));
  await operation;
}
type ImportChange = { scope: PersonalImportScope; source: 'local' | 'sync' };
const listeners = new Set<(change: ImportChange) => void>();
export function subscribePersonalImports(listener: (change: ImportChange) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function retainActiveBatches(
  batches: PersonalImportLedger['batches'],
  records: PersonalImportRecord[],
): PersonalImportLedger['batches'] {
  const activeIds = new Set(records.map((row) => row.batchId));
  return batches.filter((batch) => activeIds.has(batch.id));
}

/** Read after pending writes so a shared backup never uses an out-of-date UI snapshot. */
export async function snapshotPersonalImports(
  scope: PersonalImportScope,
  active = () => true,
): Promise<PersonalImportLedger> {
  await (locks.get(personalImportStorageKey(scope)) || Promise.resolve()).catch(() => undefined);
  if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
  const snapshot = await loadPersonalImports(scope);
  if (!active()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
  return snapshot;
}

export async function loadPersonalImports(
  scope: PersonalImportScope,
): Promise<PersonalImportLedger> {
  const key = personalImportStorageKey(scope);
  for (;;) {
    const pending = pendingWrites.get(key);
    if (pending) {
      await pending;
      continue;
    }
    const sequence = writeSequence;
    const { primary, recovery } = await readLedgerSnapshot(key, scope, true);
    if (Platform.OS === 'web' && primary !== await AsyncStorage.getItem(key)) continue;
    if (sequence !== writeSequence) continue;
    return recovery?.ledger ?? parseLedger(primary, scope);
  }
}

function hasNativeCommitEncoding(raw: string | null): boolean {
  return raw?.endsWith(',"version":1}') === true &&
    (raw.startsWith('{"batches":') || raw.startsWith('{"records":'));
}

function encodeNativeReplacement({ version, records, batches, ...metadata }: PersonalImportLedger) {
  // Use a distinct field order for the replacement when retirement fails.
  // Replacing the same bytes in a different order fits at the same row limit.
  return JSON.stringify({ batches, records, ...metadata, version });
}

function encodeNativeFirstWrite({ version, records, ...ledger }: PersonalImportLedger) {
  return JSON.stringify({ records, ...ledger, version });
}

function parseLedger(raw: string | null, scope: PersonalImportScope): PersonalImportLedger {
  const web = Platform.OS === 'web';
  const stored = !web ? raw?.replace(nativeRestoredRejectionPattern, '}') ?? null : raw;
  const ledger = parsePersonalImportLedger(stored, scope.schoolId, web);
  if (web || !hasNativeCommitEncoding(stored)) return ledger;
  return nativeLedgerInDefaultOrder(ledger);
}

function nativeLedgerInDefaultOrder({ version, records, batches, ...metadata }: PersonalImportLedger) {
  return { version, records, batches, ...metadata };
}

/** A verified operation may require uninterrupted verification through its first commit. */
export type PersonalImportWriteGuard =
  | (() => boolean)
  | {
      canContinue: () => boolean;
      canCommitFirstWrite?: () => boolean;
    };

export function mutatePersonalImportLedger<T>(
  scope: PersonalImportScope,
  guard: PersonalImportWriteGuard,
  update: (
    ledger: PersonalImportLedger,
    checkpoint: (ledger: PersonalImportLedger) => Promise<void>,
    assertSnapshot: () => void,
  ) =>
    | { ledger: PersonalImportLedger; result: T }
    | Promise<{ ledger: PersonalImportLedger; result: T }>,
  source: ImportChange['source'] = 'local',
  options: { allowNativePrimaryOnly?: boolean } = {},
): Promise<T> {
  const canContinue = typeof guard === 'function' ? guard : guard.canContinue;
  const key = personalImportStorageKey(scope);
  const previous = locks.get(key);
  const task = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => withPersonalImportWriteLock(key, async (assertLockHeld, lease, markCommitted) => {
      let hasPersisted = false;
      const assertWritable = () => {
        assertLockHeld();
        if (!hasPersisted && typeof guard !== 'function' && guard.canCommitFirstWrite?.() === false) {
          throw new Error('目前無法確認行事曆可寫入，請稍後再試。');
        }
        if (!canContinue()) throw new Error('帳號或學校已切換，請重新開啟匯入。');
        assertLockHeld();
      };
      assertWritable();
      const {
        primary, primaryVerified, browserRecovery, recovery, preserveAttemptRejection,
        restoredRejectionHash, receipt, backupReceipt,
      } = await readLedgerSnapshot(key, scope, options.allowNativePrimaryOnly);
      let currentReceipt = receipt;
      let currentBackupReceipt = backupReceipt;
      let primaryRaw = primary;
      let persistedRaw = recovery ? recovery.raw : primaryRaw;
      const current = recovery?.ledger ?? parseLedger(persistedRaw, scope);
      assertWritable();
      let persisted = current;
      const recoveryCheck = () => ({
        verifyCheckpoint: !hasPersisted && !primaryVerified,
        verifyJournal: !hasPersisted && (!primaryVerified || recovery?.source === 'journal'),
        adopted: hasPersisted ? undefined : recovery?.source,
      });
      const assertSnapshot = () => {
        assertWritable();
        if (browserRecovery) {
          const { verifyCheckpoint, verifyJournal, adopted } = recoveryCheck();
          browserRecovery.assertSnapshot(primaryRaw, verifyCheckpoint, verifyJournal, adopted);
        }
      };
      const checkpoint = async (ledger: PersonalImportLedger) => {
        assertWritable();
        const serialized = JSON.stringify(ledger);
        if (serialized === JSON.stringify(persisted)) return;
        const raw = !browserRecovery && hasNativeCommitEncoding(serialized)
          ? JSON.stringify(nativeLedgerInDefaultOrder(ledger))
          : serialized;
        // Keep the recovery copy authoritative until the replacement commits,
        // even if the recovered version no longer fits in AsyncStorage.
        const needsJournal = typeof guard !== 'function' || restoredRejectionHash !== undefined ||
          (recovery !== null && !hasPersisted) || hasNativeCommitEncoding(primaryRaw);
        const write = async () => {
          let writtenRaw = raw;
          if (browserRecovery) {
            writtenRaw = commitWebPersonalImports(
              key, primaryRaw, raw, assertWritable, browserRecovery,
              recoveryCheck(),
              needsJournal ? { raw: persistedRaw } : undefined,
              lease,
            );
          } else if (!needsJournal) {
            await AsyncStorage.setItem(key, writtenRaw);
          } else {
            const adoptedCheckpoint = hasPersisted ? undefined : recovery?.checkpoint;
            if (adoptedCheckpoint !== undefined &&
                await AsyncStorage.getItem(personalImportCheckpointKey(key)) !== adoptedCheckpoint) {
              throw new Error('匯入資料已更新，請重新載入。');
            }
            assertWritable();
            const primaryCommitted = hasPersisted || (primaryVerified && recovery === null);
            let cleaningRecovery = false;
            // Prepare rollback for either write before replacing the primary.
            const firstRaw = encodeNativeFirstWrite(ledger);
            const replacement = encodeNativeReplacement(ledger);
            let journal: ReturnType<typeof preparePersonalImportRollback> | undefined;
            try {
              journal = preparePersonalImportRollback(key, persistedRaw, primaryCommitted, {
                preferBoundPrimary: options.allowNativePrimaryOnly && primaryCommitted,
                first: firstRaw,
                replacement,
                fallback: raw,
                restoredRejectionHash,
                preserveRejection: !hasPersisted && preserveAttemptRejection,
              });
            } catch (error) {
              if (!(error instanceof NativeRollbackUnavailableError)) throw error;
              // AsyncStorage can support an ordinary save from a readable
              // primary or a confirmed empty ledger without an auxiliary copy.
              const emptyPrimary = primary === null && recovery === null;
              if (!options.allowNativePrimaryOnly || (!primaryCommitted && !emptyPrimary)) {
                throw error.failure;
              }
            }
            assertWritable();
            let newReceipt: string | undefined;
            let writingFileReceipt = false;
            let previousFileReceipt: string | undefined;
            let writingBackupReceipt = false;
            let publishingRollbackResolution = false;
            let previousRollbackResolution: string | null = null;
            let writingRollbackResolution = false;
            let previousCheckpoint: string | null = null;
            let writingCheckpointPublication = false;
            const publishCheckpoint = async (proof: string) => {
              const checkpointKey = personalImportCheckpointKey(key);
              previousCheckpoint = await readNativeStorageWithBatchFallback(checkpointKey);
              assertWritable();
              const priorRecovery = previousCheckpoint?.replace(checkpointPublicationPattern, '') ?? '';
              const publication = 'verified:' + proof.replace(/\n/g, ' ') + '\n' + priorRecovery;
              writingCheckpointPublication = true;
              await writeNativeReceipt(checkpointKey, publication);
              return await readNativeStorageWithBatchFallback(checkpointKey) === publication;
            };
            try {
              const continuedRejection = !journal ? restoredRejectionHash : undefined;
              writtenRaw = journal ? firstRaw : raw;
              if (continuedRejection) {
                // Carry the original rejection binding in the ledger write itself.
                writtenRaw = raw.slice(0, -1) + ',"nativeRestoredRejection":"' + continuedRejection + '"}';
              }
              await AsyncStorage.setItem(key, writtenRaw);
              assertWritable();
              await verifyNativeLedgerWrite(key, writtenRaw);
              assertWritable();
              // Keep the rollback copy through cleanup and the final authority check.
              cleaningRecovery = true;
              const checkpointRetired = adoptedCheckpoint === undefined ||
                await retireNativeCheckpoint(key, adoptedCheckpoint, assertWritable);
              assertWritable();
              if (journal && !journal.retire(assertWritable, checkpointRetired, firstRaw)) {
                assertWritable();
                try {
                  journal.preparePrimaryCommit();
                  await AsyncStorage.setItem(key, replacement);
                  writtenRaw = replacement;
                } catch {
                  // Confirm the first write survived a failed replacement before
                  // publishing its bytes. A rejected write can still reach disk.
                  writtenRaw = firstRaw;
                }
                assertWritable();
                // Both encodings hold the same verified ledger. A failed
                // read here cannot undo verification of the first write.
                const replacementReadback = await readNativeStorageWithBatchFallback(key).catch(() => undefined);
                if (replacementReadback === replacement || replacementReadback === firstRaw) {
                  writtenRaw = replacementReadback;
                }
                assertWritable();
                const published = journal.publishVerifiedPrimary(
                  writtenRaw, assertWritable,
                );
                if (!published) {
                  // Try the ordinary encoding, then publish a receipt for
                  // whichever encoding was persisted.
                  assertWritable();
                  let fallbackWritten = false;
                  try {
                    await AsyncStorage.setItem(key, raw);
                    fallbackWritten = true;
                  } catch {
                    // The optional rewrite may fail before or after reaching disk.
                  }
                  assertWritable();
                  const readback = await readNativeStorageWithBatchFallback(key).catch(() => undefined);
                  if (readback === raw || (readback === undefined && fallbackWritten)) {
                    writtenRaw = raw;
                    newReceipt = journal.verificationReceipt(raw);
                  } else {
                    if (readback === replacement || readback === firstRaw) writtenRaw = readback;
                    newReceipt = journal.verificationReceipt(writtenRaw);
                  }
                }
                assertWritable();
              }
              if (!journal && !continuedRejection) {
                const rollback = capturePersonalImportRollback(key);
                newReceipt = rollback?.matchesFallbackPrimary?.(writtenRaw)
                  ? rollback.verificationReceipt?.(writtenRaw)
                  : sha256(persistedRaw ?? 'null') + '\n' + sha256(writtenRaw);
              }
              // Keep a small proof in AsyncStorage when the document directory
              // cannot publish the verified attempt or retire an old rejection.
              if (continuedRejection) {
                newReceipt = continuedRejection + '\n' + sha256(writtenRaw);
              }
              if (newReceipt !== undefined) {
                assertWritable();
                try {
                  await writeNativeReceipt(nativeReceiptKey(key), newReceipt);
                  if (await readNativeReceipt(nativeReceiptKey(key)) !== newReceipt) {
                    throw new Error('無法確認匯入資料的儲存憑據。');
                  }
                } catch {
                  // Both AsyncStorage APIs can fail on the same native key.
                  // Publish the verified bytes through the document directory.
                  assertWritable();
                  previousFileReceipt = readNativeVerificationReceipt(key);
                  writingFileReceipt = true;
                  try {
                    writeNativeVerificationReceipt(key, newReceipt);
                  } catch {
                    // Retain the attempt binding when both the usual receipt
                    // key and the document directory are unavailable.
                    assertWritable();
                    const backupKey = nativeBackupReceiptKey(key);
                    writingBackupReceipt = true;
                    try {
                      await writeNativeReceipt(backupKey, newReceipt);
                      if (await readNativeReceipt(backupKey) !== newReceipt) {
                        throw new Error('無法確認匯入資料的儲存憑據。');
                      }
                    } catch {
                      // Resolve the rollback itself when neither receipt store
                      // can confirm publication of the already verified primary.
                      assertWritable();
                      publishingRollbackResolution = true;
                      try {
                        publishNativeRollbackResolution(key, newReceipt);
                      } catch {
                        // A document-directory fault can affect both receipt
                        // and rejection files. Keep the same attempt binding
                        // in storage that does not depend on either file.
                        const resolutionKey = nativeRollbackResolutionKey(key);
                        previousRollbackResolution = await readNativeReceipt(resolutionKey);
                        assertWritable();
                        writingRollbackResolution = true;
                        try {
                          await writeNativeReceipt(resolutionKey, newReceipt);
                          if (await readNativeReceipt(resolutionKey) !== newReceipt) {
                            throw new Error('無法確認匯入資料的還原狀態。');
                          }
                        } catch {
                          assertWritable();
                          if (!await publishCheckpoint(newReceipt)) {
                            throw new Error('無法確認匯入資料的儲存憑據。');
                          }
                          assertWritable();
                          clearVerifiedNativeRollback(key);
                        }
                      }
                    }
                  }
                }
                assertWritable();
                if (!writingCheckpointPublication && journal) {
                  try {
                    await publishCheckpoint(newReceipt);
                  } catch {
                    // The attempt already has a verified receipt.
                  }
                }
                assertWritable();
                if (!writingFileReceipt) currentReceipt = newReceipt;
                if (writingBackupReceipt && !publishingRollbackResolution) currentBackupReceipt = newReceipt;
              }
              assertWritable();
              pendingRestorations.delete(key);
            } catch (error) {
              if (writingCheckpointPublication) {
                const checkpointKey = personalImportCheckpointKey(key);
                try {
                  if (previousCheckpoint === null) await AsyncStorage.removeItem(checkpointKey);
                  else await writeNativeReceipt(checkpointKey, previousCheckpoint);
                } catch {
                  // Continue restoring the rejection, journal and primary.
                }
              }
              if (writingRollbackResolution) {
                const resolutionKey = nativeRollbackResolutionKey(key);
                try {
                  if (previousRollbackResolution === null) await AsyncStorage.removeItem(resolutionKey);
                  else await writeNativeReceipt(resolutionKey, previousRollbackResolution);
                } catch {
                  // Continue restoring the rejection, journal and primary.
                }
              }
              if (publishingRollbackResolution) {
                try {
                  recordFailedPersonalImportRestoration(key, persistedRaw);
                } catch {
                  // Continue restoring the journal and primary.
                }
              }
              if (writingBackupReceipt) {
                const backupKey = nativeBackupReceiptKey(key);
                try {
                  if (currentBackupReceipt === null) await AsyncStorage.removeItem(backupKey);
                  else await writeNativeReceipt(backupKey, currentBackupReceipt);
                } catch {
                  // Continue with the rollback journal and checkpoint.
                }
              }
              if (writingFileReceipt) {
                try {
                  if (previousFileReceipt === undefined) clearNativeVerificationReceipt(key);
                  else writeNativeVerificationReceipt(key, previousFileReceipt);
                } catch {
                  // Continue with the rollback journal and checkpoint.
                }
              }
              if (newReceipt !== undefined) {
                try {
                  if (currentReceipt === null) await AsyncStorage.removeItem(nativeReceiptKey(key));
                  else await writeNativeReceipt(nativeReceiptKey(key), currentReceipt);
                } catch {
                  // Preserve rejection through the rollback journal and checkpoint.
                }
              }
              let retryPrimaryRestoration = false;
              try {
                await journal?.retainRejection((attempt) => {
                  retryPrimaryRestoration = true;
                  return writeNativeReceipt(nativeRejectionAttemptKey(key), attempt);
                });
              } catch {
                // Still try to restore the original primary and checkpoint.
              }
              await rollbackLedger(
                key, persistedRaw, assertWritable, cleaningRecovery,
                nativeRestoredRejectionPattern.test(writtenRaw) ? writtenRaw : undefined,
                retryPrimaryRestoration,
              );
              if (publishingRollbackResolution) {
                try {
                  assertWritable();
                  clearVerifiedNativeRollback(key);
                } catch {
                  // Keep the recovery evidence after scope revocation.
                }
              }
              throw error;
            }
          }
          hasPersisted = true;
          primaryRaw = writtenRaw;
          persistedRaw = browserRecovery ? raw : writtenRaw;
          persisted = ledger;
          markCommitted?.();
          for (const listener of listeners) {
            try {
              listener({ scope, source });
            } catch {
              /* A view cannot invalidate a durable write. */
            }
          }
        };
        if (!browserRecovery && !needsJournal) return write();
        // Readers wait until the write commits or rollback establishes the verified ledger.
        await trackWrite(key, write);
      };
      const { ledger, result } = await update(current, checkpoint, assertSnapshot);
      await checkpoint(ledger);
      return result;
    }));
  locks.set(key, task);
  void task
    .finally(() => {
      if (locks.get(key) === task) locks.delete(key);
    })
    .catch(() => undefined);
  return task;
}
const mutate = mutatePersonalImportLedger;

export function appendPersonalImports(
  scope: PersonalImportScope,
  rows: PersonalImportRow[],
  guard: PersonalImportWriteGuard = () => true,
  options: { restoreBackup?: boolean; protectCatalogTimetableSlots?: boolean; expectedRecordsJson?: string } = {},
) {
  return mutate(scope, guard, (current) => {
    if (rows.some((row) => row.schoolId !== scope.schoolId))
      throw new Error('資料的學校與目前選擇不同。');
    // A conflict acknowledgement is valid only for the exact records reviewed.
    if (options.expectedRecordsJson !== undefined && JSON.stringify(current.records) !== options.expectedRecordsJson)
      throw new Error('個人課表已更新，請重新核對衝堂後再加入。');
    if (options.protectCatalogTimetableSlots) {
      // Use the same source-change check as the review screen, but repeat it
      // under the owner/school write lock so direct calls cannot bypass it.
      const changed = findCatalogSameSlotChange(rows, current.records);
      if (changed === 'teacher')
        throw new Error('相同課號、班別與時段已有不同教師的個人紀錄；請先核對原有資料。');
      if (changed === 'room')
        throw new Error('相同課號、班別與時段已有不同教室的個人紀錄；請先核對原有資料。');
      if (changed === 'title')
        throw new Error('相同課號、班別與時段已有不同課名的個人紀錄；請先核對原有資料。');
      if (changed === 'time')
        throw new Error('相同課號與班別的原有上課時段與官方資料不同；請先核對原有資料。');
    }
    const id = createPersonalImportId();
    const createdAt = new Date().toISOString();
    const incoming = options.restoreBackup
      ? preparePersonalImportBackupRestore(rows, current.records)
      : rows;
    const planned = planPersonalImport(current.records, incoming, {
      batchId: id,
      importedAt: createdAt,
      periodProfile: periodProfileForSchool(scope.schoolId),
    });
    const errors = planned.issues.filter(
      (issue) => issue.severity === 'error' || issue.code === 'duplicate-metadata-conflict',
    );
    if (errors.length) throw new Error(`這次沒有儲存。${errors[0].message}`);
    if (planned.records.length > PERSONAL_IMPORT_BACKUP_MAX_RECORDS)
      throw new Error('這台裝置已達 2,000 筆上限，請先備份並移除不需要的紀錄。');
    const ledger: PersonalImportLedger = {
      ...current,
      version: 1,
      records: planned.records,
      batches: planned.added.length
        ? [...current.batches, { id, createdAt, count: planned.added.length }]
        : current.batches,
    };
    return {
      ledger,
      result: { ledger, added: planned.added.length, duplicates: planned.duplicates.length },
    };
  }, 'local', { allowNativePrimaryOnly: !options.restoreBackup });
}

/** A later edit gets a new revision owner, so undoing its original batch cannot remove it. */
export function editPersonalImport(
  scope: PersonalImportScope,
  before: PersonalImportRecord,
  next: PersonalImportRow,
  guard: PersonalImportWriteGuard = () => true,
) {
  return mutate(scope, guard, (current) => {
    const index = current.records.findIndex((row) => row.id === before.id);
    if (index < 0 || JSON.stringify(current.records[index]) !== JSON.stringify(before)) {
      throw new Error('這筆資料已變更，請重新載入後編輯。');
    }
    if (next.id !== before.id || next.schoolId !== scope.schoolId)
      throw new Error('資料範圍不符。');
    const errors = validatePersonalImportRow(next, {
      periodProfile: periodProfileForSchool(scope.schoolId),
    }).filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(errors[0].message);
    const mapped = mapPersonalImportPeriods(next, {
      periodProfile: periodProfileForSchool(scope.schoolId),
    });
    if (
      current.records.some(
        (row) => row.id !== before.id && personalImportKey(row) === personalImportKey(mapped),
      )
    )
      throw new Error('已有相同資料，請核對後再更新。');
    const record: PersonalImportRecord = {
      ...mapped,
      batchId: `revision:${createPersonalImportId()}`,
      importedAt: before.importedAt,
    };
    const records = current.records.map((row, i) => (i === index ? record : row));
    const ledger = {
      ...current,
      records,
      batches: retainActiveBatches(current.batches, records),
    };
    return { ledger, result: ledger };
  }, 'local', { allowNativePrimaryOnly: true });
}

/** Remove one exact revision, never another tab's newer edit or a different school's row. */
export function deletePersonalImport(
  scope: PersonalImportScope,
  before: PersonalImportRecord,
  guard: PersonalImportWriteGuard = () => true,
) {
  return mutate(scope, guard, (current) => {
    const found = current.records.find((row) => row.id === before.id);
    if (!found || JSON.stringify(found) !== JSON.stringify(before)) {
      throw new Error('這筆資料已變更，請重新載入後再移除。');
    }
    if (found.schoolId !== scope.schoolId) throw new Error('資料範圍不符。');
    const records = current.records.filter((row) => row.id !== before.id);
    const ledger = {
      ...current,
      records,
      batches: retainActiveBatches(current.batches, records),
    };
    return { ledger, result: ledger };
  });
}

export function undoLastPersonalImport(
  scope: PersonalImportScope,
  expectedBatchId: string,
  guard: PersonalImportWriteGuard = () => true,
) {
  return mutate(scope, guard, (current) => {
    const last = current.batches[current.batches.length - 1];
    if (!last || last.id !== expectedBatchId)
      throw new Error('匯入紀錄已更新，請重新載入後再撤回。');
    const records = current.records.filter((row) => row.batchId !== last.id);
    const ledger = { ...current, records, batches: current.batches.slice(0, -1) };
    return { ledger, result: { ledger, removed: current.records.length - records.length } };
  });
}

/** The grid uses the school's official period table. Unknown schools stay off the grid. */
export function personalImportCourses(
  records: PersonalImportRecord[],
  schoolId: string,
): PersonalCourse[] {
  const profile = periodProfileForSchool(schoolId);
  if (!profile) return [];
  const slots = periodCount(profile);
  return records
    .filter(
      (row) =>
        row.kind === 'timetable' &&
        row.schoolId === schoolId &&
        Number.isInteger(row.dayOfWeek) &&
        row.dayOfWeek! >= 1 &&
        row.dayOfWeek! <= 7 &&
        Number.isInteger(row.startPeriod) &&
        Number.isInteger(row.endPeriod) &&
        row.startPeriod! >= 1 &&
        row.endPeriod! >= row.startPeriod! &&
        row.endPeriod! <= slots,
    )
    .map((row) => ({
      id: `import:${row.id}`,
      name: row.title,
      day: row.dayOfWeek!,
      start: row.startPeriod!,
      end: row.endPeriod!,
      teacher: row.teacher || '',
      room: row.location || '',
      color: 'blue',
    }));
}

/** Unknown or different academic terms must never be combined into one busy-time view. */
export function selectPersonalTimetableCourses(
  base: { courses: PersonalCourse[]; meta: { year: string; semester: string } } | null,
  imported: PersonalImportRecord[],
  schoolId: string,
  selectedView: string | undefined,
): PersonalCourse[] {
  const baseTerm =
    base?.meta.year && base.meta.semester ? `${base.meta.year}／${base.meta.semester}` : '';
  const term = selectedView === 'legacy' ? baseTerm : selectedView;
  const legacy =
    selectedView === 'legacy' || (baseTerm && term === baseTerm) ? base?.courses || [] : [];
  const projected = term
    ? personalImportCourses(
        imported.filter((row) => `${row.academicYear}／${row.semester}` === term),
        schoolId,
      )
    : [];
  return [
    ...legacy,
    ...projected.filter(
      (course) =>
        !legacy.some((old) => samePersonalCourse(old, course)),
    ),
  ];
}
