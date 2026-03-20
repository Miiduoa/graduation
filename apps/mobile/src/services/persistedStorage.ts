import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirstStorageValue } from "./scopedStorage";

type Deserialize<T> = (raw: string) => T;
type Serialize<T> = (value: T) => string;

export async function loadPersistedValue<T>(params: {
  storageKey: string;
  legacyKeys?: string[];
  fallback: T;
  deserialize?: Deserialize<T>;
}): Promise<T> {
  const {
    storageKey,
    legacyKeys = [],
    fallback,
    deserialize = JSON.parse as Deserialize<T>,
  } = params;

  try {
    const raw = await getFirstStorageValue([storageKey, ...legacyKeys]);
    if (raw == null) {
      return fallback;
    }

    return deserialize(raw);
  } catch {
    return fallback;
  }
}

export async function savePersistedValue<T>(
  storageKey: string,
  value: T,
  serialize: Serialize<T> = JSON.stringify
): Promise<void> {
  await AsyncStorage.setItem(storageKey, serialize(value));
}

export async function removePersistedValue(storageKey: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}
