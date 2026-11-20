import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import type { DataSource } from '../data/source';
import type { Submission } from '../data/types';
import { parseCampusAssignmentSource, type CampusAssignmentSource } from './campusAssignmentSource';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';

const prefix = 'assignment-due.v2.';
const storagePrefix = '@assignment-due:v2:';
const preferenceLimit = 32;
const inactiveRecheckMs = 15 * 60_000;
const inactiveRetentionMs = 30 * 86_400_000;
const deadlineGraceMs = 7 * 86_400_000;
type Scope = { uid: string; schoolId: string };
type Preference = Scope &
  CampusAssignmentSource & {
    leadMinutes: 60 | 1440;
    identifier: string;
    submitted?: boolean;
    legacyIds?: string[];
    legacyKeys?: string[];
    expiresAt?: number;
    nextCheckAt?: number;
    failures?: number;
    checkedAt?: number;
    title?: string;
    lastDueAt?: number | null;
    triggerAt?: string | null;
  };
type Reader = Pick<DataSource, 'getAssignment' | 'getSubmission'>;
type Request = {
  scope: Scope;
  source: CampusAssignmentSource;
  leadMinutes: 60 | 1440;
  isCurrent: () => boolean;
};
let epoch = 0;
let stopping = false;
let work: Promise<unknown> = Promise.resolve();

class ReminderSyncError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = work.then(run, run);
  work = next.catch(() => undefined);
  return next;
}
function current(scope: Scope, guard: () => boolean, version: number) {
  if (
    stopping ||
    version !== epoch ||
    !guard() ||
    isFirebaseMockMode() ||
    getAuthInstance().currentUser?.uid !== scope.uid
  )
    throw new ReminderSyncError('session-changed');
}
function reader(): Reader {
  return (require('../data/firebaseSource') as typeof import('../data/firebaseSource'))
    .firebaseSource;
}
async function identity(input: Request): Promise<Preference> {
  const source = parseCampusAssignmentSource(input.source);
  if (!source || ![60, 1440].includes(input.leadMinutes))
    throw new ReminderSyncError('invalid-reminder-identity');
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      input.scope.uid,
      input.scope.schoolId,
      input.source.groupId,
      input.source.assignmentId,
      input.leadMinutes,
    ]),
  );
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new ReminderSyncError('invalid-reminder-identity');
  return { ...input.scope, ...source, leadMinutes: input.leadMinutes, identifier: prefix + digest };
}
function key(row: Preference) {
  return storagePrefix + row.identifier;
}
async function readPreference(storageKey: string): Promise<Preference | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as Preference;
    if (
      !row ||
      typeof row.uid !== 'string' ||
      !row.uid ||
      typeof row.schoolId !== 'string' ||
      !row.schoolId ||
      !parseCampusAssignmentSource(row) ||
      ![60, 1440].includes(row.leadMinutes) ||
      typeof row.identifier !== 'string' ||
      !row.identifier.startsWith(prefix)
    )
      return null;
    return row;
  } catch {
    return null;
  }
}
function instant(value: unknown): number | null {
  try {
    const raw =
      value && typeof value === 'object' && 'toDate' in value
        ? (value as { toDate: () => Date }).toDate()
        : value;
    return typeof raw === 'string' || typeof raw === 'number' || raw instanceof Date
      ? parseTaipeiInstant(raw)
      : null;
  } catch {
    return null;
  }
}
async function cancel(identifier: string) {
  await Notifications.cancelScheduledNotificationAsync(identifier);
  const remaining = await Notifications.getAllScheduledNotificationsAsync();
  if (remaining.some((row) => row.identifier === identifier))
    throw new ReminderSyncError('cancel-unconfirmed');
}

async function reconcile(row: Preference, guard: () => boolean, version: number, ds: Reader) {
  current(row, guard, version);
  // Both reads must reach the server; cached or pending submissions cannot cancel an alarm.
  const [assignment, receipt] = await Promise.all([
    ds.getAssignment(row.assignmentId, row.groupId),
    ds.getSubmission(row.assignmentId, row.uid, row.groupId),
  ]);
  current(row, guard, version);
  if (
    receipt &&
    (receipt.assignmentId !== row.assignmentId ||
      receipt.groupId !== row.groupId ||
      receipt.userId !== row.uid)
  )
    throw new ReminderSyncError('receipt-mismatch');
  if (assignment && (assignment.id !== row.assignmentId || assignment.groupId !== row.groupId))
    throw new ReminderSyncError('assignment-mismatch');
  if (
    receipt &&
    !['submitted', 'graded', 'late', 'missing', 'draft', 'withdrawn'].includes(receipt.status)
  )
    throw new ReminderSyncError('receipt-unconfirmed');
  if (
    receipt &&
    ['submitted', 'graded', 'late'].includes(receipt.status) &&
    (!receipt.id || instant(receipt.submittedAt) === null)
  )
    throw new ReminderSyncError('receipt-unconfirmed');
  const submitted = Boolean(
    receipt?.id &&
    instant(receipt.submittedAt) !== null &&
    ['submitted', 'graded', 'late'].includes(receipt.status),
  );
  const due = instant(assignment?.dueAt);
  const now = Date.now();
  let triggerAt = due === null ? null : due - row.leadMinutes * 60_000;
  if (triggerAt !== null && triggerAt <= now && due !== null && due > now + 1000) {
    const prior = row.lastDueAt === due && !row.submitted ? instant(row.triggerAt) : null;
    triggerAt =
      prior ?? (row.submitted || row.lastDueAt !== due ? Math.min(now + 60_000, due - 1000) : null);
  }
  const remember = async (stamp: string | null) => {
    current(row, guard, version);
    const updated = {
      ...row, title: assignment?.title ?? row.title, submitted, lastDueAt: due, triggerAt: stamp,
      failures: 0, checkedAt: now,
      expiresAt: submitted || stamp === null
        ? Math.min(row.expiresAt ?? Infinity, now + inactiveRetentionMs)
        : (due ?? now) + deadlineGraceMs,
      nextCheckAt: submitted || stamp === null ? now + inactiveRecheckMs : 0,
    };
    // Persist the replacement and recovery links before removing any old alarm.
    await AsyncStorage.setItem(key(row), JSON.stringify(updated));
    current(row, guard, version);
    for (const id of row.legacyIds ?? []) {
      await cancel(id);
      current(row, guard, version);
    }
    for (const oldKey of row.legacyKeys ?? []) await AsyncStorage.removeItem(oldKey);
    current(row, guard, version);
    if (row.legacyIds?.length || row.legacyKeys?.length)
      await AsyncStorage.setItem(key(row), JSON.stringify({ ...updated, legacyIds: [], legacyKeys: [] }));
    current(row, guard, version);
  };
  const inventory = await Notifications.getAllScheduledNotificationsAsync();
  current(row, guard, version);
  const existing = inventory.find((item) => item.identifier === row.identifier);
  const state = assignment as
    | (NonNullable<typeof assignment> & { published?: boolean; status?: string })
    | null;
  const disabled =
    !state ||
    state.published === false ||
    ['draft', 'closed', 'deleted', 'archived', 'retracted'].includes(String(state.status ?? ''));
  if (submitted || disabled || triggerAt === null || triggerAt <= now) {
    if (existing) await cancel(row.identifier);
    current(row, guard, version);
    await remember(null);
    return { outcome: submitted ? ('submitted' as const) : ('inactive' as const), triggerAt: '' };
  }
  const stamp = new Date(triggerAt).toISOString();
  if (existing?.content.data?.triggerAt === stamp) {
    await remember(stamp);
    return { outcome: 'already-scheduled' as const, triggerAt: stamp };
  }
  const replaced = inventory.filter((item) => row.legacyIds?.includes(item.identifier)).length;
  if (inventory.length - (existing ? 1 : 0) - replaced >= 32) throw new ReminderSyncError('device-capacity');
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new ReminderSyncError('permission-required');
  current(row, guard, version);
  // A durable intent keeps a confirmed alarm discoverable if final persistence fails.
  await AsyncStorage.setItem(key(row), JSON.stringify(row));
  current(row, guard, version);
  try {
    const id = await Notifications.scheduleNotificationAsync({
      identifier: row.identifier,
      content: {
        title: '校園作業提醒',
        body: '作業即將截止，點此查看作業。',
        sound: true,
        data: {
          type: 'local_assignment_due_v2',
          uid: row.uid,
          schoolId: row.schoolId,
          groupId: row.groupId,
          assignmentId: row.assignmentId,
          triggerAt: stamp,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(triggerAt),
        ...(Platform.OS === 'android' ? { channelId: 'assignment-reminders' } : {}),
      },
    });
    if (id !== row.identifier) throw new ReminderSyncError('schedule-unconfirmed');
    current(row, guard, version);
    const after = await Notifications.getAllScheduledNotificationsAsync();
    if (!after.some((item) => item.identifier === row.identifier && item.content.data?.triggerAt === stamp))
      throw new ReminderSyncError('schedule-unconfirmed');
    current(row, guard, version);
  } catch (error) {
    try {
      current(row, guard, version);
    } catch (sessionError) {
      await cancel(row.identifier);
      throw sessionError;
    }
    const oldStamp = existing?.content.data?.triggerAt;
    if (existing && typeof oldStamp === 'string' && instant(oldStamp) !== null) {
      const afterFailure = await Notifications.getAllScheduledNotificationsAsync();
      current(row, guard, version);
      if (!afterFailure.some((item) => item.identifier === row.identifier &&
          item.content.data?.triggerAt === oldStamp)) {
        await Notifications.scheduleNotificationAsync({
          identifier: row.identifier,
          content: existing.content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(oldStamp),
            ...(Platform.OS === 'android' ? { channelId: 'assignment-reminders' } : {}),
          },
        });
        try {
          current(row, guard, version);
        } catch (sessionError) {
          await cancel(row.identifier);
          throw sessionError;
        }
      }
    } else {
      await cancel(row.identifier);
    }
    throw error;
  }
  try {
    await remember(stamp);
  } catch (error) {
    try {
      current(row, guard, version);
    } catch (sessionError) {
      await cancel(row.identifier);
      throw sessionError;
    }
    throw error;
  }
  return { outcome: 'scheduled' as const, triggerAt: stamp };
}

export function scheduleSubmittedAssignmentReminder(input: Request, ds?: Reader) {
  const version = epoch;
  return serial(async () => {
    current(input.scope, input.isCurrent, version);
    if (!['ios', 'android'].includes(Platform.OS)) throw new ReminderSyncError('unsupported');
    const row = await identity(input);
    current(input.scope, input.isCurrent, version);
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain)
      permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) throw new ReminderSyncError('permission-required');
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('assignment-reminders', {
        name: '作業截止提醒',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const raw = await AsyncStorage.getItem(key(row));
    const saved = raw ? (JSON.parse(raw) as Preference) : row;
    const keys = (await AsyncStorage.getAllKeys()).filter((value) => value.startsWith(storagePrefix));
    if (!raw && keys.length >= preferenceLimit) throw new ReminderSyncError('device-capacity');
    const result = await reconcile({ ...saved, ...row }, input.isCurrent, version, ds ?? reader());
    current(row, input.isCurrent, version);
    return result;
  });
}

export function reconcileSubmittedAssignmentReminders(
  scope: Scope,
  guard: () => boolean,
  ds?: Reader,
) {
  const version = epoch;
  return serial(async () => {
    current(scope, guard, version);
    const keys = (await AsyncStorage.getAllKeys()).filter((value) =>
      value.startsWith(storagePrefix),
    );
    const reads = new Map<string, ReturnType<Reader['getAssignment']>>();
    const receipts = new Map<string, ReturnType<Reader['getSubmission']>>();
    const original = ds ?? reader();
    const shared: Reader = {
      getAssignment: (id, group) => {
        const k = JSON.stringify([group, id]);
        if (!reads.has(k)) reads.set(k, original.getAssignment(id, group));
        return reads.get(k)!;
      },
      getSubmission: (id, uid, group) => {
        const k = JSON.stringify([group, id, uid]);
        if (!receipts.has(k)) receipts.set(k, original.getSubmission(id, uid, group));
        return receipts.get(k)!;
      },
    };
    let checked = 0;
    const errors: unknown[] = [];
    const stored = await Promise.all(keys.map(async (storageKey) => ({
      storageKey, row: await readPreference(storageKey),
    })));
    stored.sort((a, b) => (a.row?.checkedAt ?? 0) - (b.row?.checkedAt ?? 0));
    for (const { storageKey, row } of stored) {
      current(scope, guard, version);
      if (!row) continue;
      if (row.uid !== scope.uid || row.schoolId !== scope.schoolId) continue;
      const expected = await identity({
        scope,
        source: row,
        leadMinutes: row.leadMinutes,
        isCurrent: guard,
      });
      if (
        key(expected) !== storageKey ||
        expected.identifier !== row.identifier ||
        ![60, 1440].includes(row.leadMinutes)
      )
        continue;
      const now = Date.now();
      if ((row.expiresAt !== undefined && row.expiresAt <= now) ||
          (row.lastDueAt != null && row.lastDueAt + deadlineGraceMs <= now)) {
        await cancel(row.identifier);
        for (const id of row.legacyIds ?? []) await cancel(id);
        for (const oldKey of row.legacyKeys ?? []) await AsyncStorage.removeItem(oldKey);
        current(scope, guard, version);
        await AsyncStorage.removeItem(storageKey);
        continue;
      }
      if ((row.nextCheckAt ?? 0) > now || checked >= preferenceLimit) continue;
      checked += 1;
      try {
        await reconcile(row, guard, version, shared);
      } catch (error) {
        current(scope, guard, version);
        const failures = (row.failures ?? 0) + 1;
        await AsyncStorage.setItem(storageKey, JSON.stringify({
          ...(await readPreference(storageKey) ?? row), failures, checkedAt: now, expiresAt: Math.min(row.expiresAt ?? Infinity, now + inactiveRetentionMs),
          nextCheckAt: now + Math.min(60, 2 ** Math.min(failures, 6)) * 60_000,
        }));
        errors.push(error);
      }
    }
    if (errors.length) throw errors[0];
  });
}

export async function submittedAssignmentReminderStatus(input: Omit<Request, 'leadMinutes'> & { scheduledOnly?: boolean }) {
  const version = epoch;
  const inventory = await Notifications.getAllScheduledNotificationsAsync();
  current(input.scope, input.isCurrent, version);
  const result: Array<60 | 1440> = [];
  for (const leadMinutes of [60, 1440] as const) {
    const row = await identity({ ...input, leadMinutes });
    current(input.scope, input.isCurrent, version);
    const saved = await readPreference(key(row));
    if ((!input.scheduledOnly && saved) || inventory.some((item) =>
      item.identifier === row.identifier || saved?.legacyIds?.includes(item.identifier)))
      result.push(leadMinutes);
  }
  return result;
}
export function cancelSubmittedAssignmentReminder(input: Request) {
  const version = epoch;
  return serial(async () => {
    const row = await identity(input);
    current(row, input.isCurrent, version);
    const saved = await readPreference(key(row));
    await cancel(row.identifier);
    for (const id of saved?.legacyIds ?? []) await cancel(id);
    for (const oldKey of saved?.legacyKeys ?? []) await AsyncStorage.removeItem(oldKey);
    current(row, input.isCurrent, version);
    await AsyncStorage.removeItem(key(row));
    return true;
  });
}
export function clearSubmittedAssignmentReminders(hold = false) {
  stopping = hold;
  epoch += 1;
  return serial(async () => {
    const inventory = ['ios', 'android'].includes(Platform.OS)
      ? await Notifications.getAllScheduledNotificationsAsync()
      : [];
    for (const row of inventory)
      if (row.identifier.startsWith(prefix)) await cancel(row.identifier);
    const keys = (await AsyncStorage.getAllKeys()).filter((value) =>
      value.startsWith(storagePrefix),
    );
    if (keys.length) await AsyncStorage.multiRemove(keys);
  });
}

export function resumeSubmittedAssignmentReminders() {
  epoch += 1;
  stopping = false;
}

/** The write path calls this only after its receipt has passed server verification. */
export function reconcileSubmittedAssignmentReceipt(receipt: Submission) {
  const version = epoch;
  return serial(async () => {
    if (
      !receipt.id ||
      !receipt.groupId ||
      !receipt.userId ||
      !receipt.assignmentId ||
      !['submitted', 'graded', 'late'].includes(receipt.status) ||
      instant(receipt.submittedAt) === null
    )
      throw new ReminderSyncError('receipt-unconfirmed');
    const keys = (await AsyncStorage.getAllKeys()).filter((value) =>
      value.startsWith(storagePrefix),
    );
    for (const storageKey of keys) {
      const row = await readPreference(storageKey);
      if (
        !row ||
        row.uid !== receipt.userId ||
        row.groupId !== receipt.groupId ||
        row.assignmentId !== receipt.assignmentId
      )
        continue;
      const guard = () => getAuthInstance().currentUser?.uid === receipt.userId;
      current(row, guard, version);
      const expected = await identity({
        scope: row,
        source: row,
        leadMinutes: row.leadMinutes,
        isCurrent: guard,
      });
      if (key(expected) !== storageKey || expected.identifier !== row.identifier) continue;
      await cancel(row.identifier);
      for (const id of row.legacyIds ?? []) await cancel(id);
      for (const oldKey of row.legacyKeys ?? []) await AsyncStorage.removeItem(oldKey);
      current(row, guard, version);
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ ...row, submitted: true, triggerAt: null, legacyIds: [], legacyKeys: [],
          expiresAt: Math.min(row.expiresAt ?? Infinity, Date.now() + inactiveRetentionMs),
          nextCheckAt: Date.now() + inactiveRecheckMs }),
      );
      current(row, guard, version);
    }
  });
}

export function adoptSubmittedAssignmentReminder(input: Request, old: { identifier: string; triggerAt: string; storageKey: string; title: string }) {
  const version = epoch;
  return serial(async () => {
    current(input.scope, input.isCurrent, version);
    const row = await identity(input);
    const inventory = await Notifications.getAllScheduledNotificationsAsync();
    current(row, input.isCurrent, version);
    if (!inventory.some((alarm) => alarm.identifier === old.identifier)) return;
    const saved = await readPreference(key(row));
    const legacyIds = [...new Set([...(saved?.legacyIds ?? []), old.identifier])];
    const legacyKeys = [...new Set([...(saved?.legacyKeys ?? []), old.storageKey])];
    current(row, input.isCurrent, version);
    await AsyncStorage.setItem(key(row), JSON.stringify({
      ...row, title: old.title, lastDueAt: Date.parse(old.triggerAt) + row.leadMinutes * 60_000,
      triggerAt: old.triggerAt, expiresAt: Date.now() + inactiveRetentionMs,
      ...saved, legacyIds, legacyKeys,
    }));
  });
}

export async function linkedReminderIdentifiers() {
  const ids = new Set<string>();
  for (const storageKey of await AsyncStorage.getAllKeys()) {
    if (!storageKey.startsWith(storagePrefix)) continue;
    const saved = await readPreference(storageKey);
    for (const id of saved?.legacyIds ?? []) ids.add(id);
  }
  return ids;
}

export async function savedAssignmentReminderPreferences(scope: Scope, guard: () => boolean) {
  const version = epoch;
  current(scope, guard, version);
  const inventory = await Notifications.getAllScheduledNotificationsAsync();
  const result: Array<Preference & { scheduled: boolean }> = [];
  for (const storageKey of await AsyncStorage.getAllKeys()) {
    if (!storageKey.startsWith(storagePrefix)) continue;
    const row = await readPreference(storageKey);
    if (!row || row.uid !== scope.uid || row.schoolId !== scope.schoolId) continue;
    const expected = await identity({ scope, source: row, leadMinutes: row.leadMinutes, isCurrent: guard });
    current(scope, guard, version);
    if (key(expected) !== storageKey || expected.identifier !== row.identifier) continue;
    result.push({ ...row, scheduled: inventory.some((alarm) =>
      alarm.identifier === row.identifier || row.legacyIds?.includes(alarm.identifier)) });
  }
  current(scope, guard, version);
  return result;
}
