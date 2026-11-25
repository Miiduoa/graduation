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

export function hasWebPersonalImportCommit(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    if (value?.['$commit'] === 1 && !('version' in value)) return true;
    return value?.version === 1 && (
      typeof value.webCommit === 'string' ||
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

export function capturePersonalImportBrowserRecovery(storage: Storage, key: string) {
  const entries = {
    journal: personalImportWebJournalKey(key),
    checkpoint: personalImportCheckpointKey(key),
  };
  const copies = {
    journal: storage.getItem(entries.journal),
    checkpoint: storage.getItem(entries.checkpoint),
  };

  return {
    ...copies,
    hasCopies: copies.journal !== null || copies.checkpoint !== null,
    assertSnapshot(primary: string | null, checkCheckpoint: boolean, checkJournal = false) {
      if (storage.getItem(key) !== primary ||
          (checkCheckpoint && storage.getItem(entries.checkpoint) !== copies.checkpoint) ||
          (checkJournal && storage.getItem(entries.journal) !== copies.journal)) {
        throw new Error('匯入資料已在另一個分頁更新，請重新載入。');
      }
    },
    retire(published: string, source: keyof typeof copies) {
      const entry = entries[source];
      const raw = copies[source];
      if (raw !== null && storage.getItem(key) === published && storage.getItem(entry) === raw) {
        storage.removeItem(entry);
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
): string | undefined {
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
    return typeof journal === 'string' ? journal : encoded;
  }
  const current = fingerprint(primary);
  if (current !== journal.before && current !== journal.attempted) return undefined;
  const original = typeof journal.original === 'string' ? journal.original : 'null';
  if (fingerprint(original) !== journal.before) return undefined;
  return original;
}

export function parsePersonalImportStorageJson(raw: string, web: boolean) {
  const value = JSON.parse(raw);
  if (web && value?.[compactVersionKey] === 1 && !('version' in value)) {
    const { [compactVersionKey]: version, ...ledger } = value;
    return { version, ...ledger };
  }
  if (web && raw.endsWith(personalImportBrowserCommitSuffix)) {
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
  if (primaryVerified && hasWebPersonalImportCommit(primary)) return null;

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

  const journal = readWebPersonalImportRollback(copies.journal, primary, primaryVerified);
  if (!journal) return null;
  try {
    const raw = journal === 'null' ? null : journal;
    return { raw, ledger: parse(raw), source: 'journal' };
  } catch {
    return null;
  }
}

function isPersonalImportBatchHistory(value: unknown): value is Array<{
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
  if (!raw) return { version: 1, records: [], batches: [] };
  let value: PersonalImportLedger;
  try {
    const { webCommit: _webCommit, ...ledger } = parsePersonalImportStorageJson(raw, web);
    // The Web calendar stores records and sync state without an Expo undo stack.
    if (web && 'sync' in ledger && !('batches' in ledger)) {
      ledger.batches = [];
    }
    value = ledger as PersonalImportLedger;
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
  if (value.sync !== undefined)
    value.sync = parsePersonalImportSyncState(value.sync, schoolId);
  return value;
}
