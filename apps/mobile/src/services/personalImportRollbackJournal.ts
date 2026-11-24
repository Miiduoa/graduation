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
  const encoded = raw ?? 'null';
  const marked = marker.info().exists;
  // A retry can reuse the verified copy without rewriting it.
  if (!marked || payload.textSync() !== encoded) {
    payload.write(encoded);
    if (payload.textSync() !== encoded) {
      throw new Error('無法確認匯入資料的還原副本已寫入。');
    }
  }
  if (!marked) {
    marker.create();
    // On iOS, create() can return normally even if FileManager did not create the file.
    if (!marker.info().exists) throw new Error('無法建立匯入資料的還原標記。');
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
