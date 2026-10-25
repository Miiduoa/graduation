'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

// Capture a lifetime for each request. A keyed remount or effect replay invalidates
// earlier requests, including their redirects and follow-up requests.
export function useActiveRequest() {
  const active = useRef<object | null>(null);
  useLayoutEffect(() => {
    const lifetime = {};
    active.current = lifetime;
    return () => {
      active.current = null;
    };
  }, []);
  return useCallback(() => {
    const lifetime = active.current;
    return () => lifetime !== null && active.current === lifetime;
  }, []);
}
