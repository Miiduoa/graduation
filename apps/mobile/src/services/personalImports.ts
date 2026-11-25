import AsyncStorage from '@react-native-async-storage/async-storage';
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
  clearPersonalImportRollback,
  commitWebPersonalImports,
  NativeRollbackUnavailableError,
  preparePersonalImportRollback,
  recordFailedPersonalImportRestoration,
  withPersonalImportWriteLock,
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
      primary = await AsyncStorage.getItem(key);
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
  const checkpointRejection = (primaryVerified || restoredEmpty) && rejectionMatches?.(primary)
    ? undefined : rejectionMatches;
  const verifiedByJournal = primary !== null && journal?.matchesVerifiedPrimary?.(primary) === true;
  const attemptedPrimary = primary !== null && journal?.matchesAttemptedPrimary?.(primary) === true;
  const rejectedPrimary = journal?.rejected && (
    journal.hasRejectedPayload || attemptedPrimary || journal.raw === primary ||
    (primary !== null && journal.matchesFallbackPrimary?.(primary)) ||
    (journal.payloadError && hasNativeCommitEncoding(primary))
  );
  if (!primaryVerified || rejectedPrimary) {
    if (journal?.markerError) throw journal.markerError;
    if (journal?.payloadError) throw journal.payloadError;
  }
  // Legacy v1 ledgers may use the same field order as a guarded write.
  // Only a rollback bound to these primary bytes can supersede a readable ledger.
  const nativeJournal = !primaryVerified || rejectedPrimary || (attemptedPrimary && !verifiedByJournal)
    ? journal?.raw ?? (attemptedPrimary ? journal?.committedRaw : undefined)
    : undefined;
  if (primaryError && nativeJournal === undefined && !isStorageRowTooLarge(primaryError)) {
    throw primaryError;
  }
  const recovery: (Recovery & { ledger: PersonalImportLedger }) | null = browserRecovery
    ? selectPersonalImportBrowserRecovery(browserRecovery, primary, primaryVerified, (raw) => parseLedger(raw, scope))
    : await readNativeRecovery(key, scope, primaryVerified, nativeJournal, restoredEmpty ? null : checkpoint, journal?.rejected,
        allowEmptyPrimary && primary === null && !primaryError && !journal && !restorationPending,
        checkpointRejection);
  if (!recovery && primaryError) throw primaryError;
  // A pending restoration bypasses the primary read, so its on-disk bytes
  // cannot be checked against the previous attempt before replacing the hashes.
  const preserveAttemptRejection = restorationPending || checkpointRejection !== undefined ||
    (attemptedPrimary && !verifiedByJournal && recovery !== null && recovery.raw !== primary);
  return { primary, primaryVerified, browserRecovery, recovery, preserveAttemptRejection };
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
      const raw: unknown = unwrapPersonalImportCheckpoint(encoded);
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

async function verifyNativeLedgerWrite(key: string, raw: string | null) {
  // Android can store a SQLite row that CursorWindow cannot read back.
  if (await AsyncStorage.getItem(key) !== raw) {
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
  await verifyNativeLedgerWrite(key, raw);
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
      recordFailedPersonalImportRestoration(key, raw);
    } catch {
      // The rollback payload and checkpoint may still preserve the original.
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
  const ledger = parsePersonalImportLedger(raw, scope.schoolId, web);
  if (web || !hasNativeCommitEncoding(raw)) return ledger;
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
      const { primary, primaryVerified, browserRecovery, recovery, preserveAttemptRejection } =
        await readLedgerSnapshot(key, scope, options.allowNativePrimaryOnly);
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
        const needsJournal = typeof guard !== 'function' ||
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
                first: firstRaw,
                replacement,
                fallback: raw,
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
            try {
              writtenRaw = journal ? firstRaw : raw;
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
                await verifyNativeLedgerWrite(key, writtenRaw);
                assertWritable();
                const published = journal.publishVerifiedPrimary(
                  writtenRaw, assertWritable, writtenRaw === firstRaw && options.allowNativePrimaryOnly,
                );
                if (!published) {
                  // Persist the ordinary encoding outside the tentative hashes
                  // so a restart can use it without a publication file.
                  assertWritable();
                  await AsyncStorage.setItem(key, raw);
                  assertWritable();
                  await verifyNativeLedgerWrite(key, raw);
                  writtenRaw = raw;
                }
                assertWritable();
              }
              pendingRestorations.delete(key);
            } catch (error) {
              try {
                journal?.retainRejection();
              } catch {
                // Still try to restore the original primary and checkpoint.
              }
              await rollbackLedger(key, persistedRaw, assertWritable, cleaningRecovery);
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
