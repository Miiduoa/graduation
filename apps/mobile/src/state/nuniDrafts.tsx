import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/**
 * Only editor input, its revision baseline and retry intents belong here,
 * never loaded resource lists or permissions.
 * Food mutation intents that still need confirmation are also mirrored into SecureStore
 * (see foodPersistence); this Map alone must not be treated as durable across cold start.
 */
export type NuniDraftCache = Map<string, unknown>;
const Context = createContext<NuniDraftCache | null>(null);

/** A revoked route callback may still hold this Map, but can never refill it. */
class RevocableDraftCache extends Map<string, unknown> {
  private retained = true;

  constructor(private readonly canRetain: () => boolean) {
    super();
  }

  available() {
    if (this.retained && !this.canRetain()) this.revoke();
    return this.retained;
  }

  revoke() {
    this.retained = false;
    super.clear();
  }

  override get(key: string) {
    return this.available() ? super.get(key) : undefined;
  }

  override has(key: string) {
    return this.available() && super.has(key);
  }

  override set(key: string, value: unknown) {
    if (this.available()) super.set(key, value);
    return this;
  }

  override get size() {
    return this.available() ? super.size : 0;
  }

  override entries() {
    this.available();
    return super.entries();
  }

  override keys() {
    this.available();
    return super.keys();
  }

  override values() {
    this.available();
    return super.values();
  }

  override [Symbol.iterator]() {
    return this.entries();
  }

  override forEach(callback: (value: unknown, key: string, map: Map<string, unknown>) => void, thisArg?: unknown) {
    if (this.available()) super.forEach(callback, thisArg);
  }
}

export type NuniDraftScope = {
  accountId: string;
  revision: number;
  cache: NuniDraftCache;
};

/** One verified login's in-memory input. Nothing is restored from device storage. */
export class NuniDraftScopeStore {
  private current: (NuniDraftScope & { cache: RevocableDraftCache }) | null = null;
  private revision = 0;

  constructor(private readonly canRetain: (accountId: string) => boolean = () => true) {}

  forAccount(accountId: string): NuniDraftScope {
    if (this.current?.accountId !== accountId || !this.current.cache.available()) {
      this.clear();
      this.current = {
        accountId,
        revision: ++this.revision,
        cache: new RevocableDraftCache(() => this.canRetain(accountId)),
      };
    }
    return this.current;
  }

  clear = () => {
    this.current?.cache.revoke();
    this.current = null;
  };
}

const ScopeContext = createContext<NuniDraftScopeStore | null>(null);

export function NuniDraftScopeProvider({
  store,
  children,
}: {
  store: NuniDraftScopeStore;
  children: ReactNode;
}) {
  return <ScopeContext.Provider value={store}>{children}</ScopeContext.Provider>;
}

/** Screens without an app session provider keep an isolated, route-local fallback. */
export function useNuniDraftScope() {
  return useContext(ScopeContext);
}

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
  const readInitial = (): T =>
    cache?.has(key)
      ? (cache.get(key) as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial;
  const [stored, setStored] = useState(() => ({ cache, key, value: readInitial() }));
  const sameOwner = stored.cache === cache && stored.key === key;
  const value = sameOwner ? stored.value : readInitial();
  // A key is an input scope, not just a persistence destination. Rebind before
  // rendering so an old activity/account value never flashes under a new key.
  if (!sameOwner) setStored({ cache, key, value });
  const current = useRef(value);
  current.current = value;
  const mounted = useRef(true);
  const owner = useRef({ cache, key });
  owner.current = { cache, key };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (
        !mounted.current || owner.current.cache !== cache || owner.current.key !== key ||
        (cache instanceof RevocableDraftCache && !cache.available())
      ) return;
      const result =
        typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
      current.current = result;
      // Save synchronously: a foreground validation may unmount the form immediately.
      // A stale form closes over its old account's Map, never a replacement account's Map.
      cache?.set(key, result);
      setStored({ cache, key, value: result });
    },
    [cache, key],
  );
  return [value, update];
}
