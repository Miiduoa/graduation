import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { reconcileSubmittedAssignmentReminders } from '../services/submittedAssignmentReminders';

/** Recheck only opted-in work on launch, foreground, and while this screen is active. */
export function useSubmittedAssignmentReminders(uid?: string, schoolId?: string | null) {
  useEffect(() => {
    if (!uid || !schoolId || Platform.OS === 'web') return;
    let active = true;
    let running = false;
    const refresh = async () => {
      if (!active || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        await reconcileSubmittedAssignmentReminders({ uid, schoolId }, () => active);
      } catch {
        /* Offline: keep the last confirmed reminder until the next server check. */
      } finally {
        running = false;
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [uid, schoolId]);
}
