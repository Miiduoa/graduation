'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  AcademicConnectionError,
  loadAcademicRecords,
  type AcademicKind,
  type AcademicSnapshot,
} from './academicClient';
import { isOfficialAcademicSchool } from './academicOfficialSchool';
import {
  browserAcademicRefreshEnvironment,
  createAcademicRefreshController,
  type AcademicAutomaticStatus,
  type AcademicRefreshController,
} from './academicRefreshController';

export type AcademicRecordState<K extends AcademicKind> = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  snapshot?: AcademicSnapshot<K>;
  refreshing?: boolean;
  reason?: 'reconnect' | 'unavailable' | 'permission' | 'unconfigured';
  error?: unknown;
};

/** Automatic refresh is opt-in and only reads the current supported campus. */
export function useAcademicRecords<K extends AcademicKind>(
  kind: K,
  enabled = true,
  expectedSchool: string = 'pu',
  automatic = false,
) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const scope = JSON.stringify([uid, kind, enabled, expectedSchool]);
  const supported = isOfficialAcademicSchool(expectedSchool);
  const controller = useRef<{ scope: string; value: AcademicRefreshController } | null>(null);
  const [state, setState] = useState<AcademicRecordState<K> | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{
    scope: string;
    value: AcademicAutomaticStatus;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !supported || !uid || authLoading) return;
    let current = true;
    const value = createAcademicRefreshController({
      environment: browserAcademicRefreshEnvironment(),
      onStatus(status) {
        if (current) setUpdateStatus({ scope, value: status });
      },
      async read() {
        if (!current) return 'unavailable';
        setState((previous) =>
          previous?.scope === scope && previous.status === 'ready' && previous.snapshot
            ? { ...previous, refreshing: true }
            : { scope, status: 'loading' },
        );
        try {
          const snapshot = await loadAcademicRecords(kind, uid, expectedSchool);
          if (snapshot.ownerUid !== uid || snapshot.schoolId !== expectedSchool) {
            throw new AcademicConnectionError('unavailable');
          }
          if (current) setState({ scope, status: 'ready', snapshot, refreshing: false });
          return 'ready';
        } catch (error) {
          const reason = error instanceof AcademicConnectionError ? error.reason : 'unavailable';
          // An unsuccessful refresh never advances the timestamp or presents old
          // records as a new successful response. Terminal errors stop polling.
          if (current) setState({ scope, status: 'error', reason, error });
          return reason;
        }
      },
    });
    controller.current = { scope, value };
    void value.refresh();
    return () => {
      current = false;
      value.dispose();
      if (controller.current?.value === value) controller.current = null;
    };
  }, [uid, authLoading, kind, scope, enabled, supported, expectedSchool]);

  useEffect(() => {
    if (controller.current?.scope === scope) controller.current.value.setAutomatic(automatic);
  }, [automatic, scope, authLoading]);

  const refresh = useCallback((): Promise<void> => {
    return controller.current?.scope === scope
      ? controller.current.value.refresh()
      : Promise.resolve();
  }, [scope]);

  const visible = enabled && supported && !authLoading && uid && state?.scope === scope ? state : null;
  const automaticStatus: AcademicAutomaticStatus = enabled && supported && !authLoading && uid &&
    updateStatus?.scope === scope ? updateStatus.value : 'off';
  return { state: visible, refresh, automaticStatus };
}
