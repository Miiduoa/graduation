import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** Only unsent input and retry intents belong here, never server data or permissions. */
export type NuniDraftCache = Map<string, unknown>;
const Context = createContext<NuniDraftCache | null>(null);

export function NuniDraftProvider({
  cache,
  children,
}: {
  cache: NuniDraftCache;
  children: ReactNode;
}) {
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}

export function useNuniDraftState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(Context);
  const [value, setValue] = useState<T>(() =>
    cache?.has(key)
      ? (cache.get(key) as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  );
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const result =
        typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
      current.current = result;
      // Save synchronously: a foreground validation may unmount the form immediately.
      // A stale form closes over its old account's Map, never a replacement account's Map.
      cache?.set(key, result);
      setValue(result);
    },
    [cache, key],
  );
  return [value, update];
}
