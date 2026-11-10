import AsyncStorage from '@react-native-async-storage/async-storage';
import { nuniId } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { nuniReminderWindow } from './nuniAssignmentReminderWindow';
import { randomUUID } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isNuniAssignmentReminderPayload, NUNI_ASSIGNMENT_REMINDER_CATEGORY } from './personalReminderPayload';

export type NuniAssignmentReminderTarget = {
  accountId: string;
  schoolId: string;
  workspaceId: string;
  assignmentId: string;
};
type Receipt = NuniAssignmentReminderTarget & { token: string; dueAtMs: number; triggerAt: number };
type Guard = () => boolean;
type Review = { dueAt: string; leadMinutes: number; isCurrent: Guard; recheck: () => Promise<boolean> };
type ConfirmResult = 'scheduled' | 'unchanged' | 'denied' | 'stale' | 'expired' | 'unsupported' | 'failed';
type CancelResult = 'cancelled' | 'absent' | 'stale' | 'unsupported' | 'failed';

const key = '@nuni-assignment-reminders:v1';
const prefix = 'nuni.assignment.due.';
const channel = 'campus-agent-local-reminders';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const native = () => Platform.OS === 'ios' || Platform.OS === 'android';
const pending = new Set<{ target: NuniAssignmentReminderTarget; active: boolean }>();
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function validTarget(target: NuniAssignmentReminderTarget): boolean {
  try {
    return nuniId(target.accountId, 'pa') === target.accountId &&
      nuniId(target.workspaceId, 'cw') === target.workspaceId &&
      nuniId(target.assignmentId, 'cwa') === target.assignmentId &&
      typeof target.schoolId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(target.schoolId);
  } catch {
    return false;
  }
}
function sameTarget(a: NuniAssignmentReminderTarget, b: NuniAssignmentReminderTarget) {
  return a.accountId === b.accountId && a.schoolId === b.schoolId &&
    a.workspaceId === b.workspaceId && a.assignmentId === b.assignmentId;
}
async function receipts(): Promise<Receipt[]> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every((r) => validTarget(r) && uuid.test(r.token) &&
      Number.isSafeInteger(r.triggerAt) && Number.isSafeInteger(r.dueAtMs) && r.triggerAt < r.dueAtMs))
    throw new Error('Invalid nuni reminder registry');
  return rows;
}
async function store(rows: Receipt[]) {
  if (rows.length) await AsyncStorage.setItem(key, JSON.stringify(rows));
  else await AsyncStorage.removeItem(key);
}
function matchesAlarm(alarm: Notifications.NotificationRequest, token: string) {
  return alarm.identifier === prefix + token && alarm.content.data?.category === NUNI_ASSIGNMENT_REMINDER_CATEGORY &&
    alarm.content.data.lookupToken === token;
}
async function removeAlarms(ids: string[]) {
  if (!ids.length) return;
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  if ((await Notifications.getAllScheduledNotificationsAsync()).some((alarm) => ids.includes(alarm.identifier)))
    throw new Error('Nuni alarm cancellation unconfirmed');
}

// Only called from an explicit confirmation. Network and permission dialogs do not hold the native queue.
export async function confirmNuniAssignmentReminder(target: NuniAssignmentReminderTarget, review: Review): Promise<ConfirmResult> {
  if (!native()) return 'unsupported';
  if (!validTarget(target) || !review.isCurrent() || ![15, 60, 1440].includes(review.leadMinutes)) return 'stale';
  const dueAtMs = parseTaipeiInstant(review.dueAt);
  if (dueAtMs === null) return 'expired';
  const triggerAt = dueAtMs - review.leadMinutes * 60_000;
  const expired = () => nuniReminderWindow(dueAtMs, triggerAt) !== 'ready';
  if (expired()) return 'expired';
  const job = { target, active: true };
  pending.add(job);
  const current = () => job.active && review.isCurrent();
  try {
    if (Platform.OS === 'android') {
      const installed = await Notifications.setNotificationChannelAsync(channel, {
        name: '校園助理提醒', importance: Notifications.AndroidImportance.DEFAULT,
      });
      if (installed && installed.importance === Notifications.AndroidImportance.NONE) return 'denied';
    }
    if (!current()) return 'stale';
    let permission = await Notifications.getPermissionsAsync();
    if (!current()) return 'stale';
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!current()) return 'stale';
    if (!permission.granted) return 'denied';
    if (expired()) return 'expired';
    if (!(await review.recheck()) || !current()) return 'stale';

    return await serial(async (): Promise<ConfirmResult> => {
      const [rows, alarms] = await Promise.all([receipts(), Notifications.getAllScheduledNotificationsAsync()]);
      if (!current()) return 'stale';
      if (expired()) return 'expired';
      const prior = rows.find((r) => sameTarget(r, target));
      if (prior && prior.dueAtMs === dueAtMs && prior.triggerAt === triggerAt &&
          alarms.some((alarm) => matchesAlarm(alarm, prior.token))) return 'unchanged';
      if ((Platform.OS === 'ios' && alarms.length >= 64) || (!prior && rows.filter((r) => r.dueAtMs > Date.now()).length >= 32)) return 'failed';

      const token = randomUUID();
      if (!uuid.test(token) || rows.some((r) => r.token === token)) return 'failed';
      const identifier = prefix + token;
      const next = rows.filter((r) => r !== prior && r.dueAtMs > Date.now());
      let receiptAttempted = false;
      let priorRemoved = false;
      let committed = false;
      try {
        const id = await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: '作業截止提醒', body: '有一份作業即將截止，點開查看作業。', sound: true,
            data: { category: NUNI_ASSIGNMENT_REMINDER_CATEGORY, lookupToken: token },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(triggerAt),
            ...(Platform.OS === 'android' ? { channelId: channel } : {}) },
        });
        if (id !== identifier || !(await Notifications.getAllScheduledNotificationsAsync())
          .some((alarm) => matchesAlarm(alarm, token))) return 'failed';
        if (!current()) return 'stale';
        if (expired()) return 'expired';
        // Keep the previous alarm intact until storage has accepted its replacement.
        receiptAttempted = true;
        await store([...next, { accountId: target.accountId, schoolId: target.schoolId,
          workspaceId: target.workspaceId, assignmentId: target.assignmentId, dueAtMs, triggerAt, token }]);
        if (!current()) return 'stale';
        if (expired()) return 'expired';
        if (prior) {
          await removeAlarms([prefix + prior.token]);
          priorRemoved = true;
        }
        if (!current()) return 'stale';
        if (expired()) return 'expired';
        committed = true;
        return 'scheduled';
      } finally {
        if (!committed) {
          // Native/storage bridges can perform their write and then reject the JS promise.
          try {
            if (receiptAttempted) await store(priorRemoved ? next : rows);
          } finally {
            await removeAlarms([identifier]);
          }
        }
      }
    });
  } catch {
    return current() ? 'failed' : 'stale';
  } finally {
    pending.delete(job);
  }
}

function revokePending(matches: (target: NuniAssignmentReminderTarget) => boolean) {
  for (const job of pending) if (matches(job.target)) job.active = false;
}

async function removeMatching(matches: (r: NuniAssignmentReminderTarget) => boolean, current: Guard): Promise<CancelResult> {
  if (!native()) return 'unsupported';
  if (!current()) return 'stale';
  revokePending(matches);
  try {
    return await serial(async () => {
      const rows = await receipts();
      if (!current()) return 'stale';
      const removed = rows.filter(matches);
      if (!removed.length) return 'absent';
      await removeAlarms(removed.map((r) => prefix + r.token));
      await store(rows.filter((r) => !matches(r)));
      return current() ? 'cancelled' : 'stale';
    });
  } catch {
    return 'failed';
  }
}
export function cancelNuniAssignmentReminder(target: NuniAssignmentReminderTarget, isCurrent: Guard): Promise<CancelResult> {
  if (!validTarget(target)) return Promise.resolve('stale');
  return removeMatching((r) => sameTarget(r, target), isCurrent);
}

// A confirmed receipt invalidates this student's reminder even if the selected school changed.
export function cancelSubmittedNuniAssignmentReminder(change: Omit<NuniAssignmentReminderTarget, 'schoolId'>) {
  return removeMatching((r) => r.accountId === change.accountId && r.workspaceId === change.workspaceId &&
    r.assignmentId === change.assignmentId, () => true);
}

// Recover orphan alarms after interrupted writes. Fired alarms keep their lookup until the deadline.
export function retainNuniAssignmentReminders(accountId: string | null): Promise<void> {
  revokePending((r) => r.accountId !== accountId);
  if (!native()) return Promise.resolve();
  return serial(async () => {
    const [rows, alarms] = await Promise.all([receipts(), Notifications.getAllScheduledNotificationsAsync()]);
    const kept = rows.filter((r) => r.accountId === accountId && r.dueAtMs > Date.now());
    const ids = new Set(kept.map((r) => prefix + r.token));
    await removeAlarms(alarms.map((a) => a.identifier).filter((id) => id.startsWith(prefix) && !ids.has(id)));
    if (kept.length !== rows.length) await store(kept);
  });
}

export async function resolveNuniAssignmentReminderTap(payload: unknown, identifier: string,
  scope: Pick<NuniAssignmentReminderTarget, 'accountId' | 'schoolId'>): Promise<{ workspaceId: string; assignmentId: string } | null> {
  if (!isNuniAssignmentReminderPayload(payload) || typeof payload.lookupToken !== 'string' || !uuid.test(payload.lookupToken) ||
      identifier !== prefix + payload.lookupToken) return null;
  try {
    return await serial(async () => {
      const row = (await receipts()).find((r) => r.token === payload.lookupToken && r.accountId === scope.accountId &&
        r.schoolId === scope.schoolId && r.dueAtMs > Date.now());
      return row ? { workspaceId: row.workspaceId, assignmentId: row.assignmentId } : null;
    });
  } catch {
    return null;
  }
}
