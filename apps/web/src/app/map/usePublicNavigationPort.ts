'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import type { PublicTaskPort } from './PublicNavigationTask';

type Availability = 'loading' | 'enabled' | 'disabled';
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
  const port = useMemo<PublicTaskPort | undefined>(() => {
    if (availability !== 'enabled' || !context || !account || !schoolId) return undefined;
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
  }, [availability, context, account, schoolId, schoolName]);
  return {
    port,
    available: availability === 'enabled',
    needsSignIn:
      availability === 'enabled' &&
      !!auth &&
      !auth.loading &&
      !auth.error &&
      !auth.pendingLogout &&
      !auth.session,
  };
}
