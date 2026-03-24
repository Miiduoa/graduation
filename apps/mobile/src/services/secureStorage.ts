const memoryFallbackStore = new Map<string, string>();

async function getSecureStore() {
  try {
    const module = await import('expo-secure-store');
    const available =
      typeof module.isAvailableAsync === 'function'
        ? await module.isAvailableAsync()
        : true;

    return available ? module : null;
  } catch {
    return null;
  }
}

export async function secureGetItem(key: string): Promise<string | null> {
  const secureStore = await getSecureStore();
  if (secureStore?.getItemAsync) {
    return secureStore.getItemAsync(key);
  }

  return memoryFallbackStore.get(key) ?? null;
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  const secureStore = await getSecureStore();
  if (secureStore?.setItemAsync) {
    await secureStore.setItemAsync(key, value, {
      keychainAccessible:
        secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ??
        secureStore.AFTER_FIRST_UNLOCK,
    });
    return;
  }

  memoryFallbackStore.set(key, value);
}

export async function secureDeleteItem(key: string): Promise<void> {
  const secureStore = await getSecureStore();
  if (secureStore?.deleteItemAsync) {
    await secureStore.deleteItemAsync(key);
    return;
  }

  memoryFallbackStore.delete(key);
}

export async function secureDeleteMany(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => secureDeleteItem(key)));
}
