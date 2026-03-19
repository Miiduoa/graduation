import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform, Linking, Alert } from "react-native";
import { doc, setDoc, deleteDoc, serverTimestamp, getDoc } from "firebase/firestore";
import {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from "@campus/shared/src/notifications";
import { getDb } from "../firebase";
import { withRetry, isRetryableError } from "../utils/retry";
import { trackEvent } from "./analytics";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushTokenInfo = {
  token: string;
  type: "expo" | "fcm" | "apns";
  platform: "ios" | "android" | "web";
  deviceName?: string;
  createdAt: any;
};

export type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
  status: Notifications.PermissionStatus;
};

const PUSH_TOKEN_STORAGE_KEY = "@notifications.pushToken";

function getExpoProjectId(): string | undefined {
  const expoConfig = (Constants.expoConfig as any) ?? {};
  const manifest = (Constants as any)?.manifest ?? {};
  const easConfig = (Constants as any)?.easConfig ?? {};

  const projectId =
    easConfig.projectId ??
    expoConfig?.extra?.eas?.projectId ??
    manifest?.extra?.eas?.projectId;

  return typeof projectId === "string" && projectId.trim().length > 0
    ? projectId.trim()
    : undefined;
}

async function cachePushToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  } catch (error) {
    console.warn("[Notifications] Failed to cache push token:", error);
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[Notifications] Failed to read cached push token:", error);
    return null;
  }
}

export async function clearCachedPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[Notifications] Failed to clear cached push token:", error);
  }
}

/**
 * 檢查當前推播權限狀態
 */
export async function checkPushPermission(): Promise<PermissionResult> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return {
    granted: status === "granted",
    canAskAgain,
    status,
  };
}

/**
 * 引導用戶到設定開啟推播權限
 */
export function openNotificationSettings(): void {
  if (Platform.OS === "ios") {
    Linking.openURL("app-settings:");
  } else {
    Linking.openSettings();
  }
}

/**
 * 顯示權限被拒絕時的提示
 */
export function showPermissionDeniedAlert(): void {
  Alert.alert(
    "推播通知已關閉",
    "您已關閉推播通知權限。如需接收重要通知，請前往設定開啟。",
    [
      { text: "稍後再說", style: "cancel" },
      { text: "前往設定", onPress: openNotificationSettings },
    ]
  );
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  const permission = await checkPushPermission();
  let finalStatus = permission.status;

  if (!permission.granted) {
    if (permission.canAskAgain) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    } else {
      // 用戶已拒絕且無法再次請求
      showPermissionDeniedAlert();
      trackEvent("push_permission_denied_permanent", {});
      return null;
    }
  }

  if (finalStatus !== "granted") {
    console.log("Push notification permission not granted");
    trackEvent("push_permission_denied", {});
    return null;
  }

  // 追蹤權限授予
  trackEvent("push_permission_granted", {});

  if (Platform.OS === "android") {
    // 使用 Promise.all 並行建立頻道，加速初始化
    await Promise.all([
      Notifications.setNotificationChannelAsync("default", {
        name: "預設",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#7C5CFF",
      }),
      Notifications.setNotificationChannelAsync("announcements", {
        name: "公告通知",
        description: "學校公告、系所公告",
        importance: Notifications.AndroidImportance.HIGH,
      }),
      Notifications.setNotificationChannelAsync("events", {
        name: "活動通知",
        description: "活動提醒、報名通知",
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
      Notifications.setNotificationChannelAsync("groups", {
        name: "群組通知",
        description: "群組貼文、作業、成績",
        importance: Notifications.AndroidImportance.HIGH,
      }),
      Notifications.setNotificationChannelAsync("messages", {
        name: "訊息通知",
        description: "私人訊息",
        importance: Notifications.AndroidImportance.MAX,
      }),
    ]);
  }

  try {
    const projectId = getExpoProjectId();
    if (!projectId) {
      console.warn("[Notifications] Expo projectId is missing; push token retrieval may fail in production builds.");
    }

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    await cachePushToken(tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.error("Failed to get push token:", error);
    trackEvent("push_token_error", { error: String(error) });
    return null;
  }
}

/**
 * 儲存推播 Token 到 Firestore（帶重試機制）
 */
export async function savePushTokenToFirestore(
  uid: string,
  token: string
): Promise<void> {
  const db = getDb();
  const tokenId = token.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100);

  const tokenDoc: PushTokenInfo = {
    token,
    type: token.startsWith("ExponentPushToken") ? "expo" : "fcm",
    platform: Platform.OS as "ios" | "android" | "web",
    deviceName: Device.deviceName ?? undefined,
    createdAt: serverTimestamp(),
  };

  await withRetry(
    () => setDoc(doc(db, "users", uid, "pushTokens", tokenId), tokenDoc),
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (error, attempt) => {
        console.warn(`[Notifications] Retrying token save (attempt ${attempt}):`, error.message);
      },
    }
  );

  await cachePushToken(token);
  
  trackEvent("push_token_saved", { platform: Platform.OS });
}

/**
 * 從 Firestore 移除推播 Token（帶重試機制）
 */
export async function removePushTokenFromFirestore(
  uid: string,
  token: string
): Promise<void> {
  const db = getDb();
  const tokenId = token.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100);
  
  await withRetry(
    () => deleteDoc(doc(db, "users", uid, "pushTokens", tokenId)),
    {
      maxRetries: 2,
      baseDelayMs: 500,
    }
  );

  const cachedToken = await getCachedPushToken();
  if (cachedToken === token) {
    await clearCachedPushToken();
  }
}

/**
 * 檢查 Token 是否仍然有效並更新
 */
export async function refreshPushTokenIfNeeded(uid: string): Promise<void> {
  try {
    const currentToken = await registerForPushNotificationsAsync();
    if (!currentToken) return;

    const db = getDb();
    const tokenId = currentToken.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100);
    const tokenRef = doc(db, "users", uid, "pushTokens", tokenId);
    
    const existing = await getDoc(tokenRef);
    
    if (!existing.exists()) {
      // Token 不存在，儲存新的
      await savePushTokenToFirestore(uid, currentToken);
    } else {
      // 更新最後活動時間
      await setDoc(tokenRef, { lastActiveAt: serverTimestamp() }, { merge: true });
    }
  } catch (error) {
    console.error("[Notifications] Failed to refresh token:", error);
  }
}

export { defaultNotificationPreferences, type NotificationPreferences };

export async function syncPushTokenForUser(uid: string): Promise<string | null> {
  const token = await registerForPushNotificationsAsync();
  if (!token) return null;

  await savePushTokenToFirestore(uid, token);
  return token;
}

export async function loadNotificationPreferences(uid: string): Promise<NotificationPreferences> {
  const db = getDb();
  const snap = await getDoc(doc(db, "users", uid, "settings", "notifications"));
  if (!snap.exists()) {
    return defaultNotificationPreferences;
  }

  return normalizeNotificationPreferences(snap.data() as Partial<NotificationPreferences>);
}

/**
 * 儲存通知偏好設定（帶重試機制）
 */
export async function saveNotificationPreferences(
  uid: string,
  prefs: NotificationPreferences
): Promise<void> {
  const db = getDb();
  
  await withRetry(
    () => setDoc(
      doc(db, "users", uid, "settings", "notifications"),
      {
        ...prefs,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
    {
      maxRetries: 2,
      baseDelayMs: 500,
    }
  );
  
  trackEvent("notification_preferences_updated", {
    enabled: prefs.enabled,
    announcements: prefs.announcements,
    events: prefs.events,
  });
}

/**
 * 監聽接收到的通知（前景）
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener((notification) => {
    // 追蹤通知接收
    trackEvent("notification_received", {
      title: notification.request.content.title ?? "",
      channelId: String((notification.request.content.data as any)?.channelId ?? "default"),
    });
    callback(notification);
  });
}

/**
 * 監聽用戶點擊通知的回應
 */
export function addNotificationResponseReceivedListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    // 追蹤通知點擊
    trackEvent("notification_clicked", {
      title: response.notification.request.content.title ?? "",
      actionIdentifier: response.actionIdentifier,
      data: JSON.stringify(response.notification.request.content.data || {}),
    });
    callback(response);
  });
}

export async function getLastNotificationResponseAsync(): Promise<Notifications.NotificationResponse | null> {
  return Notifications.getLastNotificationResponseAsync();
}

export async function clearLastNotificationResponseAsync(): Promise<void> {
  await Notifications.clearLastNotificationResponseAsync();
}

export async function getBadgeCountAsync(): Promise<number> {
  return Notifications.getBadgeCountAsync();
}

export async function setBadgeCountAsync(count: number): Promise<boolean> {
  return Notifications.setBadgeCountAsync(count);
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
  trigger?: Notifications.NotificationTriggerInput
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: trigger ?? null,
  });
}

export async function cancelAllScheduledNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function dismissAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
}

/**
 * 取消特定排程通知
 */
export async function cancelNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * 取得所有排程的通知
 */
export async function getAllScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  return Notifications.getAllScheduledNotificationsAsync();
}

export type ScheduledNotificationConfig = {
  title: string;
  body: string;
  data?: Record<string, any>;
  trigger: {
    weekday?: number;
    hour: number;
    minute: number;
    repeats?: boolean;
    seconds?: number;
  };
  channelId?: string;
};

/**
 * 排程推播通知（支援週期性推播）
 */
export async function schedulePushNotification(
  config: ScheduledNotificationConfig
): Promise<string> {
  const { title, body, data, trigger, channelId } = config;
  
  let triggerInput: Notifications.NotificationTriggerInput;
  
  if (trigger.weekday !== undefined) {
    triggerInput = {
      weekday: trigger.weekday,
      hour: trigger.hour,
      minute: trigger.minute,
      repeats: trigger.repeats ?? false,
    } as any;
  } else if (trigger.seconds !== undefined) {
    triggerInput = {
      seconds: trigger.seconds,
      repeats: trigger.repeats ?? false,
    } as any;
  } else {
    triggerInput = {
      hour: trigger.hour,
      minute: trigger.minute,
      repeats: trigger.repeats ?? false,
    } as any;
  }
  
  const content: any = {
    title,
    body,
    data,
    sound: true,
  };
  if (Platform.OS === "android") {
    content.channelId = channelId ?? "default";
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content,
    trigger: triggerInput,
  });
  
  trackEvent("notification_scheduled", {
    title,
    repeats: trigger.repeats ?? false,
    weekday: trigger.weekday ?? -1,
    hour: trigger.hour,
  });
  
  return notificationId;
}

/**
 * 立即發送本地通知
 */
export async function sendImmediateNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
  channelId?: string
): Promise<string> {
  const content: any = {
    title,
    body,
    data,
    sound: true,
  };
  if (Platform.OS === "android") {
    content.channelId = channelId ?? "default";
  }

  return Notifications.scheduleNotificationAsync({
    content,
    trigger: null,
  });
}

/**
 * 顯示即將到來的通知（用於測試和調試）
 */
export async function getUpcomingNotifications(): Promise<{
  id: string;
  title: string;
  body: string;
  trigger: any;
}[]> {
  const scheduled = await getAllScheduledNotifications();
  return scheduled.map(n => ({
    id: n.identifier,
    title: n.content.title ?? "",
    body: n.content.body ?? "",
    trigger: n.trigger,
  }));
}
