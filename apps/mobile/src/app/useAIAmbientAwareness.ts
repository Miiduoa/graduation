import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useDataSource } from '../hooks/useDataSource';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { refreshAIAmbientAwareness } from '../services/aiAmbientAwareness';

const ACTIVE_REFRESH_INTERVAL_MS = 30_000;

export function useAIAmbientAwareness() {
  const auth = useAuth();
  const { school } = useSchool();
  const dataSource = useDataSource();
  const appStateRef = useRef(AppState.currentState);

  const refresh = useCallback(
    async (reason: string, force = false) => {
      await refreshAIAmbientAwareness({
        dataSource,
        userId: auth.user?.uid ?? null,
        schoolId: school?.id ?? null,
        reason,
        force,
      });
    },
    [auth.user?.uid, dataSource, school?.id],
  );

  useEffect(() => {
    const startup = setTimeout(() => {
      void refresh('startup', true);
    }, 1000);

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        void refresh('app-active', true);
      } else if (nextAppState === 'inactive' || nextAppState === 'background') {
        void refresh('app-background', true);
      }
      appStateRef.current = nextAppState;
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void refresh('foreground-timer');
      }
    }, ACTIVE_REFRESH_INTERVAL_MS);

    return () => {
      clearTimeout(startup);
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [refresh]);
}
