import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { buildPersonalToday, classReminderPlan, type PersonalImportRecord } from '@campus/shared';

const CATEGORY = 'personal_class_occurrence';
const preferenceKey = (scope: string) => `class-reminders:${scope}`;
let revision = 0;
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

/** Every refresh invalidates pending work before it can enqueue another alarm. */
export function refreshClassReminders(
  scope: string | null,
  read?: () => Promise<{ records: PersonalImportRecord[]; schoolId: string }>,
  now = new Date(),
): Promise<void> {
  const run = ++revision;
  const current = () => run === revision;
  const job = async () => {
    // Cancel only this feature's inventory, including the previous signed-in scope.
    const inventory = await Notifications.getAllScheduledNotificationsAsync();
    for (const alarm of inventory) {
      if (alarm.content.data?.category === CATEGORY) {
        await Notifications.cancelScheduledNotificationAsync(alarm.identifier);
      }
    }
    if (!current() || !scope || !read || !(await classRemindersEnabled(scope))) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted || !current()) return;
    const { records, schoolId } = await read();
    if (!current()) return;
    const plans = Array.from(
      { length: 7 },
      (_, offset) =>
        buildPersonalToday(records, {
          schoolId,
          now: new Date(now.getTime() + offset * 86400000),
        }).today,
    ).flat();
    const unique = plans.filter(
      (entry, index) =>
        plans.findIndex(
          (other) => other.row.id === entry.row.id && other.startAt === entry.startAt,
        ) === index,
    );
    for (const entry of classReminderPlan(unique, now.getTime()).slice(0, 48)) {
      if (!current()) return;
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: entry.title,
          body: `10 分鐘後上課 · ${entry.location || '教室未填'}${entry.conflict ? ' · 時間重疊，請核對' : ''}`,
          data: { category: CATEGORY, scope, courseId: entry.courseId },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(entry.remindAt),
        },
      });
      if (!current()) await Notifications.cancelScheduledNotificationAsync(identifier);
    }
  };
  const pending = queue.catch(() => undefined).then(job);
  queue = pending;
  return pending;
}
