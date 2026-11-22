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

import {
  campusAssignmentDisplayTitle as normalizeTitle, campusAssignmentLegacyMatches, matchCampusAssignment,
} from './campusAssignmentTarget';
import { parseCampusAssignmentSource } from './campusAssignmentSource';
import {
  adoptSubmittedAssignmentReminderInSequence, linkedReminderIdentifiers,
  scheduleSubmittedAssignmentReminderInSequence, submittedAssignmentReminderStatus,
  cancelSubmittedAssignmentReminderInSequence, clearSubmittedAssignmentReminders, resumeSubmittedAssignmentReminders,
  savedAssignmentReminderPreferences, serializeAssignmentReminderWork,
} from './submittedAssignmentReminders';

export type ReminderAssignment = Pick<CampusPlanStep,
  'evidence' | 'route' | 'title' | 'groupName' | 'dueAt' | 'fullAssignmentTitle' | 'summaryAssignmentTitle' | 'expectedSource'>;
export type CampusReminderLead = 60 | 1440;
export type CampusReminderOutcome = 'scheduled' | 'already-scheduled' | 'submitted' | 'inactive';

export interface CampusReminderScope {
  uid: string;
  schoolId: string;
}
export interface CampusReminderRequest {
  scope: CampusReminderScope;
  step: ReminderAssignment;
  snapshot: CampusSenseSnapshot;
  getSnapshot?: () => CampusSenseSnapshot | null;
  leadMinutes: CampusReminderLead;
  isCurrent: () => boolean;
}
export interface CampusReminderReceipt {
  outcome: CampusReminderOutcome;
  triggerAt: string;
}
type ReminderRecord = { version: 1; identifier: string; triggerAt: string; cardDigest?: string };

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

function validateAssignment(
  req: CampusReminderRequest,
  now: number,
  expectedEpoch = reminderEpoch,
) {
  checkAccount(req.scope, req.isCurrent, expectedEpoch);
  if (req.leadMinutes !== 60 && req.leadMinutes !== 1440 ||
      req.step.evidence !== 'authorized-assignments' || req.step.route !== '/classroom' ||
      !req.step.dueAt || !req.step.title) {
    throw new CampusReminderError('invalid-source');
  }
  const snapshot = validCampusSenseSnapshot(req.snapshot, req.scope, now);
  if (!snapshot) throw new CampusReminderError('expired-source');
  const item = matchCampusAssignment(snapshot, req.step);
  if (!item?.dueAt) throw new CampusReminderError('invalid-source');

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
    item,
    assignmentSource: parseCampusAssignmentSource(item.source),
  };
}

function cardIdentity(step: Pick<ReminderAssignment, 'title' | 'fullAssignmentTitle' | 'summaryAssignmentTitle' | 'groupName' | 'dueAt'>) {
  const title = (step.summaryAssignmentTitle ?? step.fullAssignmentTitle ?? step.title).replace(/\s+/g, ' ').trim();
  return JSON.stringify([title, step.groupName || '', step.dueAt]);
}

function legacyReminderAssignment(step: ReminderAssignment) {
  if (!step.dueAt || !step.title ||
      step.evidence !== 'authorized-assignments' || step.route !== '/classroom') return null;
  // Older cards already hold the display title used in the original OS identifier.
  const title = step.summaryAssignmentTitle ?? step.fullAssignmentTitle;
  return { ...step, title: title ? normalizeTitle(title) : step.title };
}

function reminderCardDigest(step: Parameters<typeof cardIdentity>[0]) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, cardIdentity(step));
}

async function matchesLegacyReceipt(
  record: ReminderRecord | null, step: Parameters<typeof cardIdentity>[0],
) {
  // The caller has already selected the v1 slot using the scoped reminder key.
  // Older receipts have only that identity, so ownership comes from prefix uniqueness
  // in the authorized summary when assigning the slot to a source.
  return !record?.cardDigest || record.cardDigest === await reminderCardDigest(step);
}

function uniqueLegacyReply(input: {
  scope: CampusReminderScope; step: ReminderAssignment; getLegacySnapshot?: () => CampusSenseSnapshot | null;
}) {
  const snapshot = validCampusSenseSnapshot(input.getLegacySnapshot?.(), input.scope);
  if (snapshot?.assignments.status !== 'available') return false;
  const title = input.step.summaryAssignmentTitle ?? input.step.fullAssignmentTitle ?? input.step.title;
  const rows = campusAssignmentLegacyMatches(snapshot, { ...input.step, title });
  if (rows.length !== 1) return false;
  const expected = input.step.expectedSource;
  const actual = parseCampusAssignmentSource(rows[0].source);
  return !expected || (actual?.groupId === expected.groupId && actual.assignmentId === expected.assignmentId);
}

async function matchingReminderPreferences(input: {
  scope: CampusReminderScope; step: ReminderAssignment; isCurrent: () => boolean;
}, legacy: ReminderAssignment) {
  const identity = cardIdentity(input.step);
  const rows = [];
  for (const row of await savedAssignmentReminderPreferences(input.scope, input.isCurrent)) {
    if (row.cardIdentity === identity) {
      rows.push(row);
    } else if (!row.cardIdentity && row.title && row.legacyKeys?.length &&
        cardIdentity({ ...input.step, fullAssignmentTitle: row.title, summaryAssignmentTitle: undefined }) === identity) {
      const key = await reminderKey(input.scope, legacy, row.leadMinutes);
      if (row.legacyKeys.includes(key.storageKey)) rows.push(row);
    }
  }

  const first = rows[0];
  // A source-less card cannot choose between multiple local source IDs.
  return first && rows.every((row) =>
    row.groupId === first.groupId && row.assignmentId === first.assignmentId) ? rows : [];
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
    input.scope.uid, input.scope.schoolId,
    input.step.summaryAssignmentTitle ?? input.step.fullAssignmentTitle ?? input.step.title,
    input.step.groupName || '', input.step.dueAt, input.leadMinutes,
  ]);
}

/** Called only after the user reviews a specific date, lead time, and taps Confirm. */
export async function scheduleCampusAssignmentReminder(
  input: CampusReminderRequest,
): Promise<CampusReminderReceipt> {
  validateAssignment(input, Date.now());
  const lock = busyKey(input);
  if (pending.has(lock)) throw new CampusReminderError('busy');
  pending.add(lock);
  const epoch = reminderEpoch;
  try {
    return await serializeAssignmentReminderWork(() => {
      checkAccount(input.scope, input.isCurrent, epoch);
      const snapshot = input.getSnapshot ? input.getSnapshot() : input.snapshot;
      if (!snapshot) throw new CampusReminderError('expired-source');
      return scheduleCampusAssignmentReminderInSequence({ ...input, snapshot }, epoch);
    });
  } finally {
    pending.delete(lock);
  }
}

async function scheduleCampusAssignmentReminderInSequence(input: CampusReminderRequest, epoch: number): Promise<CampusReminderReceipt> {
  const source = validateAssignment(input, Date.now(), epoch);
  if (source.assignmentSource) {
    await adoptCampusReminderSnapshotInSequence(input, epoch);
    if ((await unlinkedLegacyReminders()).length) throw new CampusReminderError('legacy-cleanup-required');
    validateAssignment(input, Date.now(), epoch);
    return scheduleSubmittedAssignmentReminderInSequence({ ...input, source: source.assignmentSource,
      cardIdentity: cardIdentity(input.step) });
  }
  try {
    if (!supportsLocalNotification()) throw new CampusReminderError('unsupported');
    if (campusAssignmentLegacyMatches(input.snapshot, source.item).length !== 1)
      throw new CampusReminderError('invalid-source');
    const cardDigest = await reminderCardDigest(source.item);
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
      if (!await matchesLegacyReceipt(previous, source.item))
        throw new CampusReminderError('invalid-source');
      if (!previous) {
        await AsyncStorage.setItem(key.storageKey, JSON.stringify({
          version: 1, cardDigest, identifier: key.identifier, triggerAt: new Date(source.triggerAt).toISOString(),
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
        cardDigest,
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
  }
}

type ReminderLookup = {
  scope: CampusReminderScope;
  step: ReminderAssignment;
  snapshot?: CampusSenseSnapshot | null;
  /** Single replies validate their v1 fallback against the latest summary. */
  getLegacySnapshot?: () => CampusSenseSnapshot | null;
  isCurrent: () => boolean;
  scheduledOnly?: boolean;
};

/** A v1 receipt alone does not prove that the OS alarm still exists. */
export function getCampusAssignmentReminderStatus(input: ReminderLookup): Promise<CampusReminderLead[]> {
  const epoch = reminderEpoch;
  return serializeAssignmentReminderWork(() => getCampusAssignmentReminderStatusInSequence(input, epoch));
}

async function getCampusAssignmentReminderStatusInSequence(input: ReminderLookup, epoch: number) {
  checkAccount(input.scope, input.isCurrent, epoch);
  const legacy = legacyReminderAssignment(input.step);
  if (!legacy) return [];
  const source = parseCampusAssignmentSource(input.step.expectedSource);
  const sourced = source
    ? await submittedAssignmentReminderStatus({ ...input, source })
    : (await matchingReminderPreferences(input, legacy))
      .filter((row) => !input.scheduledOnly || row.scheduled).map((row) => row.leadMinutes);
  checkAccount(input.scope, input.isCurrent, epoch);
  if (input.getLegacySnapshot && !uniqueLegacyReply(input)) return sourced;
  const keys = await Promise.all(([60, 1440] as const).map((lead) =>
    reminderKey(input.scope, legacy, lead)));
  checkAccount(input.scope, input.isCurrent, epoch);
  const inventory = await scheduledInventory();
  const linked = await linkedReminderIdentifiers();
  const ids = new Set(inventory.map((item) => item.identifier));
  const leads = [60, 1440] as const;
  const eligible = await Promise.all(keys.map(async (key, index) => {
    if (sourced.includes(leads[index]) || !ids.has(key.identifier) || linked.has(key.identifier)) return false;
    return matchesLegacyReceipt(await readRecord(key.storageKey), input.step);
  }));
  checkAccount(input.scope, input.isCurrent, epoch);
  if (input.getLegacySnapshot && !uniqueLegacyReply(input)) return sourced;
  return leads.filter((lead, index) => sourced.includes(lead) || eligible[index]);
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
  return serializeAssignmentReminderWork(async () => {
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
  });
}

/** Release the fence only after the sign-out handler finishes (or fails). */
export function endCampusAssignmentReminderSignOutCleanup(): void {
  resumeSubmittedAssignmentReminders();
  reminderEpoch += 1;
  reminderTeardownActive = false;
}

/** Only remove an alarm for the signed-in owner. This cannot touch other features. */
export function cancelCampusAssignmentReminder(input: ReminderLookup & { leadMinutes: CampusReminderLead }): Promise<boolean> {
  const epoch = reminderEpoch;
  return serializeAssignmentReminderWork(() => cancelCampusAssignmentReminderInSequence(input, epoch));
}

export function cancelCampusAssignmentReminders(input: ReminderLookup): Promise<boolean> {
  const epoch = reminderEpoch;
  return serializeAssignmentReminderWork(async () => {
    const leads = await getCampusAssignmentReminderStatusInSequence(input, epoch);
    for (const leadMinutes of leads)
      await cancelCampusAssignmentReminderInSequence({ ...input, leadMinutes }, epoch);
    return leads.length > 0;
  });
}

async function cancelCampusAssignmentReminderInSequence(
  input: ReminderLookup & { leadMinutes: CampusReminderLead }, epoch: number,
) {
  checkAccount(input.scope, input.isCurrent, epoch);
  const legacy = legacyReminderAssignment(input.step);
  if (!legacy) throw new CampusReminderError('invalid-source');
  const source = parseCampusAssignmentSource(input.step.expectedSource) ??
    (await matchingReminderPreferences(input, legacy)).find((row) => row.leadMinutes === input.leadMinutes);
  checkAccount(input.scope, input.isCurrent, epoch);
  if (source && (await submittedAssignmentReminderStatus({ ...input, source })).includes(input.leadMinutes)) {
    checkAccount(input.scope, input.isCurrent, epoch);
    return cancelSubmittedAssignmentReminderInSequence({ ...input, source });
  }
  try {
    const key = await reminderKey(input.scope, legacy, input.leadMinutes);
    checkAccount(input.scope, input.isCurrent, epoch);
    const record = await readRecord(key.storageKey);
    if (!await matchesLegacyReceipt(record, input.step))
      throw new CampusReminderError('invalid-source');
    const inventory = await scheduledInventory();
    const linked = await linkedReminderIdentifiers();
    checkAccount(input.scope, input.isCurrent, epoch);
    if (input.getLegacySnapshot && !uniqueLegacyReply(input))
      throw new CampusReminderError('invalid-source');
    if (linked.has(key.identifier)) throw new CampusReminderError('invalid-source');
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
  }
}

export async function adoptCampusReminderSnapshot(input: {
  scope: CampusReminderScope; snapshot?: CampusSenseSnapshot | null; isCurrent: () => boolean;
}) {
  const version = reminderEpoch;
  return serializeAssignmentReminderWork(() => adoptCampusReminderSnapshotInSequence(input, version));
}

async function adoptCampusReminderSnapshotInSequence(input: {
  scope: CampusReminderScope; snapshot?: CampusSenseSnapshot | null; isCurrent: () => boolean;
}, version: number) {
  checkAccount(input.scope, input.isCurrent, version);
  const snapshot = validCampusSenseSnapshot(input.snapshot, input.scope);
  if (!snapshot || snapshot.assignments.status !== 'available') return;
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
    if (campusAssignmentLegacyMatches(snapshot, item).length !== 1) continue;
    for (const leadMinutes of [60, 1440] as const) {
      const old = await reminderKey(input.scope, { ...item, title: normalizeTitle(item.title) }, leadMinutes);
      checkAccount(input.scope, input.isCurrent, version);
      if (!unresolved.has(old.identifier)) continue;
      if (!await matchesLegacyReceipt(await readRecord(old.storageKey), item)) continue;
      checkAccount(input.scope, input.isCurrent, version);
      await adoptSubmittedAssignmentReminderInSequence({ ...input, source, leadMinutes,
        cardIdentity: cardIdentity(item) }, {
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
  scope: CampusReminderScope; isCurrent: () => boolean; getSnapshot?: () => CampusSenseSnapshot | null;
}) {
  const version = reminderEpoch;
  return serializeAssignmentReminderWork(async () => {
    checkAccount(input.scope, input.isCurrent, version);
    if (input.getSnapshot) {
      await adoptCampusReminderSnapshotInSequence({ ...input, snapshot: input.getSnapshot() }, version);
    }
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
  });
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
