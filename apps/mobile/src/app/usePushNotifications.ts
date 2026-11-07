import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  getLastNotificationResponseAsync,
  syncPushTokenForUser,
} from '../services/notifications';

import { isSchoolNavigationReady, rootNavigateNested, subscribeSchoolNavigationReady } from './rootNavigation';
import { applyNotificationDestination } from '../utils/applyNotificationDestination';
import { resolveNotificationDestination } from '../utils/notificationDestination';
import { personalReminderCategory } from '../services/personalReminderPayload';
import { isDormLaundryReminderIdentifier } from '../services/dormLaundryReminder';
import type { UserRole } from '../data/types';

type NavigationLike = {
  current: {
    navigate: (route: string, params?: unknown) => void;
  } | null;
};

type NotificationResponseLike = {
  notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
  actionIdentifier?: string;
};

function getNotificationResponseKey(response: NotificationResponseLike) {
  const identifier = response.notification?.request?.identifier;
  const actionIdentifier = response.actionIdentifier ?? 'default';
  const data = response.notification?.request?.content?.data;
  return `${identifier ?? 'unknown'}:${actionIdentifier}:${JSON.stringify(data ?? {})}`;
}

/** 推播與通知中心共用解析；無法開啟時退回通知列表，不臆造目的地。 */
export function navigateFromNotificationData(
  rawData: unknown,
  profileRole?: UserRole | null,
  schoolId?: string | null,
  uid?: string,
) {
  const destination = resolveNotificationDestination(
    { data: rawData },
    { role: profileRole, schoolId, ...(typeof rawData === 'object' && rawData !== null &&
      'type' in rawData && rawData.type === 'local_assignment_due_v2' ? { uid } : {}) },
  );
  if (!destination.ok) {
    rootNavigateNested('我的', 'Notifications');
    return false;
  }
  return applyNotificationDestination(destination, { role: profileRole });
}

/**
 * navigationRef 保留與 App.tsx 的相容簽章；實際導頁一律走 rootNavigationRef。
 */
export function usePushNotifications(
  _navigationRef: NavigationLike,
  uid: string | undefined,
  profileRole?: UserRole | null,
  schoolId?: string | null,
) {
  const roleRef = useRef<UserRole | null | undefined>(profileRole);
  const schoolRef = useRef<string | null | undefined>(schoolId);
  roleRef.current = profileRole;
  schoolRef.current = schoolId;

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web' || !uid) return;

    (async () => {
      try {
        const token = await syncPushTokenForUser(uid);
        if (!cancelled && token) {
          console.log('[Notifications] Push token synced');
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[Notifications] Failed to register push notifications:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (Platform.OS === 'web' || !uid) return;
    let cancelled = false;
    let liveTapCount = 0;
    let pending: NotificationResponseLike | null = null;
    let lastHandledKey: string | null = null;

    const flush = () => {
      if (cancelled || !pending || !isSchoolNavigationReady()) return;
      const response = pending;
      pending = null;
      const key = getNotificationResponseKey(response);
      const generation = liveTapCount;
      if (key !== lastHandledKey) {
        try {
          // A local timer has no cross-account destination. Resume the current screen.
          if (!isDormLaundryReminderIdentifier(response.notification?.request?.identifier)) {
            navigateFromNotificationData(response.notification?.request?.content?.data, roleRef.current, schoolRef.current, uid);
          }
          lastHandledKey = key;
        } catch (error) {
          console.warn('[Notifications] Failed to handle notification response:', error);
          return;
        }
      }
      // The native last response is shared with the personal reminder handler.
      void getLastNotificationResponseAsync().then((stored) => {
        if (!cancelled && liveTapCount === generation && stored && getNotificationResponseKey(stored) === key) {
          return clearLastNotificationResponseAsync();
        }
      }).catch((error) => {
        if (!cancelled) console.warn('[Notifications] Failed to clear last notification response:', error);
      });
    };

    const queue = (response: NotificationResponseLike) => {
      // A live tap owned by the other handler still supersedes our previous destination.
      pending = personalReminderCategory(response.notification?.request?.content?.data) ? null : response;
      flush();
    };

    const sub = addNotificationResponseReceivedListener((response) => {
      if (cancelled) return;
      liveTapCount++;
      queue(response);
    });
    const unsubscribe = subscribeSchoolNavigationReady(flush);
    if (!liveTapCount) {
      void getLastNotificationResponseAsync().then((response) => {
        if (!cancelled && !liveTapCount && response) queue(response);
      }).catch((error) => {
        if (!cancelled) console.warn('[Notifications] Failed to restore initial notification response:', error);
      });
    }

    return () => {
      cancelled = true;
      unsubscribe();
      sub.remove();
    };
  }, [uid, schoolId]);
}
