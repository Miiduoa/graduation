'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sessionLost, socialError, socialRequest } from './api';

export function useSocialResource<T>(
  path: string,
  context: string,
  parse: (value: unknown) => T,
  enabled: boolean,
  onExpired: () => void,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    path: string;
    context: string;
    revision: number;
    value?: T;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let live = true;
    socialRequest(path, context, undefined, controller.signal)
      .then((value) => {
        const parsed = parse(value);
        if (live) setState({ path, context, revision, value: parsed });
      })
      .catch((error) => {
        if (!live) return;
        if (sessionLost(error)) onExpired();
        setState({ path, context, revision, error: socialError(error) });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [path, context, parse, revision, enabled, onExpired]);
  const current =
    enabled && state?.path === path && state.context === context && state.revision === revision
      ? state
      : null;
  return {
    value: current?.value,
    error: current?.error,
    loading: enabled && current === null,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  };
}

export function useSocialMutation(context: string, enabled: boolean, onExpired: () => void) {
  const owner = useMemo(() => ({ context, keys: new Map<string, string>() }), [context]);
  const current = useRef<object | null>(null),
    lock = useRef<object | null>(null),
    allowed = useRef(enabled);
  const [busyOwner, setBusyOwner] = useState<object | null>(null);
  const [failure, setFailure] = useState<{ owner: object; message: string } | null>(null);
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      current.current = null;
    };
  }, [owner]);
  useLayoutEffect(() => {
    allowed.current = enabled;
  }, [enabled]);
  async function run<T>(
    path: string,
    input: Record<string, unknown>,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    if (current.current !== owner || !allowed.current || lock.current === owner) return undefined;
    lock.current = owner;
    setBusyOwner(owner);
    setFailure(null);
    const signature = JSON.stringify([path, input]);
    let key = owner.keys.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      owner.keys.set(signature, key);
    }
    try {
      const result = parse(await socialRequest(path, context, { ...input, idempotencyKey: key }));
      if (current.current !== owner || !allowed.current) return undefined;
      owner.keys.delete(signature);
      return result;
    } catch (error) {
      if (current.current === owner && allowed.current) {
        if (sessionLost(error)) onExpired();
        setFailure({ owner, message: socialError(error) });
      }
      return undefined;
    } finally {
      if (lock.current === owner) lock.current = null;
      if (current.current === owner) setBusyOwner(null);
    }
  }
  return { run, busy: busyOwner === owner, error: failure?.owner === owner ? failure.message : '' };
}
