import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { loadAiPersonalContext } from '../features/ai';
import { useDataSource } from '../hooks/useDataSource';
import { useAuth } from '../state/auth';
import { useSchedule } from '../state/schedule';
import { useSchool } from '../state/school';
import { syncProactiveAIReports } from '../services/proactiveAI';

const MIN_SYNC_INTERVAL_MS = 60_000;
const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60_000;

export function useProactiveAIReporter() {
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const { courses, loading } = useSchedule();
  const appStateRef = useRef(AppState.currentState);
  const lastSyncAtRef = useRef(0);
  const runningRef = useRef(false);

  const syncReports = useCallback(
    async (reason: string, force = false) => {
      const uid = auth.user?.uid;
      const schoolId = school?.id;
      if (!uid || !schoolId || runningRef.current) return;

      const nowMs = Date.now();
      if (!force && nowMs - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS) return;

      runningRef.current = true;
      lastSyncAtRef.current = nowMs;

      try {
        const [personalContext, announcements] = await Promise.all([
          loadAiPersonalContext({ uid, schoolId }).catch(() => ({
            pendingAssignments: [],
            weeklyReport: null,
          })),
          ds.listAnnouncements(schoolId).catch(() => []),
        ]);

        await syncProactiveAIReports(
          {
            userId: uid,
            schoolId,
            courses: courses ?? [],
            pendingAssignments: personalContext.pendingAssignments ?? [],
            announcements: announcements ?? [],
          },
          {
            notify: true,
            scheduleFutureNotifications: true,
          },
        );
      } catch (error) {
        console.warn(`[ProactiveAI] sync failed (${reason}):`, error);
      } finally {
        runningRef.current = false;
      }
    },
    [auth.user?.uid, school?.id, ds, courses],
  );

  useEffect(() => {
    if (!auth.user?.uid || loading) return;
    const timeout = setTimeout(() => {
      void syncReports('startup', true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [auth.user?.uid, loading, syncReports]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        void syncReports('foreground', true);
      }
      appStateRef.current = nextAppState;
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void syncReports('interval');
      }
    }, BACKGROUND_SYNC_INTERVAL_MS);

    return () => {
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [syncReports]);
}
