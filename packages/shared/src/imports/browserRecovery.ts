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

export function capturePersonalImportBrowserRecovery(storage: Storage, key: string) {
  const copies = [personalImportWebJournalKey(key), personalImportCheckpointKey(key)]
    .map((entry) => ({ entry, raw: storage.getItem(entry) }))
    .filter(({ raw }) => raw !== null);

  return {
    hasCopies: copies.length > 0,
    retire(published: string) {
      for (const { entry, raw } of copies) {
        if (storage.getItem(key) === published && storage.getItem(entry) === raw) {
          storage.removeItem(entry);
        }
      }
    },
  };
}
