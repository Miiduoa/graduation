import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  getLastNotificationResponseAsync,
  syncPushTokenForUser,
} from '../services/notifications';

import { rootNavigateNested, rootNavigationRef } from './rootNavigation';
import { aiOverlay } from './useAIOverlay';

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

function navigateFromNotificationData(rawData: unknown) {
  const data = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};

  switch (data.type) {
    case 'ai_proactive':
      aiOverlay.open({
        mode: 'chat',
        source: 'push_ai_proactive',
        proactiveReportId: typeof data.reportId === 'string' ? data.reportId : undefined,
      });
      break;
    case 'announcement':
      if (typeof data.announcementId === 'string' && data.announcementId) {
        rootNavigateNested('Today', '公告詳情', { id: data.announcementId });
      }
      break;
    case 'event':
      if (typeof data.eventId === 'string' && data.eventId) {
        rootNavigateNested('Today', '活動詳情', { id: data.eventId });
      }
      break;
    case 'group_post':
      if (typeof data.groupId === 'string' && typeof data.postId === 'string') {
        rootNavigateNested('訊息', 'GroupPost', {
          groupId: data.groupId,
          postId: data.postId,
        });
      }
      break;
    case 'assignment':
      if (typeof data.groupId === 'string' && typeof data.assignmentId === 'string') {
        rootNavigateNested('訊息', 'AssignmentDetail', {
          groupId: data.groupId,
          assignmentId: data.assignmentId,
        });
      }
      break;
    case 'friend_request':
    case 'friend_invite':
      rootNavigateNested('訊息', 'FriendsManage');
      break;
    case 'friend_accepted':
      rootNavigateNested('訊息', 'FriendsManage');
      break;
    case 'message':
      if (typeof data.peerId === 'string' && data.peerId) {
        rootNavigateNested('訊息', 'Chat', { kind: 'dm', peerId: data.peerId });
      }
      break;
    default:
      rootNavigateNested('我的', 'Notifications');
      break;
  }
}

/**
 * navigationRef 保留與 App.tsx 的相容簽章；實際導頁一律走 rootNavigationRef + aiOverlay。
 */
export function usePushNotifications(_navigationRef: NavigationLike, uid: string | undefined) {
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
    if (Platform.OS === 'web') return;

    const handleResponse = async (
      response: NotificationResponseLike,
      options?: { clearLastResponse?: boolean },
    ) => {
      const responseKey = getNotificationResponseKey(response);
      if (lastHandledResponseKeyRef.current === responseKey) {
        if (options?.clearLastResponse) {
          await clearLastNotificationResponseAsync().catch(() => void 0);
        }
        return;
      }

      const rawPayload = response?.notification?.request?.content?.data;
      const isAiProactive =
        rawPayload &&
        typeof rawPayload === 'object' &&
        (rawPayload as Record<string, unknown>).type === 'ai_proactive';

      if (!isAiProactive && !rootNavigationRef.isReady()) return;

      lastHandledResponseKeyRef.current = responseKey;
      navigateFromNotificationData(rawPayload);

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

        const rawPayload = response.notification?.request?.content?.data;
        const isAiProactive =
          rawPayload &&
          typeof rawPayload === 'object' &&
          (rawPayload as Record<string, unknown>).type === 'ai_proactive';

        if (!isAiProactive && !rootNavigationRef.isReady()) {
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
  }, []);
}
