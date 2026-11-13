import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDefaultCampusPreferences,
  normalizeCampusPreferences,
  type CampusPersonalizationPreferences,
} from '@campus/shared/src/campusPersonalization';
import type { PersonalImportScope } from './personalImports';

export function campusPreferencesStorageKey(scope: PersonalImportScope): string {
  return `campus.personalization.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
}

const listeners = new Set<(key: string) => void>();
const writes = new Map<string, Promise<unknown>>();

export function subscribeCampusPreferences(listener: (key: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadCampusPreferences(
  scope: PersonalImportScope,
): Promise<CampusPersonalizationPreferences> {
  const key = campusPreferencesStorageKey(scope);
  await writes.get(key)?.catch(() => undefined);
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return createDefaultCampusPreferences();
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('version' in value) ||
      value.version !== 1
    )
      throw new Error();
    return normalizeCampusPreferences(value);
  } catch {
    // Keep unreadable/newer data intact instead of overwriting it with defaults.
    throw new Error('目前無法讀取首頁偏好，原本的選擇仍保留。請稍後重試。');
  }
}

export async function saveCampusPreferences(
  scope: PersonalImportScope,
  preferences: CampusPersonalizationPreferences,
  isCurrent: () => boolean = () => true,
): Promise<CampusPersonalizationPreferences> {
  const key = campusPreferencesStorageKey(scope);
  const next = normalizeCampusPreferences(preferences);
  const previous = writes.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrent()) throw new Error('帳號或校園已切換，請重新設定。');
      await AsyncStorage.setItem(key, JSON.stringify(next));
      for (const listener of listeners) {
        try {
          listener(key);
        } catch {
          /* A view cannot invalidate a completed write. */
        }
      }
      return next;
    });
  writes.set(key, task);
  void task
    .finally(() => {
      if (writes.get(key) === task) writes.delete(key);
    })
    .catch(() => undefined);
  return task;
}

/** Explicit recovery only: replace this scope's preferences, never other app data. */
export function resetCampusPreferences(
  scope: PersonalImportScope,
  isCurrent: () => boolean,
): Promise<CampusPersonalizationPreferences> {
  return saveCampusPreferences(scope, createDefaultCampusPreferences(), isCurrent);
}
