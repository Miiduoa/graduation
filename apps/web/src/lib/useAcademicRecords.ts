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
};

export function useAcademicRecords<K extends AcademicKind>(kind: K) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const scope = JSON.stringify([uid, kind]);
  const generation = useRef(0);
  const [state, setState] = useState<RecordState<K> | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!uid || authLoading) return;
    setState({ scope, status: 'loading' });
    try {
      const snapshot = await loadAcademicRecords(kind, uid);
      if (generation.current === request) {
        setState({ scope, status: 'ready', snapshot });
      }
    } catch (error) {
      if (generation.current === request) {
        setState({
          scope,
          status: 'error',
          reason: error instanceof AcademicConnectionError ? error.reason : 'unavailable',
        });
      }
    }
  }, [uid, authLoading, kind, scope]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  const visible = !authLoading && uid && state?.scope === scope ? state : null;
  return { state: visible, refresh };
}
