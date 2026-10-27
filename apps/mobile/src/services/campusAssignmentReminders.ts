/**
 * One-shot, user-confirmed local notifications for source-verified assignments.
 * This is deliberately separate from LMS submissions and cloud push delivery.
 * Never schedule from a generated text reply, an expired snapshot, or an
 * unverified school/account. Notification content contains no private titles.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import type { CampusPlanStep } from './offlineCampusPlanner';

export type CampusReminderLead = 60 | 1440;
export type CampusReminderOutcome = 'scheduled' | 'already-scheduled';

export interface CampusReminderScope {
  uid: string;
  schoolId: string;
}
export interface CampusReminderRequest {
  scope: CampusReminderScope;
  step: CampusPlanStep;
  snapshot: CampusSenseSnapshot;
  leadMinutes: CampusReminderLead;
  isCurrent: () => boolean;
}
export interface CampusReminderReceipt {
  outcome: CampusReminderOutcome;
  triggerAt: string;
}
type ReminderRecord = { version: 1; identifier: string; triggerAt: string };

export const CAMPUS_AGENT_REMINDER_PREFIX = 'campus-agent.due.';
export const CAMPUS_AGENT_REMINDER_BUDGET = 32;
const pending = new Set<string>();

export class CampusReminderError extends Error {
  constructor(
    public readonly code:
      | 'session-changed' | 'invalid-source' | 'expired-source' | 'deadline-too-close'
      | 'unsupported' | 'permission-required' | 'device-capacity' | 'busy' | 'native-failed',
  ) {
    super(code);
    this.name = 'CampusReminderError';
  }
}

function checkAccount(scope: CampusReminderScope, isCurrent: () => boolean) {
  if (!isCurrent() || isFirebaseMockMode() || !scope.uid || !scope.schoolId ||
      getAuthInstance().currentUser?.uid !== scope.uid) {
    throw new CampusReminderError('session-changed');
  }
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 130);
}

function validateAssignment(
  req: CampusReminderRequest,
  now: number,
): { dueAt: string; triggerAt: number; title: string; groupName: string } {
  checkAccount(req.scope, req.isCurrent);
  if (req.leadMinutes !== 60 && req.leadMinutes !== 1440 ||
      req.step.evidence !== 'authorized-assignments' || req.step.route !== '/classroom' ||
      !req.step.dueAt || !req.step.title) {
    throw new CampusReminderError('invalid-source');
  }
  const snapshot = validCampusSenseSnapshot(req.snapshot, req.scope, now);
  if (!snapshot) throw new CampusReminderError('expired-source');
  if (snapshot.assignments.status !== 'available') throw new CampusReminderError('invalid-source');

  const item = snapshot.assignments.items.find((assignment) =>
    normalizeTitle(assignment.title) === req.step.title &&
    assignment.dueAt === req.step.dueAt &&
    (assignment.groupName || '') === (req.step.groupName || ''));
  if (!item || !item.dueAt) throw new CampusReminderError('invalid-source');

  const due = Date.parse(item.dueAt);
  if (!Number.isFinite(due) || due - now > 366 * 86_400_000) {
    throw new CampusReminderError('invalid-source');
  }
  const triggerAt = due - req.leadMinutes * 60_000;
  if (triggerAt <= now + 60_000) throw new CampusReminderError('deadline-too-close');
  return {
    dueAt: item.dueAt,
    triggerAt,
    title: normalizeTitle(item.title),
    groupName: item.groupName || '',
  };
}

function supportsLocalNotification() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Stable, opaque identifier: same user/school/assignment/deadline/lead -> same OS slot. */
async function reminderKey(
  scope: CampusReminderScope,
  step: Pick<CampusPlanStep, 'title' | 'dueAt' | 'groupName'>,
  leadMinutes: CampusReminderLead,
) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      'campus-assignment-reminder-v1', scope.uid, scope.schoolId,
      step.title, step.groupName || '', step.dueAt, leadMinutes,
    ]),
  );
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new CampusReminderError('native-failed');
  const identifier = CAMPUS_AGENT_REMINDER_PREFIX + digest.slice(0, 32);
  return { identifier, storageKey: '@campus-agent-due-reminder:v1:' + digest };
}

async function readRecord(storageKey: string): Promise<ReminderRecord | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(storageKey);
  } catch {
    throw new CampusReminderError('native-failed');
  }
  if (raw === null) return null;
  try {
    const item = JSON.parse(raw) as ReminderRecord;
    if (item?.version !== 1 || typeof item.identifier !== 'string' ||
        !item.identifier.startsWith(CAMPUS_AGENT_REMINDER_PREFIX) ||
        typeof item.triggerAt !== 'string') {
      throw new Error('invalid receipt');
    }
    return item;
  } catch {
    // Never overwrite malformed persistent state: it could hide an old OS alarm.
    throw new CampusReminderError('native-failed');
  }
}

async function scheduledInventory() {
  try {
    const items = await Notifications.getAllScheduledNotificationsAsync();
    if (!Array.isArray(items)) throw new Error('Invalid scheduled list');
    return items;
  } catch {
    throw new CampusReminderError('native-failed');
  }
}

function busyKey(input: CampusReminderRequest): string {
  return JSON.stringify([
    input.scope.uid, input.scope.schoolId, input.step.title,
    input.step.groupName || '', input.step.dueAt, input.leadMinutes,
  ]);
}

/** Called only after the user reviews a specific date, lead time, and taps Confirm. */
export async function scheduleCampusAssignmentReminder(
  input: CampusReminderRequest,
): Promise<CampusReminderReceipt> {
  const lock = busyKey(input);
  if (pending.has(lock)) throw new CampusReminderError('busy');
  pending.add(lock);
  try {
    const now = Date.now();
    const source = validateAssignment(input, now);
    if (!supportsLocalNotification()) throw new CampusReminderError('unsupported');
    const key = await reminderKey(input.scope, {
      title: source.title, groupName: source.groupName, dueAt: source.dueAt,
    }, input.leadMinutes);
    checkAccount(input.scope, input.isCurrent);
    // Reject a source that elapsed while native modules were initializing.
    validateAssignment(input, Date.now());

    const previous = await readRecord(key.storageKey);
    const inventory = await scheduledInventory();
    checkAccount(input.scope, input.isCurrent);
    validateAssignment(input, Date.now());

    if (inventory.some((item) => item.identifier === key.identifier)) {
      if (previous && previous.identifier !== key.identifier) throw new CampusReminderError('native-failed');
      if (!previous) {
        await AsyncStorage.setItem(key.storageKey, JSON.stringify({
          version: 1, identifier: key.identifier, triggerAt: new Date(source.triggerAt).toISOString(),
        } satisfies ReminderRecord)).catch(() => { throw new CampusReminderError('native-failed'); });
      }
      return { outcome: 'already-scheduled', triggerAt: new Date(source.triggerAt).toISOString() };
    }
    if (inventory.length >= CAMPUS_AGENT_REMINDER_BUDGET) {
      throw new CampusReminderError('device-capacity');
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('campus-agent-local-reminders', {
        name: '校園作業提醒（本機）',
        description: '使用者自行建立的本機提醒，不使用雲端推播',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    checkAccount(input.scope, input.isCurrent);
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    checkAccount(input.scope, input.isCurrent);
    validateAssignment(input, Date.now());
    if (!permission.granted) throw new CampusReminderError('permission-required');

    let scheduled = false;
    try {
      const returnedId = await Notifications.scheduleNotificationAsync({
        identifier: key.identifier,
        content: {
          title: '校園作業提醒',
          body: '一項個人任務即將截止，請回到課程頁確認。',
          data: { type: 'campus_agent_assignment_due_v1' },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(source.triggerAt),
          ...(Platform.OS === 'android' ? { channelId: 'campus-agent-local-reminders' } : {}),
        },
      });
      scheduled = true;
      if (returnedId !== key.identifier) throw new CampusReminderError('native-failed');
      checkAccount(input.scope, input.isCurrent);
      validateAssignment(input, Date.now());
      await AsyncStorage.setItem(key.storageKey, JSON.stringify({
        version: 1,
        identifier: key.identifier,
        triggerAt: new Date(source.triggerAt).toISOString(),
      } satisfies ReminderRecord));
      checkAccount(input.scope, input.isCurrent);
      return { outcome: 'scheduled', triggerAt: new Date(source.triggerAt).toISOString() };
    } catch (error) {
      // Transaction-like rollback: never report success if the device or receipt fails.
      if (scheduled) {
        await Notifications.cancelScheduledNotificationAsync(key.identifier).catch(() => null);
      }
      if (error instanceof CampusReminderError) throw error;
      throw new CampusReminderError('native-failed');
    }
  } catch (error) {
    if (error instanceof CampusReminderError) throw error;
    throw new CampusReminderError('native-failed');
  } finally {
    pending.delete(lock);
  }
}

/** Only remove an alarm for the signed-in owner. This cannot touch other features. */
export async function cancelCampusAssignmentReminder(input: {
  scope: CampusReminderScope;
  step: CampusPlanStep;
  leadMinutes: CampusReminderLead;
  isCurrent: () => boolean;
}): Promise<boolean> {
  checkAccount(input.scope, input.isCurrent);
  if (input.step.evidence !== 'authorized-assignments' || !input.step.dueAt) {
    throw new CampusReminderError('invalid-source');
  }
  const lock = busyKey({ ...input, snapshot: null as never });
  if (pending.has(lock)) throw new CampusReminderError('busy');
  pending.add(lock);
  try {
    const key = await reminderKey(input.scope, input.step, input.leadMinutes);
    checkAccount(input.scope, input.isCurrent);
    const record = await readRecord(key.storageKey);
    const inventory = await scheduledInventory();
    checkAccount(input.scope, input.isCurrent);
    if (record && record.identifier !== key.identifier) throw new CampusReminderError('native-failed');
    const exists = inventory.some((row) => row.identifier === key.identifier);
    if (exists) await Notifications.cancelScheduledNotificationAsync(key.identifier);
    checkAccount(input.scope, input.isCurrent);
    if (record) await AsyncStorage.removeItem(key.storageKey);
    return exists;
  } catch (error) {
    if (error instanceof CampusReminderError) throw error;
    throw new CampusReminderError('native-failed');
  } finally {
    pending.delete(lock);
  }
}
