/* eslint-disable */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadPersistedValue, savePersistedValue } from '../services/persistedStorage';
import { useLatestValue } from './useLatestValue';

type Deserialize<T> = (raw: string) => T;
type Serialize<T> = (value: T) => string;

type PersistedStateOptions<T> = {
  storageKey: string;
  legacyKeys?: string[];
  defaultValue: T;
  deserialize?: Deserialize<T>;
  serialize?: Serialize<T>;
};

type ScopedState<T> = {
  scope: { storageKey: string; legacyKeySignature: string };
  value: T;
  loaded: boolean;
};

export function usePersistedState<T>({
  storageKey,
  legacyKeys = [],
  defaultValue,
  deserialize = JSON.parse as Deserialize<T>,
  serialize = JSON.stringify,
}: PersistedStateOptions<T>) {
  const defaultValueRef = useLatestValue(defaultValue);
  const deserializeRef = useLatestValue(deserialize);
  const serializeRef = useLatestValue(serialize);
  const legacyKeysRef = useLatestValue(legacyKeys);

  const legacyKeySignature = JSON.stringify(legacyKeys);
  // A fresh visit to A after A -> B -> A must reject callbacks from the first visit.
  const scope = useMemo(() => ({ storageKey, legacyKeySignature }), [storageKey, legacyKeySignature]);

  const [state, setState] = useState<ScopedState<T>>(() => ({
    scope,
    value: defaultValue,
    loaded: false,
  }));

  if (state.scope !== scope) {
    setState({ scope, value: defaultValue, loaded: false });
  }

  const active =
    state.scope === scope ? state : { scope, value: defaultValue, loaded: false };

  useEffect(() => {
    let cancelled = false;

    loadPersistedValue({
      storageKey,
      legacyKeys: legacyKeysRef.current,
      fallback: defaultValueRef.current,
      deserialize: deserializeRef.current,
    })
      .then((nextValue) => {
        if (cancelled) {
          return;
        }
        setState((prev) => {
          if (prev.scope !== scope) {
            return prev;
          }
          const value = Object.is(prev.value, nextValue) ? prev.value : nextValue;
          if (prev.loaded && Object.is(prev.value, value)) {
            return prev;
          }
          return { scope, value, loaded: true };
        });
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setState((prev) => {
          if (prev.scope !== scope || prev.loaded) {
            return prev;
          }
          return { ...prev, loaded: true };
        });
      });

    return () => {
      cancelled = true;
    };
  }, [scope, storageKey]);

  useEffect(() => {
    if (!active.loaded || active.scope !== scope) {
      return;
    }

    savePersistedValue(storageKey, active.value, serializeRef.current).catch((error) => {
      console.error(`[PersistedState] Failed to save ${storageKey}:`, error);
    });
  }, [active.loaded, active.scope, active.value, scope, storageKey, serializeRef]);

  const setValue = useCallback(
    (update: T | ((prev: T) => T)) => {
      setState((prev) => {
        if (prev.scope !== scope) {
          return prev;
        }
        const nextValue =
          typeof update === 'function' ? (update as (prev: T) => T)(prev.value) : update;
        return Object.is(nextValue, prev.value) ? prev : { ...prev, value: nextValue };
      });
    },
    [scope],
  );

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.scope !== scope) {
        return prev;
      }
      const nextValue = defaultValueRef.current;
      return Object.is(nextValue, prev.value) ? prev : { ...prev, value: nextValue };
    });
  }, [scope, defaultValueRef]);

  return {
    value: active.value,
    setValue,
    loaded: active.loaded,
    reset,
  };
}
