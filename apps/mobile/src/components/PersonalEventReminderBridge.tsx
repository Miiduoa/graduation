import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { usePersonalImportScope } from '../state/personalImportScope';
import {
  personalImportStorageKey,
  subscribePersonalImports,
} from '../services/personalImports';
import {
  invalidatePersonalEventRemindersForScopeChange,
  reconcilePersonalEventReminders,
} from '../services/personalEventReminders';
import {
  flushPendingPersonalEventReminderTap,
  handlePersonalEventReminderResponse,
  notifyPersonalEventReminderScopeResolved,
  setPersonalEventReminderScopeProvider,
  subscribePersonalEventReminderNavigationReady,
} from '../services/personalEventReminderNavigation';
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  getLastNotificationResponseAsync,
} from '../services/notifications';
import { isPersonalEventReminderPayload } from '../services/personalEventReminderModel';
import {
  fencePersonalEventReminderRuntimeFailure,
  publishPersonalEventReminderRuntimeFailure,
  userFacingReminderFailureMessage,
} from '../services/personalEventReminderRuntimeState';

/**
 * Independent of PersonalImportSyncBridge and usePushNotifications.
 * Runs for guest, Nuni-only, and school accounts; fences every async stage to current scope.
 *
 * Journal receipt publication must NOT feed reconcile — settings/ledger/startup/foreground own that.
 */
export function PersonalEventReminderBridge() {
  const scope = usePersonalImportScope();
  const latest = useRef(scope);
  latest.current = scope;
  const previousScope = useRef(scope);
  const key = scope ? personalImportStorageKey(scope) : '';

  useEffect(() => {
    setPersonalEventReminderScopeProvider(() => latest.current);
    return () => setPersonalEventReminderScopeProvider(() => null);
  }, []);

  useEffect(() => {
    const previous = previousScope.current;
    previousScope.current = scope;
    // Synchronously invalidate old error publication before async scope work.
    fencePersonalEventReminderRuntimeFailure(scope);
    void invalidatePersonalEventRemindersForScopeChange(previous, scope).catch((error) => {
      if (
        latest.current &&
        scope &&
        latest.current.owner === scope.owner &&
        latest.current.schoolId === scope.schoolId
      ) {
        publishPersonalEventReminderRuntimeFailure(
          scope,
          userFacingReminderFailureMessage(error),
        );
      }
    });
    if (scope) notifyPersonalEventReminderScopeResolved();
  }, [key, scope]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let alive = true;
    const active = () => {
      if (!alive) return false;
      // Unresolved auth: keep cleanup work alive while scope stays null.
      if (scope == null) return latest.current == null;
      return (
        latest.current != null &&
        latest.current.owner === scope.owner &&
        latest.current.schoolId === scope.schoolId
      );
    };

    const run = () => {
      const target = latest.current;
      void reconcilePersonalEventReminders(target, { active }).catch((error) => {
        if (!active()) return;
        if (target) {
          publishPersonalEventReminderRuntimeFailure(
            target,
            userFacingReminderFailureMessage(error),
          );
        }
      });
    };

    run();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });
    // Ledger durable writes only — not journal receipt publication (avoids reschedule feedback).
    const unsubLedger = subscribePersonalImports((change) => {
      if (
        latest.current &&
        personalImportStorageKey(change.scope) === personalImportStorageKey(latest.current)
      ) {
        run();
      }
    });

    return () => {
      alive = false;
      appState.remove();
      unsubLedger();
    };
  }, [key, scope]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    const clearIfSame = async (expected: {
      notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
      actionIdentifier?: string;
    }) => {
      const current = await getLastNotificationResponseAsync();
      if (!current) return;
      const currentData = current.notification?.request?.content?.data;
      const expectedData = expected.notification?.request?.content?.data;
      const currentId = current.notification?.request?.identifier;
      const expectedId = expected.notification?.request?.identifier;
      const currentAction = (current as { actionIdentifier?: string }).actionIdentifier ?? 'default';
      const expectedAction = expected.actionIdentifier ?? 'default';
      if (currentId !== expectedId || currentAction !== expectedAction) return;
      if (JSON.stringify(currentData) !== JSON.stringify(expectedData)) return;
      if (!isPersonalEventReminderPayload(currentData)) return;
      await clearLastNotificationResponseAsync();
    };

    const onResponse = (response: {
      notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
      actionIdentifier?: string;
    }) => {
      if (cancelled) return;
      const data = response.notification?.request?.content?.data;
      if (!isPersonalEventReminderPayload(data)) return;
      void handlePersonalEventReminderResponse(response, {
        clearLastResponse: (expected) => clearIfSame(expected),
      }).catch(() => undefined);
    };

    const tryInitial = async () => {
      try {
        const response = await getLastNotificationResponseAsync();
        if (!response || cancelled) return;
        const data = response.notification?.request?.content?.data;
        if (!isPersonalEventReminderPayload(data)) return;
        await handlePersonalEventReminderResponse(response, {
          clearLastResponse: (expected) => clearIfSame(expected),
        });
      } catch {
        /* Cold-start restore is best-effort; flush on readiness still runs. */
      }
    };

    void tryInitial();
    const sub = addNotificationResponseReceivedListener((response) => {
      onResponse(response);
    });
    const unsubReady = subscribePersonalEventReminderNavigationReady(() => {
      void flushPendingPersonalEventReminderTap({
        clearLastResponse: (expected) => clearIfSame(expected),
      }).catch(() => undefined);
      void tryInitial();
    });

    return () => {
      cancelled = true;
      sub.remove();
      unsubReady();
    };
  }, []);

  return null;
}
