import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { buildPersonalToday, classReminderPlan, type PersonalImportRecord } from '@campus/shared';
import { PERSONAL_CLASS_REMINDER_CATEGORY } from './personalReminderPayload';

const preferenceKey = (scope: string) => `class-reminders:${scope}`;
let revision = 0;
let activeScope: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

export async function classRemindersEnabled(scope: string): Promise<boolean> {
  return (await AsyncStorage.getItem(preferenceKey(scope))) === 'true';
}

export async function setClassRemindersEnabled(scope: string, enabled: boolean) {
  if (enabled) {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) throw new Error('尚未允許通知，請在系統設定開啟。');
  }
  await AsyncStorage.setItem(preferenceKey(scope), String(enabled));
}

function withNotificationInventory<T>(job: () => Promise<T>): Promise<T> {
  const pending = queue.catch(() => undefined).then(job);
  queue = pending;
  return pending;
}

function upcomingReminders(records: PersonalImportRecord[], schoolId: string, now: Date) {
  const plans = Array.from(
    { length: 7 },
    (_, offset) => buildPersonalToday(records, {
      schoolId,
      now: new Date(now.getTime() + offset * 86400000),
    }).today,
  ).flat();
  const unique = plans.filter((entry, index) => {
    const first = plans.findIndex((other) => other.row.id === entry.row.id && other.startAt === entry.startAt);
    if (first !== index) plans[first].conflict ||= entry.conflict;
    return first === index;
  });
  return classReminderPlan(unique, now.getTime()).slice(0, 48).map((entry) => ({
    ...entry,
    body: `10 分鐘後上課 · ${entry.location || '教室未填'}${entry.conflict ? ' · 時間重疊，請核對' : ''}`,
  }));
}

export async function refreshClassReminders(
  scope: string | null,
  read?: () => Promise<{ records: PersonalImportRecord[]; schoolId: string }>,
  now = new Date(),
): Promise<void> {
  activeScope = read ? scope : null;
  const run = ++revision;
  const current = () => run === revision;

  // Remove foreign alarms before reading any settings or timetable for the new owner.
  const existing = await withNotificationInventory(async () => {
    const owned: Notifications.NotificationRequest[] = [];
    if (!current()) return owned;
    const inventory = await Notifications.getAllScheduledNotificationsAsync();
    for (const alarm of inventory) {
      if (!current()) break;
      const data = alarm.content.data;
      if (data?.category !== PERSONAL_CLASS_REMINDER_CATEGORY) continue;
      if (scope && read && data.scope === scope) owned.push(alarm);
      else await Notifications.cancelScheduledNotificationAsync(alarm.identifier);
    }
    return owned;
  });
  if (!scope || !read || !current()) return;

  // Timetable I/O must not hold the native queue: logout can revoke alarms while a read is pending.
  let plans: ReturnType<typeof upcomingReminders> = [];
  if (await classRemindersEnabled(scope) && current() && (await Notifications.getPermissionsAsync()).granted) {
    if (!current()) return;
    const { records, schoolId } = await read();
    if (!current()) return;
    plans = upcomingReminders(records, schoolId, now);
  }

  await withNotificationInventory(async () => {
    const matched = new Map<(typeof plans)[number], Notifications.NotificationRequest>();
    for (const alarm of existing) {
      if (!current()) return;
      const data = alarm.content.data;
      const plan = plans.find((entry) => entry.courseId === data.courseId && entry.startAt === data.startAt);
      if (plan && !matched.has(plan)) matched.set(plan, alarm);
      else await Notifications.cancelScheduledNotificationAsync(alarm.identifier);
    }

    for (const entry of plans) {
      if (!current()) return;
      const alarm = matched.get(entry);
      if (alarm && alarm.content.title === entry.title && alarm.content.body === entry.body) continue;
      const identifier = await Notifications.scheduleNotificationAsync({
        identifier: alarm?.identifier,
        content: {
          title: entry.title,
          body: entry.body,
          data: { category: PERSONAL_CLASS_REMINDER_CATEGORY, scope, courseId: entry.courseId, startAt: entry.startAt },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(entry.remindAt),
        },
      });
      if (activeScope !== scope) await Notifications.cancelScheduledNotificationAsync(identifier);
    }
  });
}
