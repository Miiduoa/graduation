/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { Platform, Linking, Alert } from 'react-native';
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  getDoc,
  getDocFromServer,
} from 'firebase/firestore';
import {
  defaultNotificationPreferences,
  type NotificationPreferences,
} from '@campus/shared/src/notifications';
import { getDb, getAuthInstance, isFirebaseMockMode } from '../firebase';
import { withRetry, withTimeout } from '../utils/retry';
import { trackEvent } from './analytics';
import { linkingOpenWithPuTronClassGate } from './tronClassWebUiGate';

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
  type: 'expo' | 'fcm' | 'apns';
  platform: 'ios' | 'android' | 'web';
  deviceName?: string;
  createdAt: any;
};

export type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
  status: Notifications.PermissionStatus;
};

const PUSH_TOKEN_STORAGE_KEY = '@notifications.pushToken';
const NOTIFICATION_PREFS_STORAGE_PREFIX = '@notifications.preferences';

function getExpoProjectId(): string | undefined {
  const expoConfig = (Constants.expoConfig as any) ?? {};
  const manifest = (Constants as any)?.manifest ?? {};
  const easConfig = (Constants as any)?.easConfig ?? {};

  const projectId =
    easConfig.projectId ?? expoConfig?.extra?.eas?.projectId ?? manifest?.extra?.eas?.projectId;

  return typeof projectId === 'string' && projectId.trim().length > 0
    ? projectId.trim()
    : undefined;
}

async function cachePushToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  } catch (error) {
    console.warn('[Notifications] Failed to cache push token:', error);
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn('[Notifications] Failed to read cached push token:', error);
    return null;
  }
}

export async function clearCachedPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn('[Notifications] Failed to clear cached push token:', error);
  }
}

/**
 * 檢查當前推播權限狀態
 */
export async function checkPushPermission(): Promise<PermissionResult> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return {
    granted: status === 'granted',
    canAskAgain,
    status,
  };
}

/**
 * 引導用戶到設定開啟推播權限
 */
export function openNotificationSettings(): void {
  if (Platform.OS === 'ios') {
    void linkingOpenWithPuTronClassGate('app-settings:');
    return;
  }
  Linking.openSettings().catch(() => undefined);
}

/**
 * 顯示權限被拒絕時的提示
 */
export function showPermissionDeniedAlert(): void {
  Alert.alert('推播通知已關閉', '您已關閉推播通知權限。如需接收重要通知，請前往設定開啟。', [
    { text: '稍後再說', style: 'cancel' },
    { text: '前往設定', onPress: openNotificationSettings },
  ]);
}

export type PushRegistrationResult =
  | { status: 'enabled'; token: string }
  | { status: 'unsupported' | 'denied' | 'unconfigured' | 'unavailable' };

function assertNotificationOwner(uid: string, isCurrent: () => boolean = () => true): void {
  if (!isCurrent() || isFirebaseMockMode() || getAuthInstance().currentUser?.uid !== uid) {
    throw new Error('Notification account changed');
  }
}

async function requestPushToken(
  isCurrent: () => boolean = () => true,
): Promise<PushRegistrationResult> {
  if (!Device.isDevice || Platform.OS === 'web') return { status: 'unsupported' };
  const projectId = getExpoProjectId();
  if (!projectId) return { status: 'unconfigured' };
  try {
    if (Platform.OS === 'android') {
      // Android 13 requires a channel before the system permission prompt.
      await Promise.all([
        Notifications.setNotificationChannelAsync('default', {
          name: '預設',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#164C40',
        }),
        Notifications.setNotificationChannelAsync('announcements', {
          name: '公告通知',
          description: '學校公告、系所公告',
          importance: Notifications.AndroidImportance.HIGH,
        }),
        Notifications.setNotificationChannelAsync('events', {
          name: '活動通知',
          description: '活動提醒、報名通知',
          importance: Notifications.AndroidImportance.DEFAULT,
        }),
        Notifications.setNotificationChannelAsync('groups', {
          name: '群組通知',
          description: '群組貼文、作業、成績',
          importance: Notifications.AndroidImportance.HIGH,
        }),
        Notifications.setNotificationChannelAsync('messages', {
          name: '訊息通知',
          description: '私人訊息',
          importance: Notifications.AndroidImportance.MAX,
        }),
        Notifications.setNotificationChannelAsync('ai-agent', {
          name: '校園提醒',
          description: '課表、作業與重要校園事件提醒',
          importance: Notifications.AndroidImportance.HIGH,
        }),
      ]);
    }

    if (!isCurrent()) throw new Error('Notification account changed');
    const permission = await checkPushPermission();
    if (!isCurrent()) throw new Error('Notification account changed');
    let finalStatus = permission.status;
    if (!permission.granted && permission.canAskAgain) {
      finalStatus = (await Notifications.requestPermissionsAsync()).status;
      if (!isCurrent()) throw new Error('Notification account changed');
    }
    if (finalStatus !== 'granted')
      return { status: finalStatus === 'denied' ? 'denied' : 'unavailable' };
    if (!isCurrent()) throw new Error('Notification account changed');
    const tokenData = await withTimeout(Notifications.getExpoPushTokenAsync({ projectId }), 12000);
    if (!isCurrent()) throw new Error('Notification account changed');
    if (!tokenData.data) return { status: 'unavailable' };
    return { status: 'enabled', token: tokenData.data };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  const result = await requestPushToken();
  return result.status === 'enabled' ? result.token : null;
}

export async function enablePushNotificationsForUser(
  uid: string,
  isCurrent: () => boolean = () => true,
): Promise<PushRegistrationResult> {
  assertNotificationOwner(uid, isCurrent);
  const result = await requestPushToken(
    () => isCurrent() && getAuthInstance().currentUser?.uid === uid,
  );
  assertNotificationOwner(uid, isCurrent);
  if (result.status !== 'enabled') return result;
  await savePushTokenToFirestore(uid, result.token, isCurrent);
  assertNotificationOwner(uid, isCurrent);
  return result;
}

/**
 * 儲存推播 Token 到 Firestore（帶重試機制）
 */
export async function savePushTokenToFirestore(
  uid: string,
  token: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  assertNotificationOwner(uid, isCurrent);
  const db = getDb();
  const tokenId = token.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);

  const tokenDoc: PushTokenInfo = {
    token,
    type:
      token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken') ? 'expo' : 'fcm',
    platform: Platform.OS as 'ios' | 'android' | 'web',
    ...(Device.deviceName ? { deviceName: Device.deviceName } : {}),
    createdAt: serverTimestamp(),
  };

  await withTimeout(
    withRetry(
      () => {
        assertNotificationOwner(uid, isCurrent);
        return setDoc(doc(db, 'users', uid, 'pushTokens', tokenId), tokenDoc);
      },
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        onRetry: (error, attempt) => {
          console.warn(`[Notifications] Retrying token save (attempt ${attempt}):`, error.message);
        },
      },
    ),
    12000,
  );

  assertNotificationOwner(uid, isCurrent);
  await cachePushToken(token);

  trackEvent('push_token_saved', { platform: Platform.OS });
}

/**
 * 從 Firestore 移除推播 Token（帶重試機制）
 */
export async function removePushTokenFromFirestore(uid: string, token: string): Promise<void> {
  const db = getDb();
  const tokenId = token.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);

  await withRetry(() => deleteDoc(doc(db, 'users', uid, 'pushTokens', tokenId)), {
    maxRetries: 2,
    baseDelayMs: 500,
  });

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
    assertNotificationOwner(uid);
    const currentToken = await registerForPushNotificationsAsync();
    if (!currentToken) return;
    assertNotificationOwner(uid);

    const db = getDb();
    const tokenId = currentToken.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);
    const tokenRef = doc(db, 'users', uid, 'pushTokens', tokenId);

    const existing = await getDoc(tokenRef);
    assertNotificationOwner(uid);

    if (!existing.exists()) {
      // Token 不存在，儲存新的
      await savePushTokenToFirestore(uid, currentToken);
    } else {
      // 更新最後活動時間
      await setDoc(tokenRef, { lastActiveAt: serverTimestamp() }, { merge: true });
    }
  } catch (error) {
    console.error('[Notifications] Failed to refresh token:', error);
  }
}

export { defaultNotificationPreferences, type NotificationPreferences };

export type NotificationPreferenceScope = { schoolId: string; isCurrent?: () => boolean };
export type NotificationPreferenceState = {
  preferences: NotificationPreferences;
  source: 'server' | 'local' | 'cache' | 'unavailable';
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isNotificationTime(value: string): boolean {
  return timePattern.test(value);
}

function normalizePreferences(value: unknown): NotificationPreferences {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const result = { ...defaultNotificationPreferences };
  for (const key of Object.keys(result) as Array<keyof NotificationPreferences>) {
    if (key === 'quietHoursStart' || key === 'quietHoursEnd') {
      if (typeof input[key] === 'string' && isNotificationTime(input[key] as string))
        result[key] = input[key] as string;
    } else if (typeof input[key] === 'boolean') result[key] = input[key] as boolean;
  }
  return result;
}

// In-flight network responses and local cache mutations share an account version.
// A prior screen's completion must not erase a newer unsynced draft.
const preferenceVersions = new Map<string, symbol>();
const preferenceCacheWrites = new Map<string, Promise<void>>();
function beginPreferenceOperation(uid: string, scope: NotificationPreferenceScope): () => void {
  assertNotificationOwner(uid, scope.isCurrent);
  const version = Symbol(uid);
  preferenceVersions.set(uid, version);
  return () => {
    assertNotificationOwner(uid, scope.isCurrent);
    if (preferenceVersions.get(uid) !== version) throw new Error('Notification request superseded');
  };
}
async function updatePreferenceCache(
  uid: string,
  check: () => void,
  write: () => Promise<void>,
): Promise<void> {
  const previous = preferenceCacheWrites.get(uid) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      check();
      await write();
      check();
    });
  preferenceCacheWrites.set(uid, next);
  try {
    await next;
  } finally {
    if (preferenceCacheWrites.get(uid) === next) preferenceCacheWrites.delete(uid);
  }
}

function preferencesKey(uid: string): string {
  return `${NOTIFICATION_PREFS_STORAGE_PREFIX}:${uid}`;
}
function pendingKey(uid: string, scope: NotificationPreferenceScope): string {
  return `${preferencesKey(uid)}:pending:${encodeURIComponent(scope.schoolId)}`;
}
function isOfflineFirestoreError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '').toLowerCase();
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    message.includes('offline') ||
    message.includes('timed out')
  );
}
async function readPreferences(key: string): Promise<NotificationPreferences | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function syncPushTokenForUser(uid: string): Promise<string | null> {
  const result = await enablePushNotificationsForUser(uid);
  return result.status === 'enabled' ? result.token : null;
}

export async function loadNotificationPreferencesState(
  uid: string,
  scope: NotificationPreferenceScope,
): Promise<NotificationPreferenceState> {
  const check = beginPreferenceOperation(uid, scope);
  await preferenceCacheWrites.get(uid)?.catch(() => undefined);
  check();
  const [cached, pending] = await Promise.all([
    readPreferences(preferencesKey(uid)),
    readPreferences(pendingKey(uid, scope)),
  ]);
  check();
  try {
    const snap = await withTimeout(
      getDocFromServer(doc(getDb(), 'users', uid, 'settings', 'notifications')),
      12000,
    );
    check();
    const preferences = normalizePreferences(snap.exists() ? snap.data() : null);
    await updatePreferenceCache(uid, check, () =>
      AsyncStorage.setItem(preferencesKey(uid), JSON.stringify(preferences)),
    );
    check();
    return pending ? { preferences: pending, source: 'local' } : { preferences, source: 'server' };
  } catch (error) {
    check();
    if (!isOfflineFirestoreError(error)) throw error;
    return {
      preferences: pending ?? cached ?? { ...defaultNotificationPreferences },
      source: pending ? 'local' : cached ? 'cache' : 'unavailable',
    };
  }
}

export async function loadNotificationPreferences(uid: string): Promise<NotificationPreferences> {
  return (await loadNotificationPreferencesState(uid, { schoolId: '' })).preferences;
}

export async function saveNotificationPreferences(
  uid: string,
  prefs: NotificationPreferences,
  scope: NotificationPreferenceScope = { schoolId: '' },
): Promise<{ status: 'server' | 'local' }> {
  const check = beginPreferenceOperation(uid, scope);
  check();
  if (!isNotificationTime(prefs.quietHoursStart) || !isNotificationTime(prefs.quietHoursEnd))
    throw new Error('Invalid quiet hours');
  const normalized = normalizePreferences(prefs);
  const saveLocal = async () => {
    check();
    await updatePreferenceCache(uid, check, () =>
      AsyncStorage.setItem(pendingKey(uid, scope), JSON.stringify(normalized)),
    );
    check();
    return { status: 'local' as const };
  };
  const network = await NetInfo.fetch();
  check();
  if (network.isConnected === false || network.isInternetReachable === false) return saveLocal();
  const ref = doc(getDb(), 'users', uid, 'settings', 'notifications');
  try {
    // setDoc resolves only after the backend acknowledges the write.
    await withTimeout(
      setDoc(ref, { ...normalized, updatedAt: serverTimestamp() }, { merge: true }),
      12000,
    );
    check();
  } catch (error) {
    check();
    if (isOfflineFirestoreError(error)) return saveLocal();
    throw error;
  }
  await updatePreferenceCache(uid, check, async () => {
    await AsyncStorage.setItem(preferencesKey(uid), JSON.stringify(normalized));
    check();
    await AsyncStorage.removeItem(pendingKey(uid, scope));
  });
  return { status: 'server' };
}

/**
 * 監聽接收到的通知（前景）
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener((notification) => {
    // 追蹤通知接收
    trackEvent('notification_received', {
      title: notification.request.content.title ?? '',
      channelId: String((notification.request.content.data as any)?.channelId ?? 'default'),
    });
    callback(notification);
  });
}

/**
 * 監聽用戶點擊通知的回應
 */
export function addNotificationResponseReceivedListener(
  callback: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    // 追蹤通知點擊
    trackEvent('notification_clicked', {
      title: response.notification.request.content.title ?? '',
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
  trigger?: Notifications.NotificationTriggerInput,
  channelId?: string,
): Promise<string> {
  const content: any = {
    title,
    body,
    data,
    sound: true,
  };
  if (Platform.OS === 'android') {
    content.channelId = channelId ?? 'default';
  }

  return Notifications.scheduleNotificationAsync({
    content,
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
  config: ScheduledNotificationConfig,
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
  if (Platform.OS === 'android') {
    content.channelId = channelId ?? 'default';
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content,
    trigger: triggerInput,
  });

  trackEvent('notification_scheduled', {
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
  channelId?: string,
): Promise<string> {
  const content: any = {
    title,
    body,
    data,
    sound: true,
  };
  if (Platform.OS === 'android') {
    content.channelId = channelId ?? 'default';
  }

  return Notifications.scheduleNotificationAsync({
    content,
    trigger: null,
  });
}

/**
 * 顯示即將到來的通知（用於測試和調試）
 */
export async function getUpcomingNotifications(): Promise<
  {
    id: string;
    title: string;
    body: string;
    trigger: any;
  }[]
> {
  const scheduled = await getAllScheduledNotifications();
  return scheduled.map((n) => ({
    id: n.identifier,
    title: n.content.title ?? '',
    body: n.content.body ?? '',
    trigger: n.trigger,
  }));
}
