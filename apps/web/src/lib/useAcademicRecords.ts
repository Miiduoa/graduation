'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  AcademicConnectionError,
  loadAcademicRecords,
  type AcademicKind,
  type AcademicSnapshot,
} from './academicClient';

type RecordState<K extends AcademicKind> = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  snapshot?: AcademicSnapshot<K>;
  reason?: 'reconnect' | 'unavailable' | 'permission';
  error?: unknown;
};

/**
 * Official academic reads. Pass `enabled=false` for non-PU browse scopes.
 * `expectedSchool` is fenced into the async scope so stale PU payloads cannot
 * reappear after a school switch (timetable may omit it and keep the PU default).
 */
export function useAcademicRecords<K extends AcademicKind>(
  kind: K,
  enabled = true,
  expectedSchool: string = 'pu',
) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const scope = JSON.stringify([uid, kind, enabled, expectedSchool]);
  const generation = useRef(0);
  const [state, setState] = useState<RecordState<K> | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled || !uid || authLoading) return;
    setState({ scope, status: 'loading' });
    try {
      const snapshot = await loadAcademicRecords(kind, uid, expectedSchool);
      if (generation.current === request) {
        setState({ scope, status: 'ready', snapshot });
      }
    } catch (error) {
      if (generation.current === request) {
        setState({
          scope,
          status: 'error',
          reason: error instanceof AcademicConnectionError ? error.reason : 'unavailable',
          error,
        });
      }
    }
  }, [uid, authLoading, kind, scope, enabled, expectedSchool]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  const visible = enabled && !authLoading && uid && state?.scope === scope ? state : null;
  return { state: visible, refresh };
}
