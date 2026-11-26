import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearanceMode = 'light' | 'dark' | 'system';
export const PREFERENCES_STORAGE_KEY = '@user_preferences';
const THEME_STORAGE_KEY = 'campus.themeMode.v2';

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export async function readAppearanceMode(): Promise<AppearanceMode> {
  await pendingWrite;
  const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
  if (isAppearanceMode(saved)) return saved;

  const raw = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
  if (raw) {
    const mode: unknown = JSON.parse(raw)?.appearanceMode;
    if (isAppearanceMode(mode)) return mode;
  }
  return 'system';
}

// A rapid switch back to system must be the last value on disk, even across a remount.
let pendingWrite = Promise.resolve();
export function writeAppearanceMode(mode: AppearanceMode): Promise<void> {
  const write = pendingWrite.then(() => AsyncStorage.setItem(THEME_STORAGE_KEY, mode));
  pendingWrite = write.catch(() => undefined);
  return write;
}
