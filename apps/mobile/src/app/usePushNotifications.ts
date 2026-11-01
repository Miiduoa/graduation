import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  getLastNotificationResponseAsync,
  syncPushTokenForUser,
} from '../services/notifications';

import { rootNavigateNested, rootNavigationRef } from './rootNavigation';
import { applyNotificationDestination } from '../utils/applyNotificationDestination';
import { resolveNotificationDestination } from '../utils/notificationDestination';
import { isPersonalEventReminderPayload } from '../services/personalEventReminderModel';
import type { UserRole } from '../data/types';

type NavigationLike = {
  current: {
    navigate: (route: string, params?: unknown) => void;
  } | null;
};

type RemovableSubscription = {
  remove: () => void;
};

type NotificationResponseLike = {
  notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
  actionIdentifier?: string;
};

function getNotificationResponseKey(response: {
  notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
  actionIdentifier?: string;
}) {
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
  const responseListener = useRef<RemovableSubscription | null>(null);
  const lastHandledResponseKeyRef = useRef<string | null>(null);

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
    let cancelled = false;
    lastHandledResponseKeyRef.current = null;
    if (Platform.OS === 'web' || !uid) {
      return () => {
        cancelled = true;
      };
    }

    const handleResponse = async (
      response: NotificationResponseLike,
      options?: { clearLastResponse?: boolean },
    ) => {
      if (cancelled) return;
      const rawPayload = response?.notification?.request?.content?.data;
      // Personal local reminders have an independent consumer; ignore BEFORE dedup/nav/clear.
      if (isPersonalEventReminderPayload(rawPayload)) return;

      const responseKey = getNotificationResponseKey(response);
      if (lastHandledResponseKeyRef.current === responseKey) {
        if (options?.clearLastResponse) {
          await clearLastNotificationResponseAsync().catch(() => void 0);
        }
        return;
      }

      if (!rootNavigationRef.isReady()) return;

      lastHandledResponseKeyRef.current = responseKey;
      // 使用當下 ref 的學校範圍，拒絕跨校成績等通知目的地。
      navigateFromNotificationData(rawPayload, roleRef.current, schoolRef.current, uid);

      if (options?.clearLastResponse) {
        await clearLastNotificationResponseAsync().catch((error) => {
          console.warn('[Notifications] Failed to clear last notification response:', error);
        });
      }
    };

    const tryHandleInitialResponse = async (attempt = 0) => {
      try {
        const response = await getLastNotificationResponseAsync();
        if (!response || cancelled) return;

        if (!rootNavigationRef.isReady()) {
          if (attempt < 10) {
            setTimeout(() => {
              void tryHandleInitialResponse(attempt + 1);
            }, 300);
          }
          return;
        }

        await handleResponse(response, { clearLastResponse: true });
      } catch (error) {
        if (!cancelled) {
          console.warn('[Notifications] Failed to restore initial notification response:', error);
        }
      }
    };

    void tryHandleInitialResponse();

    responseListener.current = addNotificationResponseReceivedListener((response) => {
      void handleResponse(response).catch((error) => {
        console.warn('[Notifications] Failed to handle notification response:', error);
      });
    });

    return () => {
      cancelled = true;
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
    };
  }, [uid, schoolId]);
}
