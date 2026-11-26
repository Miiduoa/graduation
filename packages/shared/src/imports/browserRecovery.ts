import { sha256 } from 'js-sha256';
import { periodProfileForSchool } from '../timetable/periods';
import { parsePersonalImportSyncState, type PersonalImportSyncState } from './sync';
import type { PersonalImportRecord } from './types';
import { validatePersonalImportRow } from './validation';

export const personalImportCheckpointKey = (key: string) => `${key}:checkpoint`;
export const personalImportWebJournalPrefix = 'campus.personal-imports.rollback.v1:';
export const personalImportWebJournalKey = (key: string) =>
  personalImportWebJournalPrefix + sha256(key);

// Earlier writers put version first. Moving it to the end marks the commit
// without adding bytes or changing the v1 schema read by older clients.
export const personalImportBrowserCommitSuffix = ',"version":1}';

export function serializePersonalImportBrowserCommit({ version, ...ledger }: { version: 1 }) {
  return JSON.stringify({ ...ledger, version });
}

// Legacy writers never placed version between the metadata and records.
function hasDetachedBrowserCommit(value: Record<string, unknown> | null) {
  if (value?.version !== 1) return false;
  const fields = Object.keys(value);
  return fields.length >= 3 &&
    fields.at(-2) === 'version' && fields.at(-1) === 'records';
}

export function hasWebPersonalImportCommit(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    if (value?.['$commit'] === 1 && !('version' in value)) return true;
    return value?.version === 1 && (
      typeof value.webCommit === 'string' ||
      hasDetachedBrowserCommit(value) ||
      raw.endsWith(personalImportBrowserCommitSuffix) ||
      (raw.endsWith('\t') && raw === JSON.stringify(value) + '\t')
    );
  } catch {
    // The ledger parser reports invalid primary data if there is no recovery copy.
    return false;
  }
}

export function unwrapPersonalImportCheckpoint(encoded: string): unknown {
  return encoded.trimStart().startsWith('{') ? encoded : JSON.parse(encoded);
}

export function writePersonalImportBrowserPrimary(storage: Storage, key: string, published: string) {
  storage.setItem(key, published);
  let current: string | null;
  try {
    current = storage.getItem(key);
  } catch {
    // setItem completed atomically under the write lock. A read error cannot undo it.
    return;
  }
  if (current !== published) {
    throw new Error('匯入資料已在另一個分頁更新，請重新載入。');
  }
}

export function capturePersonalImportBrowserRecovery(
  storage: Storage,
  key: string,
) {
  const entries = {
    journal: personalImportWebJournalKey(key),
    checkpoint: personalImportCheckpointKey(key),
  };
  const readErrors: unknown[] = [];
  let journalUnreadable = false;
  let checkpointUnreadable = false;
  const readCopy = (entry: string) => {
    try {
      return storage.getItem(entry);
    } catch (error) {
      if (entry === entries.journal) journalUnreadable = true;
      else checkpointUnreadable = true;
      readErrors.push(error);
      return null;
    }
  };
  const copies = {
    journal: readCopy(entries.journal),
    checkpoint: readCopy(entries.checkpoint),
  };

  return {
    ...copies,
    readErrors,
    mayHaveCopies: readErrors.length > 0 || copies.journal !== null || copies.checkpoint !== null,
    assertSnapshot(
      primary: string | null,
      checkCheckpoint: boolean,
      checkJournal: boolean,
      adopted?: PersonalImportRecoverySource,
    ) {
      // Journal recovery can proceed without a checkpoint snapshot when the
      // checkpoint was already unreadable during recovery.
      const verifyCheckpoint = checkCheckpoint && !(checkpointUnreadable && adopted === 'journal');
      if (storage.getItem(key) !== primary ||
          (verifyCheckpoint && storage.getItem(entries.checkpoint) !== copies.checkpoint) ||
          (checkJournal && storage.getItem(entries.journal) !== copies.journal)) {
        throw new Error('匯入資料已在另一個分頁更新，請重新載入。');
      }
    },
    detachJournal(published: string) {
      if (journalUnreadable) {
        const { version, records, ...metadata } = JSON.parse(published);
        // Keep the v1 schema and byte count, including on the quota retry.
        return JSON.stringify({ ...metadata, version, records });
      }
      // A verified commit must remain readable even if its old journal survives.
      const matchesJournal = (raw: string) =>
        readWebPersonalImportRollback(copies.journal, raw, true)?.bound === true;
      if (!matchesJournal(published)) return published;

      // Preserve the byte count for a quota-limited retry. At most two encodings
      // can match the journal, so try distinct orders of the v1 fields.
      const { version, records, ...metadata } = JSON.parse(published);
      return [
        JSON.stringify({ ...metadata, records, version }),
        JSON.stringify({ version, records, ...metadata }),
        JSON.stringify({ records, version, ...metadata }),
      ].find((raw) => !matchesJournal(raw)) ?? published;
    },
    retire(published: string, source: keyof typeof copies) {
      const entry = entries[source];
      const raw = copies[source];
      try {
        if (raw !== null && storage.getItem(key) === published && storage.getItem(entry) === raw) {
          storage.removeItem(entry);
        }
      } catch {
        // The primary write has completed. Keep any surviving copy.
      }
    },
  };
}

const compactVersionKey = '$commit';
const fingerprint = (raw: string | null) => sha256(raw ?? 'null');

function readWebPersonalImportRollback(
  encoded: string | null,
  primary: string | null,
  primaryVerified: boolean,
): { raw: string | null; bound: boolean } | undefined {
  if (encoded === null) return undefined;
  let journal: unknown;
  try {
    journal = JSON.parse(encoded);
  } catch {
    return undefined;
  }
  // Unbound legacy copies cannot establish that a verified primary was interrupted.
  if (!journal || typeof journal !== 'object' || 'version' in journal ||
      !('id' in journal) || typeof journal.id !== 'string' ||
      !('before' in journal) || typeof journal.before !== 'string' ||
      !('attempted' in journal) || typeof journal.attempted !== 'string' ||
      !('original' in journal) || (journal.original !== null && typeof journal.original !== 'string')) {
    if (primaryVerified) return undefined;
    const raw = typeof journal === 'string' ? journal : encoded;
    return { raw: raw === 'null' ? null : raw, bound: false };
  }
  const current = fingerprint(primary);
  if (current !== journal.before && current !== journal.attempted) return undefined;
  const original = typeof journal.original === 'string' ? journal.original : 'null';
  if (fingerprint(original) !== journal.before) return undefined;
  return { raw: original === 'null' ? null : original, bound: true };
}

export function parsePersonalImportStorageJson(raw: string, web: boolean) {
  const value = JSON.parse(raw);
  if (web && value?.[compactVersionKey] === 1 && !('version' in value)) {
    const { [compactVersionKey]: version, ...ledger } = value;
    return { version, ...ledger };
  }
  if (web && (raw.endsWith(personalImportBrowserCommitSuffix) || hasDetachedBrowserCommit(value))) {
    const { version, ...ledger } = value;
    return { version, ...ledger };
  }
  return value;
}

export type PersonalImportRecoverySource = 'checkpoint' | 'journal';

export function selectPersonalImportBrowserRecovery<T>(
  copies: ReturnType<typeof capturePersonalImportBrowserRecovery>,
  primary: string | null,
  primaryVerified: boolean,
  parse: (raw: string | null) => T,
): { raw: string | null; ledger: T; source: PersonalImportRecoverySource } | null {
  const journal = readWebPersonalImportRollback(copies.journal, primary, primaryVerified);
  const recoverJournal = () => {
    if (!journal || journal.raw === '') return null;
    try {
      return { raw: journal.raw, ledger: parse(journal.raw), source: 'journal' as const };
    } catch {
      return null;
    }
  };
  if (journal?.bound && primaryVerified && primary !== null && hasDetachedBrowserCommit(JSON.parse(primary))) {
    try {
      parse(primary);
      return null;
    } catch {
      // A bound journal can still recover a primary with damaged sync state.
    }
  }
  // A journal tied to this primary describes an interrupted write.
  const interrupted = journal?.bound ? recoverJournal() : null;
  if (interrupted) return interrupted;

  if (!primaryVerified && copies.checkpoint !== null) {
    try {
      const raw = unwrapPersonalImportCheckpoint(copies.checkpoint);
      if (raw === null) return { raw: null, ledger: parse(null), source: 'checkpoint' };
      if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
        return { raw, ledger: parse(raw), source: 'checkpoint' };
      }
    } catch {
      // Keep damaged copies for manual recovery.
    }
  }

  const legacy = journal?.bound ? null : recoverJournal();
  // A readable primary can still be displayed when an auxiliary key is
  // unavailable. Without usable data, surface the I/O failure instead of
  // presenting an empty ledger.
  if (!legacy && !primaryVerified && copies.readErrors.length > 0) {
    throw copies.readErrors[0];
  }
  return legacy;
}

export function isPersonalImportBatchHistory(value: unknown): value is Array<{
  id: string;
  createdAt: string;
  count: number;
}> {
  return Array.isArray(value) && value.every((batch) =>
    batch &&
    typeof batch.id === 'string' &&
    batch.id.trim() &&
    typeof batch.createdAt === 'string' &&
    Number.isFinite(Date.parse(batch.createdAt)) &&
    Number.isInteger(batch.count) &&
    batch.count > 0,
  );
}

export type PersonalImportLedger = {
  version: 1;
  records: PersonalImportRecord[];
  batches: Array<{ id: string; createdAt: string; count: number }>;
  sync?: PersonalImportSyncState;
};

export function parsePersonalImportLedger(
  raw: string | null,
  schoolId: string,
  web: boolean,
): PersonalImportLedger {
  const ledger = parsePersonalImportLedgerBody(raw, schoolId, web);
  if (ledger.sync !== undefined) ledger.sync = parsePersonalImportSyncState(ledger.sync, schoolId);
  return ledger as PersonalImportLedger;
}

/** Validate the records and undo history independently of sync metadata. */
export function parsePersonalImportLedgerBody(
  raw: string | null,
  schoolId: string,
  web: boolean,
): Omit<PersonalImportLedger, 'sync'> & { sync?: unknown } {
  if (!raw) return { version: 1, records: [], batches: [] };
  let value: Omit<PersonalImportLedger, 'sync'> & { sync?: unknown };
  try {
    const { webCommit: _webCommit, ...ledger } = parsePersonalImportStorageJson(raw, web);
    // The Web calendar stores records and sync state without an Expo undo stack.
    if (web && 'sync' in ledger && !('batches' in ledger)) {
      ledger.batches = [];
    }
    value = ledger as typeof value;
  } catch {
    throw new Error('儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。');
  }
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.records) ||
    !isPersonalImportBatchHistory(value.batches) ||
    value.records.some(
      (row) =>
        !row ||
        row.schoolId !== schoolId ||
        typeof row.id !== 'string' ||
        typeof row.batchId !== 'string' ||
        !row.batchId.trim() ||
        typeof row.importedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.importedAt)) ||
        !row.source ||
        !['paste', 'file', 'screenshot'].includes(row.source.type) ||
        !Number.isInteger(row.source.line) ||
        row.source.line < 1 ||
        typeof row.source.rawText !== 'string' ||
        (row.source.name !== undefined && typeof row.source.name !== 'string') ||
        validatePersonalImportRow(row, {
          periodProfile: periodProfileForSchool(schoolId),
        }).some((issue) => issue.severity === 'error'),
    ) ||
    new Set(value.records.map((row) => row.id)).size !== value.records.length
  ) {
    throw new Error('儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。');
  }
  return value;
}
