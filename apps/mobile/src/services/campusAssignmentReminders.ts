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

import { resolveCampusAssignmentTarget } from './campusAssignmentTarget';
import { parseCampusAssignmentSource } from './campusAssignmentSource';
import {
  adoptSubmittedAssignmentReminder, linkedReminderIdentifiers,
  scheduleSubmittedAssignmentReminder, submittedAssignmentReminderStatus,
  cancelSubmittedAssignmentReminder, clearSubmittedAssignmentReminders, resumeSubmittedAssignmentReminders,
} from './submittedAssignmentReminders';

export type CampusReminderLead = 60 | 1440;
export type CampusReminderOutcome = 'scheduled' | 'already-scheduled' | 'submitted' | 'inactive';

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
// Sign-out fences work synchronously, before any asynchronous notification cleanup.
// Every in-flight operation captures the epoch so it cannot finish after teardown.
let reminderEpoch = 0;
let reminderTeardownActive = false;

export class CampusReminderError extends Error {
  constructor(
    public readonly code:
      | 'session-changed' | 'invalid-source' | 'expired-source' | 'deadline-too-close'
      | 'unsupported' | 'permission-required' | 'device-capacity' | 'busy' | 'native-failed'
      | 'legacy-cleanup-required',
  ) {
    super(code);
    this.name = 'CampusReminderError';
  }
}

function checkAccount(
  scope: CampusReminderScope, isCurrent: () => boolean, expectedEpoch = reminderEpoch,
) {
  if (reminderTeardownActive || expectedEpoch !== reminderEpoch ||
      !isCurrent() || isFirebaseMockMode() || !scope.uid || !scope.schoolId ||
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
  expectedEpoch = reminderEpoch,
): { dueAt: string; triggerAt: number; title: string; groupName: string } {
  checkAccount(req.scope, req.isCurrent, expectedEpoch);
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

// Reading or cancelling an owned alarm may use its last known source even after the preview expires.
function knownReminderSource(input: {
  scope: CampusReminderScope; step: CampusPlanStep; snapshot?: CampusSenseSnapshot | null;
}) {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.userId !== input.scope.uid || snapshot.schoolId !== input.scope.schoolId ||
      snapshot.assignments.status !== 'available') return null;
  const matches = snapshot.assignments.items.filter((row) =>
    normalizeTitle(row.title) === input.step.title && row.dueAt === input.step.dueAt &&
    (row.groupName || '') === (input.step.groupName || ''));
  return matches.length === 1 ? parseCampusAssignmentSource(matches[0].source) : null;
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

function busyKey(input: Pick<CampusReminderRequest, 'scope' | 'step' | 'leadMinutes'>): string {
  return JSON.stringify([
    input.scope.uid, input.scope.schoolId, input.step.title,
    input.step.groupName || '', input.step.dueAt, input.leadMinutes,
  ]);
}

/** Called only after the user reviews a specific date, lead time, and taps Confirm. */
export async function scheduleCampusAssignmentReminder(
  input: CampusReminderRequest,
): Promise<CampusReminderReceipt> {
  const target = resolveCampusAssignmentTarget({ assignment: input.step, snapshot: input.snapshot, scope: input.scope });
  if (target) {
    validateAssignment(input, Date.now());
    await adoptCampusReminderSnapshot(input);
    if ((await unlinkedLegacyReminders()).length) throw new CampusReminderError('legacy-cleanup-required');
    return scheduleSubmittedAssignmentReminder({ ...input,
      source: { kind: 'group-assignment', ...target.params },
    });
  }
  const lock = busyKey(input);
  if (pending.has(lock)) throw new CampusReminderError('busy');
  pending.add(lock);
  const epoch = reminderEpoch;
  try {
    const now = Date.now();
    const source = validateAssignment(input, now, epoch);
    if (!supportsLocalNotification()) throw new CampusReminderError('unsupported');
    const key = await reminderKey(input.scope, {
      title: source.title, groupName: source.groupName, dueAt: source.dueAt,
    }, input.leadMinutes);
    checkAccount(input.scope, input.isCurrent, epoch);
    // Reject a source that elapsed while native modules were initializing.
    validateAssignment(input, Date.now(), epoch);

    const previous = await readRecord(key.storageKey);
    const inventory = await scheduledInventory();
    checkAccount(input.scope, input.isCurrent, epoch);
    validateAssignment(input, Date.now(), epoch);

    if (inventory.some((item) => item.identifier === key.identifier)) {
      if (previous && previous.identifier !== key.identifier) throw new CampusReminderError('native-failed');
      if (!previous) {
        await AsyncStorage.setItem(key.storageKey, JSON.stringify({
          version: 1, identifier: key.identifier, triggerAt: new Date(source.triggerAt).toISOString(),
        } satisfies ReminderRecord)).catch(() => { throw new CampusReminderError('native-failed'); });
      }
      checkAccount(input.scope, input.isCurrent, epoch);
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
    checkAccount(input.scope, input.isCurrent, epoch);
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    checkAccount(input.scope, input.isCurrent, epoch);
    validateAssignment(input, Date.now(), epoch);
    if (!permission.granted) throw new CampusReminderError('permission-required');

    let scheduleAttempted = false;
    try {
      // A native bridge may persist the alarm and then reject its JS promise.
      // Always attempt an own-ID rollback once scheduling has been attempted.
      scheduleAttempted = true;
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
      if (returnedId !== key.identifier) throw new CampusReminderError('native-failed');
      const nativeInventory = await scheduledInventory();
      if (!nativeInventory.some((row) => row.identifier === key.identifier)) {
        throw new CampusReminderError('native-failed');
      }
      checkAccount(input.scope, input.isCurrent, epoch);
      validateAssignment(input, Date.now(), epoch);
      await AsyncStorage.setItem(key.storageKey, JSON.stringify({
        version: 1,
        identifier: key.identifier,
        triggerAt: new Date(source.triggerAt).toISOString(),
      } satisfies ReminderRecord));
      checkAccount(input.scope, input.isCurrent, epoch);
      return { outcome: 'scheduled', triggerAt: new Date(source.triggerAt).toISOString() };
    } catch (error) {
      // Transaction-like rollback: never report success if the device or receipt fails.
      if (scheduleAttempted) {
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

/**
 * A read-only, native-backed status check. Never mistake a persisted receipt for
 * an OS-scheduled reminder. A restarted UI can recover pending alarms.
 */
export async function getCampusAssignmentReminderStatus(input: {
  scope: CampusReminderScope;
  step: CampusPlanStep;
  snapshot?: CampusSenseSnapshot | null;
  isCurrent: () => boolean;
  scheduledOnly?: boolean;
}): Promise<CampusReminderLead[]> {
  const source = knownReminderSource(input);
  if (source) {
    await adoptCampusReminderSnapshot(input);
    return submittedAssignmentReminderStatus({ ...input, source });
  }
  const epoch = reminderEpoch;
  checkAccount(input.scope, input.isCurrent, epoch);
  if (!input.step.dueAt || !input.step.title ||
      input.step.evidence !== 'authorized-assignments' || input.step.route !== '/classroom') {
    return [];
  }
  const keys = await Promise.all(([60, 1440] as const).map((lead) =>
    reminderKey(input.scope, input.step, lead)));
  checkAccount(input.scope, input.isCurrent, epoch);
  const inventory = await scheduledInventory();
  checkAccount(input.scope, input.isCurrent, epoch);
  const ids = new Set(inventory.map((item) => item.identifier));
  // Any legacy receipt with no corresponding OS alarm is obsolete.
  return ([60, 1440] as const).filter((_, i) => ids.has(keys[i].identifier));
}

/**
 * Called synchronously when the user starts a confirmed sign-out. Only the
 * Campus Agent reminder namespace is touched, never other local notifications.
 * The epoch fences pending schedule/cancel work, which then self-rollback.
 */
export function beginCampusAssignmentReminderSignOutCleanup(): Promise<number> {
  const submittedCleanup = clearSubmittedAssignmentReminders(true);
  reminderTeardownActive = true;
  reminderEpoch += 1;
  return (async () => {
    await submittedCleanup;
    if (!supportsLocalNotification()) return 0;
    const initial = await scheduledInventory();
    const ours = initial.filter((item) =>
      item.identifier.startsWith(CAMPUS_AGENT_REMINDER_PREFIX));
    const outcomes = await Promise.allSettled(ours.map((item) =>
      Notifications.cancelScheduledNotificationAsync(item.identifier)));
    if (outcomes.some((result) => result.status === 'rejected')) {
      throw new CampusReminderError('native-failed');
    }
    const remaining = await scheduledInventory();
    if (remaining.some((item) =>
      item.identifier.startsWith(CAMPUS_AGENT_REMINDER_PREFIX))) {
      throw new CampusReminderError('native-failed');
    }
    // Past hashed receipt keys contain no user info and are never used as proof
    // of scheduling. Best-effort deletion avoids retaining stale local state.
    const keys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
    const receiptKeys = keys.filter((key) =>
      key.startsWith('@campus-agent-due-reminder:v1:'));
    if (receiptKeys.length) {
      await AsyncStorage.multiRemove(receiptKeys).catch(() => {
        throw new CampusReminderError('native-failed');
      });
    }
    return ours.length;
  })();
}

/** Release the fence only after the sign-out handler finishes (or fails). */
export function endCampusAssignmentReminderSignOutCleanup(): void {
  resumeSubmittedAssignmentReminders();
  reminderEpoch += 1;
  reminderTeardownActive = false;
}

/** Only remove an alarm for the signed-in owner. This cannot touch other features. */
export async function cancelCampusAssignmentReminder(input: {
  scope: CampusReminderScope;
  step: CampusPlanStep;
  snapshot?: CampusSenseSnapshot | null;
  leadMinutes: CampusReminderLead;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const source = knownReminderSource(input);
  if (source) {
    await adoptCampusReminderSnapshot(input);
    return cancelSubmittedAssignmentReminder({ ...input, source });
  }
  const epoch = reminderEpoch;
  checkAccount(input.scope, input.isCurrent, epoch);
  if (input.step.evidence !== 'authorized-assignments' || !input.step.dueAt) {
    throw new CampusReminderError('invalid-source');
  }
  const lock = busyKey(input);
  if (pending.has(lock)) throw new CampusReminderError('busy');
  pending.add(lock);
  try {
    const key = await reminderKey(input.scope, input.step, input.leadMinutes);
    checkAccount(input.scope, input.isCurrent, epoch);
    const record = await readRecord(key.storageKey);
    const inventory = await scheduledInventory();
    checkAccount(input.scope, input.isCurrent, epoch);
    if (record && record.identifier !== key.identifier) throw new CampusReminderError('native-failed');
    const exists = inventory.some((row) => row.identifier === key.identifier);
    if (exists) {
      await Notifications.cancelScheduledNotificationAsync(key.identifier);
      // An API resolve is not proof that the alarm disappeared.
      const afterCancel = await scheduledInventory();
      if (afterCancel.some((row) => row.identifier === key.identifier)) {
        throw new CampusReminderError('native-failed');
      }
    }
    checkAccount(input.scope, input.isCurrent, epoch);
    if (record) await AsyncStorage.removeItem(key.storageKey);
    return exists;
  } catch (error) {
    if (error instanceof CampusReminderError) throw error;
    throw new CampusReminderError('native-failed');
  } finally {
    pending.delete(lock);
  }
}

export async function adoptCampusReminderSnapshot(input: {
  scope: CampusReminderScope; snapshot?: CampusSenseSnapshot | null; isCurrent: () => boolean;
}) {
  const version = reminderEpoch;
  checkAccount(input.scope, input.isCurrent, version);
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.userId !== input.scope.uid || snapshot.schoolId !== input.scope.schoolId ||
      snapshot.assignments.status !== 'available') return;
  const inventory = await scheduledInventory();
  const sample = await reminderKey(input.scope, { title: '', dueAt: '' }, 60);
  const linked = await linkedReminderIdentifiers();
  const unresolved = new Set(inventory.filter((alarm) =>
    alarm.identifier.startsWith(sample.identifier.slice(0, -32)) && !linked.has(alarm.identifier))
    .map((alarm) => alarm.identifier));
  if (!unresolved.size) return;
  for (const item of snapshot.assignments.items) {
    const source = parseCampusAssignmentSource(item.source);
    if (!source || !item.dueAt) continue;
    const matches = snapshot.assignments.items.filter((other) =>
      normalizeTitle(other.title) === normalizeTitle(item.title) &&
      other.dueAt === item.dueAt && other.groupName === item.groupName);
    if (matches.length !== 1) continue;
    for (const leadMinutes of [60, 1440] as const) {
      const old = await reminderKey(input.scope, { ...item, title: normalizeTitle(item.title) }, leadMinutes);
      checkAccount(input.scope, input.isCurrent, version);
      if (!unresolved.has(old.identifier)) continue;
      await adoptSubmittedAssignmentReminder({ ...input, source, leadMinutes }, {
        identifier: old.identifier, storageKey: old.storageKey, title: item.title,
        triggerAt: new Date(Date.parse(item.dueAt) - leadMinutes * 60_000).toISOString(),
      });
      unresolved.delete(old.identifier);
    }
    if (!unresolved.size) break;
  }
}

export async function unlinkedLegacyReminders() {
  const linked = await linkedReminderIdentifiers();
  const sample = await reminderKey({ uid: '', schoolId: '' }, { title: '', dueAt: '' }, 60);
  const namespace = sample.identifier.slice(0, -32);
  return (await scheduledInventory()).filter((row) =>
    row.identifier.startsWith(namespace) && !linked.has(row.identifier));
}

export async function clearUnlinkedLegacyReminders(input: {
  scope: CampusReminderScope; isCurrent: () => boolean;
}) {
  const version = reminderEpoch;
  checkAccount(input.scope, input.isCurrent, version);
  const rows = await unlinkedLegacyReminders();
  for (const row of rows) {
    checkAccount(input.scope, input.isCurrent, version);
    await Notifications.cancelScheduledNotificationAsync(row.identifier);
  }
  const remaining = await scheduledInventory();
  if (rows.some((row) => remaining.some((other) => row.identifier === other.identifier)))
    throw new CampusReminderError('native-failed');
  checkAccount(input.scope, input.isCurrent, version);
  const sample = await reminderKey(input.scope, { title: '', dueAt: '' }, 60);
  for (const storageKey of await AsyncStorage.getAllKeys()) {
    if (!storageKey.startsWith(sample.storageKey.slice(0, -64))) continue;
    const record = await readRecord(storageKey);
    checkAccount(input.scope, input.isCurrent, version);
    if (record && rows.some((row) => row.identifier === record.identifier))
      await AsyncStorage.removeItem(storageKey);
  }
}

/** Pair before submission while the authorized summary still contains pending work. */
export async function prepareAssignmentReminderSubmission(
  uid: string,
  resolveSchool: () => Promise<string>,
) {
  try {
    if (!supportsLocalNotification() || !(await unlinkedLegacyReminders()).length) return;
    const schoolId = await resolveSchool();
    const isCurrent = () => getAuthInstance().currentUser?.uid === uid;
    const scope = { uid, schoolId };
    const { refreshCampusSenseSnapshot } = require('./campusSenseSnapshot') as typeof import('./campusSenseSnapshot');
    const snapshot = await refreshCampusSenseSnapshot({ scope, isCurrent });
    if (snapshot.assignments.coverage?.complete === false)
      return '校園作業資料尚未完整同步，舊版提醒仍可能響鈴。可稍後到校園助理的舊版作業提醒管理重試核對，無須取消其他作業提醒。';
    await adoptCampusReminderSnapshot({ scope, snapshot, isCurrent });
    if ((await unlinkedLegacyReminders()).length)
      return '有尚未辨識的舊版作業提醒，仍可能響鈴。可到校園助理的舊版作業提醒管理核對，無須取消其他作業提醒。';
  } catch {
    return '提醒核對暫時失敗，提醒仍可能響鈴。可稍後到校園助理的舊版作業提醒管理重試。';
  }
}
