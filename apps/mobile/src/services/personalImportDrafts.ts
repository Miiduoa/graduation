import AsyncStorage from '@react-native-async-storage/async-storage';

// Serialize writes across screen remounts, so a returning screen reads the latest edit.
const pending = new Map<string, Promise<void>>();
export async function readImportReviewDraft(key: string) {
  await pending.get(key)?.catch(() => {});
  return AsyncStorage.getItem(key);
}
export function writeImportReviewDraft(key: string, value: string) {
  const next = (pending.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => AsyncStorage.setItem(key, value));
  pending.set(key, next);
  void next
    .finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    })
    .catch(() => {});
  return next;
}
