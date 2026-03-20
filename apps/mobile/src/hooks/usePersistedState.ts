import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadPersistedValue,
  savePersistedValue,
} from "../services/persistedStorage";
import { useLatestValue } from "./useLatestValue";

type Deserialize<T> = (raw: string) => T;
type Serialize<T> = (value: T) => string;

type PersistedStateOptions<T> = {
  storageKey: string;
  legacyKeys?: string[];
  defaultValue: T;
  deserialize?: Deserialize<T>;
  serialize?: Serialize<T>;
};

export function usePersistedState<T>({
  storageKey,
  legacyKeys = [],
  defaultValue,
  deserialize = JSON.parse as Deserialize<T>,
  serialize = JSON.stringify,
}: PersistedStateOptions<T>) {
  const [value, setValue] = useState<T>(defaultValue);
  const [loaded, setLoaded] = useState(false);
  const defaultValueRef = useLatestValue(defaultValue);
  const deserializeRef = useLatestValue(deserialize);
  const serializeRef = useLatestValue(serialize);

  const legacyKeySignature = useMemo(() => legacyKeys.join("|"), [legacyKeys]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    loadPersistedValue({
      storageKey,
      legacyKeys,
      fallback: defaultValueRef.current,
      deserialize: deserializeRef.current,
    })
      .then((nextValue) => {
        if (!cancelled) {
          setValue(nextValue);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey, legacyKeySignature, defaultValueRef, deserializeRef, legacyKeys]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    savePersistedValue(storageKey, value, serializeRef.current).catch((error) => {
      console.error(`[PersistedState] Failed to save ${storageKey}:`, error);
    });
  }, [loaded, storageKey, value, serializeRef]);

  const reset = useCallback(() => {
    setValue(defaultValueRef.current);
  }, [defaultValueRef]);

  return {
    value,
    setValue,
    loaded,
    reset,
  };
}
