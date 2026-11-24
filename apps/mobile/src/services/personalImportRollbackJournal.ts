import { File, Paths } from 'expo-file-system';

function journalFiles(key: string) {
  // Escape URI syntax without introducing path separators or ambiguous scope delimiters.
  const name = key.replace(/[%:~]/g, (character) => `~${character.charCodeAt(0).toString(16)}`);
  return {
    payload: new File(Paths.document, `${name}.rollback.json`),
    marker: new File(Paths.document, `${name}.rollback.pending`),
  };
}

export function readPersonalImportRollback(key: string): string | undefined {
  const { payload, marker } = journalFiles(key);
  return marker.info().exists ? payload.textSync() : undefined;
}

export function preparePersonalImportRollback(key: string, raw: string | null): () => void {
  const { payload, marker } = journalFiles(key);
  // The document directory survives process restarts and is outside AsyncStorage's quota.
  // Publish the marker only after the payload is complete.
  try {
    payload.write(raw ?? 'null');
    marker.create();
  } catch (error) {
    discardPayload(payload);
    throw error;
  }
  return () => {
    // Commit synchronously so verification and commit cannot be separated by another JS event.
    marker.delete();
    discardPayload(payload);
  };
}

export function clearPersonalImportRollback(key: string): void {
  const { payload, marker } = journalFiles(key);
  if (marker.info().exists) marker.delete();
  discardPayload(payload);
}

function discardPayload(payload: File): void {
  try {
    if (payload.info().exists) payload.delete();
  } catch {
    // The unmarked payload is inert. The next guarded write replaces it.
  }
}
