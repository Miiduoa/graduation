import { File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { Platform } from 'react-native';

const markerSuffix = '.rollback.pending';

function journalFiles(key: string) {
  const directory = Paths.document;
  // An existing legacy marker remains authoritative until its write commits.
  // The escaped storage key is ASCII, so its length is also its byte count.
  const legacyName = key.replace(/[%:~]/g, (character) => `~${character.charCodeAt(0).toString(16)}`);
  if (legacyName.length + markerSuffix.length <= 255) {
    const marker = new File(directory, legacyName + markerSuffix);
    if (marker.info().exists) {
      return { marker, payload: new File(directory, `${legacyName}.rollback.json`), marked: true };
    }
  }

  const name = `personal-imports-${sha256(key)}`;
  const marker = new File(directory, name + markerSuffix);
  return { marker, payload: new File(directory, `${name}.rollback.json`), marked: marker.info().exists };
}

export function readPersonalImportRollback(key: string): string | undefined {
  // Expo's Web implementation cannot construct a Directory or File.
  if (Platform.OS === 'web') return undefined;
  const { payload, marked } = journalFiles(key);
  return marked ? payload.textSync() : undefined;
}

export function preparePersonalImportRollback(key: string, raw: string | null): () => void {
  if (Platform.OS === 'web') throw new Error('此平台無法建立匯入資料的還原副本。');
  const { payload, marker, marked } = journalFiles(key);
  // The document directory survives process restarts and is outside AsyncStorage's quota.
  const encoded = raw ?? 'null';
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
  if (Platform.OS === 'web') return;
  const { payload, marker, marked } = journalFiles(key);
  if (marked) marker.delete();
  discardPayload(payload);
}

function discardPayload(payload: File): void {
  try {
    if (payload.info().exists) payload.delete();
  } catch {
    // The unmarked payload is inert. The next guarded write replaces it.
  }
}
