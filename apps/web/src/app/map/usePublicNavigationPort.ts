'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import type { PublicTaskPort } from './PublicNavigationTask';

type Availability = 'loading' | 'enabled' | 'disabled';
type CapabilityStatus = 'idle' | 'loading' | 'available' | 'unavailable' | 'error';
const ACTIONS = new Set([
  'preview',
  'prepareGroq',
  'confirm',
  'execute',
  'route',
  'read',
  'status',
  'reconcile',
  'ack',
]);

/** BFF is disabled by default; the browser never receives a platform session handle. */
export function usePublicNavigationPort(schoolId: string | null, schoolName: string) {
  const auth = useOptionalNuniSession();
  const [availability, setAvailability] = useState<Availability>('loading');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/nuni/public-agent/availability', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        if (!controller.signal.aborted)
          setAvailability(data?.enabled === true ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability('disabled');
      });
    return () => controller.abort();
  }, []);
  const context =
    !auth?.loading && !auth?.error && !auth?.pendingLogout ? auth?.session?.context : null;
  const account =
    !auth?.loading && !auth?.error && !auth?.pendingLogout
      ? auth?.session?.platformAccountId
      : null;
  const scopeKey =
    availability === 'enabled' && account && context && schoolId
      ? JSON.stringify([account, context, schoolId])
      : null;
  // A new token is created on every scope change, including A→B→A.
  const scopeToken = useMemo(() => (scopeKey ? { key: scopeKey } : null), [scopeKey]);
  const [capability, setCapability] = useState<{
    token: { key: string };
    status: Exclude<CapabilityStatus, 'idle'>;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!scopeToken || !context || !schoolId) return;
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(() => {
      if (!current) return;
      controller.abort();
      setCapability({ token: scopeToken, status: 'error' });
    }, 12_000);
    void fetch('/api/nuni/public-agent/capability', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Campus-Session': context },
      body: JSON.stringify({ schoolId }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('CAPABILITY_UNAVAILABLE');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('CAPABILITY_INVALID');
        const row = data as Record<string, unknown>;
        if (
          row.schoolId !== schoolId ||
          !Array.isArray(row.modes) ||
          row.modes.some((mode) => mode !== 'groq' && mode !== 'deterministic') ||
          new Set(row.modes).size !== row.modes.length ||
          (row.modes.length > 0 && (!row.source || typeof row.source !== 'object'))
        )
          throw new Error('CAPABILITY_INVALID');
        if (current && !controller.signal.aborted)
          setCapability({
            token: scopeToken,
            status: row.modes.includes('groq') ? 'available' : 'unavailable',
          });
      })
      .catch(() => {
        if (current && !controller.signal.aborted)
          setCapability({ token: scopeToken, status: 'error' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [scopeToken, context, schoolId, retry]);
  const capabilityStatus: CapabilityStatus = !scopeToken
    ? 'idle'
    : capability?.token === scopeToken
      ? capability.status
      : 'loading';
  const retryCapability = useCallback(() => {
    if (!scopeToken) return;
    setCapability({ token: scopeToken, status: 'loading' });
    setRetry((value) => value + 1);
  }, [scopeToken]);
  const port = useMemo<PublicTaskPort | undefined>(() => {
    if (capabilityStatus !== 'available' || !context || !account || !schoolId) return undefined;
    return {
      scope: `${account}:${context}`,
      mode: 'groq',
      schoolId,
      schoolName,
      async call(action, body, signal) {
        if (!ACTIONS.has(action)) throw new Error('PUBLIC_AGENT_INVALID_INPUT');
        let response: Response;
        try {
          response = await fetch(`/api/nuni/public-agent/${action}`, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            redirect: 'error',
            signal,
            headers: { 'Content-Type': 'application/json', 'X-Campus-Session': context },
            body: JSON.stringify(body),
          });
        } catch {
          throw new Error('PUBLIC_AGENT_OUTCOME_UNKNOWN');
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error('PUBLIC_AGENT_OUTCOME_UNKNOWN');
        }
        if (!response.ok) {
          const code =
            data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
              ? data.error
              : 'PUBLIC_AGENT_OUTCOME_UNKNOWN';
          throw new Error(code);
        }
        return data;
      },
    };
  }, [capabilityStatus, context, account, schoolId, schoolName]);
  return {
    port,
    available: availability === 'enabled',
    capabilityStatus,
    retryCapability,
    needsSignIn:
      availability === 'enabled' &&
      !!auth &&
      !auth.loading &&
      !auth.error &&
      !auth.pendingLogout &&
      !auth.session,
  };
}
