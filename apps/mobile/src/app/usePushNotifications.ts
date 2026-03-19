import { useEffect, useRef } from "react";
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  getLastNotificationResponseAsync,
  syncPushTokenForUser,
} from "../services/notifications";

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
  const actionIdentifier = response.actionIdentifier ?? "default";
  const data = response.notification?.request?.content?.data;
  return `${identifier ?? "unknown"}:${actionIdentifier}:${JSON.stringify(data ?? {})}`;
}

function navigateFromNotificationData(
  nav: { navigate: (route: string, params?: unknown) => void },
  rawData: unknown
) {
  const data =
    rawData && typeof rawData === "object"
      ? (rawData as Record<string, unknown>)
      : {};

  switch (data.type) {
    case "announcement":
      if (data.announcementId) {
        nav.navigate("首頁", { screen: "公告詳情", params: { id: data.announcementId } });
      }
      break;
    case "event":
      if (data.eventId) {
        nav.navigate("首頁", { screen: "活動詳情", params: { id: data.eventId } });
      }
      break;
    case "group_post":
      if (data.groupId && data.postId) {
        nav.navigate("訊息", {
          screen: "GroupPost",
          params: { groupId: data.groupId, postId: data.postId },
        });
      }
      break;
    case "assignment":
      if (data.groupId && data.assignmentId) {
        nav.navigate("訊息", {
          screen: "AssignmentDetail",
          params: { groupId: data.groupId, assignmentId: data.assignmentId },
        });
      }
      break;
    case "message":
      if (data.peerId) {
        nav.navigate("訊息", { screen: "Chat", params: { kind: "dm", peerId: data.peerId } });
      }
      break;
    default:
      nav.navigate("我的", { screen: "Notifications" });
      break;
  }
}

export function usePushNotifications(navigationRef: NavigationLike, uid: string | undefined) {
  const responseListener = useRef<RemovableSubscription | null>(null);
  const lastHandledResponseKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uid) return;

    (async () => {
      try {
        const token = await syncPushTokenForUser(uid);
        if (!cancelled && token) {
          console.log("[Notifications] Push token synced");
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[Notifications] Failed to register push notifications:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    let cancelled = false;

    const handleResponse = async (
      response: NotificationResponseLike,
      options?: { clearLastResponse?: boolean }
    ) => {
      const responseKey = getNotificationResponseKey(response);
      if (lastHandledResponseKeyRef.current === responseKey) {
        if (options?.clearLastResponse) {
          await clearLastNotificationResponseAsync().catch(() => void 0);
        }
        return;
      }

      const nav = navigationRef.current;
      if (!nav) return;

      lastHandledResponseKeyRef.current = responseKey;
      navigateFromNotificationData(nav, response?.notification?.request?.content?.data);

      if (options?.clearLastResponse) {
        await clearLastNotificationResponseAsync().catch((error) => {
          console.warn("[Notifications] Failed to clear last notification response:", error);
        });
      }
    };

    const tryHandleInitialResponse = async (attempt = 0) => {
      try {
        const response = await getLastNotificationResponseAsync();
        if (!response || cancelled) return;

        if (!navigationRef.current) {
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
          console.warn("[Notifications] Failed to restore initial notification response:", error);
        }
      }
    };

    void tryHandleInitialResponse();

    responseListener.current = addNotificationResponseReceivedListener((response) => {
      void handleResponse(response).catch((error) => {
        console.warn("[Notifications] Failed to handle notification response:", error);
      });
    });

    return () => {
      cancelled = true;
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
    };
  }, [navigationRef]);
}
