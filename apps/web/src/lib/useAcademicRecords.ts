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
  /** 僅供閱讀的前次資料；不是本次更新成功，也不推進差異比對。 */
  stale?: boolean;
  reason?: 'reconnect' | 'unavailable' | 'permission' | 'unconfigured' | 'connecting';
  error?: unknown;
};

/** 自動更新需自行開啟，且只讀目前支援的校區。 */
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
    let pendingRead: AbortController | null = null;
    // 快照只屬於這一次帳號／校園／驗證生命週期，不從 React 舊狀態復原。
    let lastVerified: AcademicSnapshot<K> | undefined;
    let stale = false;
    const value = createAcademicRefreshController({
      environment: browserAcademicRefreshEnvironment(),
      onStatus(status) {
        if (current) setUpdateStatus({ scope, value: status });
      },
      async read() {
        if (!current) return 'unavailable';
        const request = new AbortController();
        pendingRead = request;
        setState(lastVerified
          ? { scope, status: 'ready', snapshot: lastVerified, refreshing: true, stale }
          : { scope, status: 'loading' });
        try {
          const snapshot = await loadAcademicRecords(kind, uid, expectedSchool, { signal: request.signal });
          if (!current || request.signal.aborted) return 'unavailable';
          if (snapshot.ownerUid !== uid || snapshot.schoolId !== expectedSchool) {
            // 來源不符不是暫時網路失敗，不得保留前次私有資料。
            throw new Error('Academic snapshot scope mismatch');
          }
          lastVerified = snapshot;
          stale = false;
          setState({ scope, status: 'ready', snapshot, refreshing: false });
          return 'ready';
        } catch (error) {
          if (!current || request.signal.aborted) return 'unavailable';
          const reason = error instanceof AcademicConnectionError ? error.reason : 'unavailable';
          const retain = error instanceof AcademicConnectionError && error.canRetainSnapshot;
          if (!retain) lastVerified = undefined;
          stale = !!lastVerified;
          // 不更新來源時間；只有明確的暫時連線失敗可保留可閱讀的舊快照。
          setState({ scope, status: 'error', reason, error, snapshot: lastVerified, stale });
          return reason;
        } finally {
          if (pendingRead === request) pendingRead = null;
        }
      },
    });
    controller.current = { scope, value };
    void value.refresh();
    return () => {
      current = false;
      pendingRead?.abort();
      pendingRead = null;
      lastVerified = undefined;
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
