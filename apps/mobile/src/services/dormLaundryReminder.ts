import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { normalizeDormWorkspace } from '@campus/shared/src/dormitory';
import { readDormitoryWorkspaceStorage } from './dormitoryStorage';

// Only the active workspace may alert. Its timer stays local when the user switches away.
const prefix = 'campus.dorm.laundry.v1.';
export function isDormLaundryReminderIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(prefix) && /^[a-f0-9]{64}$/.test(value.slice(prefix.length));
}

const channelId = 'dorm-laundry';
let scope: string | null = null;
let revision = 0;
let queue: Promise<unknown> = Promise.resolve();
let refreshVersion = 0;

const native = () => Platform.OS === 'ios' || Platform.OS === 'android';

function serialize<T>(action: () => Promise<T>): Promise<T> {
  const pending = queue.catch(() => undefined).then(action);
  queue = pending;
  return pending;
}


export async function laundryNotificationAllowed(ask: boolean): Promise<boolean> {
  if (!native()) return false;
  if (Platform.OS === 'android') {
    const channel = await Notifications.setNotificationChannelAsync(channelId, {
      name: '洗衣到時提醒', importance: Notifications.AndroidImportance.DEFAULT,
    });
    if (channel?.importance === Notifications.AndroidImportance.NONE) return false;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted || !ask || !permission.canAskAgain) return permission.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

type Alarm = { id: string; endAt: number };

async function applyAlarm(alarm: Alarm | null, current: () => boolean) {
  if (!current()) return;
  const inventory = await Notifications.getAllScheduledNotificationsAsync();
  const owned = inventory.filter((item) => isDormLaundryReminderIdentifier(item.identifier));
  const desired = alarm && alarm.endAt > Date.now() ? alarm : null;
  const obsolete = owned.filter((item) => item.identifier !== desired?.id);
  for (const item of obsolete) {
    if (!current()) return;
    await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
  if (current() && obsolete.length) {
    const remaining = await Notifications.getAllScheduledNotificationsAsync();
    if (remaining.some((item) => obsolete.some((old) => old.identifier === item.identifier))) {
      throw new Error('Laundry notification cancellation is unconfirmed');
    }
  }
  if (!current()) return;
  if (!desired || desired.endAt <= Date.now()) return 'inactive' as const;
  if (owned.some((item) => item.identifier === desired.id)) return 'scheduled' as const;
  if (Platform.OS === 'ios' && inventory.length - owned.length >= 64) throw new Error('Notification limit reached');

  const identifier = await Notifications.scheduleNotificationAsync({
    identifier: desired.id,
    content: { title: '洗衣計時已到', body: '你設定的取衣時間到了，可以去看看衣物。', sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(desired.endAt),
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
  });
  if (identifier !== desired.id) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
    throw new Error('Unexpected notification identifier');
  }
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  if (!current()) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
    return;
  }
  if (pending.some((item) => item.identifier === identifier)) return 'scheduled' as const;
  if (desired.endAt <= Date.now()) return 'inactive' as const;
  throw new Error('Laundry notification was not scheduled');
}

export async function selectDormLaundryScope(next: string | null) {
  if (!native()) return;
  if (scope !== next) {
    scope = next;
    const epoch = ++revision;
    // Revoke the old owner's alarms even if an earlier permission or storage read never finishes.
    await serialize(() => applyAlarm(null, () => revision === epoch));
    if (revision !== epoch || !next) return;
  }
  return refreshDormLaundryReminder(next);
}

export async function refreshDormLaundryReminder(key: string | null) {
  if (!native() || scope !== key) return;
  const epoch = revision;
  const sequence = ++refreshVersion;
  const current = () => revision === epoch && sequence === refreshVersion;
  let alarm: Alarm | null = null;
  let denied = false;
  try {
    if (key) {
      const raw = await readDormitoryWorkspaceStorage(key);
      const workspace = normalizeDormWorkspace(raw && JSON.parse(raw));
      const endAt = workspace.laundryEndAt;
      if (current() && workspace.laundryReminder && endAt && endAt > Date.now()) {
        denied = !(await laundryNotificationAllowed(false));
        if (!denied && current()) {
          // Expo serializes native date triggers differently on iOS and Android. Match using an
          // opaque identifier so neither account, campus nor deadline is part of the tap payload.
          const token = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([key, endAt]));
          alarm = { id: prefix + token, endAt };
        }
      }
    }
  } catch (error) {
    if (current()) await serialize(() => applyAlarm(null, current));
    throw error;
  }
  const state = await serialize(() => applyAlarm(alarm, current));
  return denied && state === 'inactive' ? 'denied' as const : state;
}
