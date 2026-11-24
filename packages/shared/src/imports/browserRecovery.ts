import { sha256 } from 'js-sha256';

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
  const copies = [personalImportWebJournalKey(key), personalImportCheckpointKey(key)]
    .map((entry) => ({ entry, raw: storage.getItem(entry) }))
    .filter(({ raw }) => raw !== null);

  return {
    hasCopies: copies.length > 0,
    checkpoint: copies.find(({ entry }) => entry === personalImportCheckpointKey(key))?.raw ?? null,
    retire(published: string, canRetire = (_entry: string, _raw: string) => true) {
      for (const { entry, raw } of copies) {
        if (raw !== null && canRetire(entry, raw) &&
            storage.getItem(key) === published && storage.getItem(entry) === raw) {
          storage.removeItem(entry);
        }
      }
    },
  };
}
