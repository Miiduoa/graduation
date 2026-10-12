'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { retryPersonalTimetableSync } from '@/lib/timetable/persistence';
import {
  getServerTimetableSyncStatus,
  getTimetableSyncStatus,
  subscribeTimetableSyncStatus,
  timetableSyncCopy,
} from '@/lib/timetable/syncStatus';
import styles from './timetableSyncStatus.module.css';

export function TimetableSyncStatus() {
  const { user, loading } = useAuth();
  const school = useSelectedSchool();
  const uid = user?.uid || null;
  const schoolId = school.selectedSchoolId || 'pu';
  const readStatus = useCallback(() => getTimetableSyncStatus(uid, schoolId), [uid, schoolId]);
  const status = useSyncExternalStore(subscribeTimetableSyncStatus, readStatus, getServerTimetableSyncStatus);
  const retrying = useRef(false);

  if (loading || school.loading || status.kind === 'idle') return null;
  const copy = timetableSyncCopy(status);
  const retry = async () => {
    if (!uid || retrying.current) return;
    retrying.current = true;
    try {
      await retryPersonalTimetableSync(uid, schoolId);
    } catch {
      // 持久層會保留本機版本並更新狀態，不另外宣告成功。
    } finally {
      retrying.current = false;
    }
  };

  return (
    <section className={styles.bar} aria-label="課表儲存狀態" data-state={status.kind}>
      <div className={styles.copy} role="status" aria-live="polite" aria-atomic="true">
        <strong>{copy.label}</strong>
        <p>{copy.description}</p>
        {status.savedAt && (
          <time dateTime={status.savedAt}>
            最近儲存 {new Date(status.savedAt).toLocaleString('zh-TW', {
              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </time>
        )}
      </div>
      {uid && (status.kind === 'pending' || status.kind === 'syncing') && (
        <button type="button" className={`btn ${styles.retry}`} disabled={status.kind === 'syncing'} aria-busy={status.kind === 'syncing'} onClick={() => void retry()}>
          {status.kind === 'syncing' ? '同步中…' : '重新同步'}
        </button>
      )}
    </section>
  );
}
