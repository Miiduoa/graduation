import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The native dormitory workspace stores only personal device notes.
 * This repository deliberately does not call school repair/booking endpoints.
 */
export async function readDormitoryWorkspaceStorage(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function writeDormitoryWorkspaceStorage(key: string, raw: string): Promise<void> {
  await AsyncStorage.setItem(key, raw);
}
