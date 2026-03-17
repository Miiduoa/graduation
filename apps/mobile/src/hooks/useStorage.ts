import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type StorageOptions<T> = {
  defaultValue: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

/**
 * AsyncStorage hook - 持久化狀態管理
 */
export function useAsyncStorage<T>(
  key: string,
  options: StorageOptions<T> | T
): [T, (value: T | ((prev: T) => T)) => Promise<void>, boolean, () => Promise<void>] {
  const normalizedOptions =
    options != null && typeof options === "object" && "defaultValue" in options
      ? options
      : { defaultValue: options as T };

  const { 
    defaultValue, 
    serialize = JSON.stringify, 
    deserialize = JSON.parse 
  } = normalizedOptions;

  const [value, setValue] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(key)
      .then((stored) => {
        if (mounted && stored !== null) {
          try {
            setValue(deserialize(stored));
          } catch {
            setValue(defaultValue);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [key, defaultValue, deserialize]);

  // 使用 ref 來追蹤最新的 value，避免閉包陳舊問題
  const valueRef = useRef(value);
  valueRef.current = value;
  
  const setStoredValue = useCallback(
    async (newValue: T | ((prev: T) => T)) => {
      // 使用 ref 取得最新值，確保連續快速調用時使用正確的 prev
      const valueToStore = newValue instanceof Function ? newValue(valueRef.current) : newValue;
      setValue(valueToStore);
      valueRef.current = valueToStore;

      try {
        await AsyncStorage.setItem(keyRef.current, serialize(valueToStore));
      } catch (e) {
        console.error(`[useAsyncStorage] Failed to save ${keyRef.current}:`, e);
      }
    },
    [serialize]
  );

  const removeValue = useCallback(async () => {
    setValue(defaultValue);
    try {
      await AsyncStorage.removeItem(keyRef.current);
    } catch (e) {
      console.error(`[useAsyncStorage] Failed to remove ${keyRef.current}:`, e);
    }
  }, [defaultValue]);

  return [value, setStoredValue, loading, removeValue];
}

/**
 * 多項目 Storage hook
 */
export function useMultiStorage<T extends Record<string, unknown>>(
  keys: (keyof T)[],
  defaults: T
): {
  values: T;
  loading: boolean;
  setValue: <K extends keyof T>(key: K, value: T[K]) => Promise<void>;
  setValues: (values: Partial<T>) => Promise<void>;
  removeValue: (key: keyof T) => Promise<void>;
  clear: () => Promise<void>;
} {
  const [values, setValuesState] = useState<T>(defaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.multiGet(keys as string[])
      .then((results) => {
        const parsed: Partial<T> = {};
        for (const [key, stored] of results) {
          if (stored !== null) {
            try {
              parsed[key as keyof T] = JSON.parse(stored);
            } catch {
              // keep default
            }
          }
        }
        setValuesState((prev) => ({ ...prev, ...parsed }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setValue = useCallback(async <K extends keyof T>(key: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [key]: value }));
    try {
      await AsyncStorage.setItem(key as string, JSON.stringify(value));
    } catch (e) {
      console.error(`[useMultiStorage] Failed to save ${String(key)}:`, e);
    }
  }, []);

  const setValues = useCallback(async (newValues: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...newValues }));
    try {
      const pairs = Object.entries(newValues).map(
        ([key, value]) => [key, JSON.stringify(value)] as [string, string]
      );
      await AsyncStorage.multiSet(pairs);
    } catch (e) {
      console.error("[useMultiStorage] Failed to save multiple values:", e);
    }
  }, []);

  const removeValue = useCallback(async (key: keyof T) => {
    setValuesState((prev) => ({ ...prev, [key]: defaults[key] }));
    try {
      await AsyncStorage.removeItem(key as string);
    } catch (e) {
      console.error(`[useMultiStorage] Failed to remove ${String(key)}:`, e);
    }
  }, [defaults]);

  const clear = useCallback(async () => {
    setValuesState(defaults);
    try {
      await AsyncStorage.multiRemove(keys as string[]);
    } catch (e) {
      console.error("[useMultiStorage] Failed to clear values:", e);
    }
  }, [defaults, keys]);

  return { values, loading, setValue, setValues, removeValue, clear };
}

/**
 * 簡單的布林值 Storage hook
 */
export function useBooleanStorage(
  key: string,
  defaultValue = false
): [boolean, () => Promise<void>, () => Promise<void>, boolean] {
  const [value, setValue, loading] = useAsyncStorage<boolean>(key, { defaultValue });

  const toggle = useCallback(async () => {
    await setValue((prev) => !prev);
  }, [setValue]);

  const setTrue = useCallback(async () => {
    await setValue(true);
  }, [setValue]);

  return [value, toggle, setTrue, loading];
}

/**
 * 歷史記錄 Storage hook
 */
export function useHistoryStorage<T>(
  key: string,
  maxItems = 50
): {
  history: T[];
  loading: boolean;
  add: (item: T) => Promise<void>;
  remove: (index: number) => Promise<void>;
  clear: () => Promise<void>;
} {
  const [history, setHistory, loading, clearStorage] = useAsyncStorage<T[]>(key, {
    defaultValue: [],
  });

  const add = useCallback(
    async (item: T) => {
      await setHistory((prev) => {
        const filtered = prev.filter(
          (existing) => JSON.stringify(existing) !== JSON.stringify(item)
        );
        return [item, ...filtered].slice(0, maxItems);
      });
    },
    [maxItems, setHistory]
  );

  const remove = useCallback(
    async (index: number) => {
      await setHistory((prev) => prev.filter((_, i) => i !== index));
    },
    [setHistory]
  );

  return { history, loading, add, remove, clear: clearStorage };
}
