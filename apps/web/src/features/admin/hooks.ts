'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { adminError, adminRequest } from './api';

export function useAdminResource<T>(
  path: string | null,
  context: string,
  parse: (value: unknown) => T,
  enabled = true,
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
    if (path === null || !enabled) return;
    const controller = new AbortController();
    let live = true;
    adminRequest(path, context, undefined, controller.signal)
      .then((value) => {
        const parsed = parse(value);
        if (live) setState({ path, context, revision, value: parsed });
      })
      .catch((error) => {
        if (live)
          setState((previous) => ({
            path,
            context,
            revision,
            value:
              previous?.path === path && previous.context === context ? previous.value : undefined,
            error: adminError(error),
          }));
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [path, context, parse, revision, enabled]);
  const current = state?.path === path && state.context === context ? state : null;
  return {
    value: current?.value,
    error: current?.revision === revision ? current.error : undefined,
    loading: enabled && path !== null && current?.revision !== revision,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  };
}

export function useAdminMutation(context: string | undefined, enabled = true) {
  const [busyOwner, setBusyOwner] = useState<object | null>(null);
  const [failure, setFailure] = useState<{ owner: object; message: string } | null>(null);
  const lock = useRef<object | null>(null);
  const scope = useRef<object | null>(null);
  const owner = useMemo(() => ({ context, keys: new Map<string, string>() }), [context]);
  const allowed = useRef(enabled);
  useLayoutEffect(() => {
    scope.current = owner;
    return () => {
      scope.current = null;
    };
  }, [owner]);
  useLayoutEffect(() => {
    allowed.current = enabled;
  }, [enabled]);
  async function run(
    path: string,
    input: Record<string, unknown>,
    idempotent = true,
  ): Promise<unknown | undefined> {
    if (scope.current !== owner || !allowed.current || lock.current === owner) return undefined;
    lock.current = owner;
    setBusyOwner(owner);
    setFailure(null);
    const signature = JSON.stringify([path, input]);
    let idempotencyKey = owner.keys.get(signature);
    if (idempotent && !idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      owner.keys.set(signature, idempotencyKey);
    }
    try {
      const value = await adminRequest(
        path,
        context,
        idempotent ? { ...input, idempotencyKey } : input,
      );
      if (scope.current !== owner) return undefined;
      owner.keys.delete(signature);
      return value;
    } catch (failure) {
      if (scope.current === owner) setFailure({ owner, message: adminError(failure) });
      return undefined;
    } finally {
      if (lock.current === owner) lock.current = null;
      if (scope.current === owner) setBusyOwner(null);
    }
  }
  return { run, busy: busyOwner === owner, error: failure?.owner === owner ? failure.message : '' };
}
