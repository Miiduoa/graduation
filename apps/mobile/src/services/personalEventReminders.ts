import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { PersonalImportRecord } from '@campus/shared';
import { loadPersonalImports, type PersonalImportScope } from './personalImports';
import {
  PersonalEventReminderCleanupCorruptError,
  PersonalEventReminderJournalCorruptError,
  PersonalEventReminderRegistryCorruptError,
  enqueuePersonalEventReminderCleanup,
  forgetPersonalEventReminderOsIds,
  listRegisteredPersonalEventReminderOsIds,
  loadPersonalEventReminderCleanupPending,
  loadPersonalEventReminderJournal,
  mutatePersonalEventReminderJournal,
  rememberPersonalEventReminderOsIds,
  replacePersonalEventReminderCleanup,
} from './personalEventReminderJournal';
import {
  PERSONAL_EVENT_REMINDER_BODY,
  PERSONAL_EVENT_REMINDER_CHANNEL_ID,
  PERSONAL_EVENT_REMINDER_DEVICE_BUDGET,
  PERSONAL_EVENT_REMINDER_OS_PREFIX,
  PERSONAL_EVENT_REMINDER_TITLE,
  allDayPreference,
  buildPersonalEventReminderPayload,
  computePersonalEventReminderTrigger,
  createOpaqueToken,
  defaultOffPreference,
  isPersonalEventReminderOsId,
  isPersonalEventReminderPayload,
  osIdentifierForToken,
  personalEventReminderRevision,
  timedPreference,
  type PersonalEventReminderEntry,
  type PersonalEventReminderJournal,
  type PersonalEventReminderPendingCancel,
  type PersonalEventReminderPreference,
  type PersonalEventReminderStatus,
  type TimedLeadMinutes,
} from './personalEventReminderModel';
import {
  checkPushPermission,
  openNotificationSettings,
} from './notifications';
import {
  clearPersonalEventReminderRuntimeFailure,
  fencePersonalEventReminderRuntimeFailure,
  publishPersonalEventReminderRuntimeFailure,
  userFacingReminderFailureMessage,
} from './personalEventReminderRuntimeState';

export type PersonalReminderPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  status: Notifications.PermissionStatus | 'unsupported';
  unsupported: boolean;
};

/** Serialized worker for settings, cleanup, ledger transitions, and OS mutations. */
let workerChain: Promise<void> = Promise.resolve();

/** Synchronous scope fence — auth changes immediately invalidate in-flight work. */
let scopeEpoch = 0;
let latestScope: PersonalImportScope | null = null;

const CLEANUP_BLOCK_MESSAGE = '無法清除先前帳號的本機提醒，請稍後重試。';
const CLEANUP_CORRUPT_MESSAGE = '此裝置的提醒清除紀錄無法讀取，已保留原資料。';
const USER_SCHEDULE_ERROR = '無法排程本機提醒，請稍後重試。';
const USER_CANCEL_ERROR = '無法取消舊的本機提醒，將稍後重試。';

function sameScope(
  a: PersonalImportScope | null | undefined,
  b: PersonalImportScope | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  return !!a && !!b && a.owner === b.owner && a.schoolId === b.schoolId;
}

function noteLatestScope(scope: PersonalImportScope | null): number {
  if (!sameScope(latestScope, scope)) {
    scopeEpoch += 1;
    latestScope = scope ? { owner: scope.owner, schoolId: scope.schoolId } : null;
  }
  return scopeEpoch;
}

function scopeStillCurrent(scope: PersonalImportScope | null, epoch: number): boolean {
  return epoch === scopeEpoch && sameScope(latestScope, scope);
}

function enqueueWorker<T>(task: () => Promise<T>): Promise<T> {
  const run = workerChain.catch(() => undefined).then(task);
  workerChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readPersonalReminderPermission(): Promise<PersonalReminderPermissionState> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return {
      granted: false,
      canAskAgain: false,
      status: 'unsupported',
      unsupported: true,
    };
  }
  const permission = await checkPushPermission();
  return {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
    unsupported: false,
  };
}

/** Android: create the dedicated local channel before any permission prompt. No push token. */
export async function ensurePersonalReminderAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PERSONAL_EVENT_REMINDER_CHANNEL_ID, {
    name: '個人行程提醒（此裝置）',
    description: '僅此裝置的個人行程本機提醒，不含雲端推播',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Only call after an explicit user action. Reads silently are via readPersonalReminderPermission.
 * Never registers Expo push / FCM tokens or depends on network.
 */
export async function requestPersonalReminderPermissionExplicit(): Promise<PersonalReminderPermissionState> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return {
      granted: false,
      canAskAgain: false,
      status: 'unsupported',
      unsupported: true,
    };
  }
  await ensurePersonalReminderAndroidChannel();
  const current = await checkPushPermission();
  if (current.granted) {
    return {
      granted: true,
      canAskAgain: current.canAskAgain,
      status: current.status,
      unsupported: false,
    };
  }
  if (!current.canAskAgain) {
    return {
      granted: false,
      canAskAgain: false,
      status: current.status,
      unsupported: false,
    };
  }
  const requested = await Notifications.requestPermissionsAsync();
  return {
    granted: requested.status === 'granted',
    canAskAgain: requested.canAskAgain,
    status: requested.status,
    unsupported: false,
  };
}

export { openNotificationSettings as openPersonalReminderSettings };

async function cancelFeatureNotification(osIdentifier: string): Promise<void> {
  if (!isPersonalEventReminderOsId(osIdentifier)) return;
  await Notifications.cancelScheduledNotificationAsync(osIdentifier);
  try {
    await Notifications.dismissNotificationAsync(osIdentifier);
  } catch {
    /* Presented dismiss is best-effort and own-id only. */
  }
}

async function scheduleFeatureNotification(
  entry: PersonalEventReminderEntry,
  triggerAt: Date,
): Promise<void> {
  await ensurePersonalReminderAndroidChannel();
  const content: Notifications.NotificationContentInput = {
    title: PERSONAL_EVENT_REMINDER_TITLE,
    body: PERSONAL_EVENT_REMINDER_BODY,
    data: buildPersonalEventReminderPayload(entry),
    sound: true,
  };
  if (Platform.OS === 'android') {
    (content as { channelId?: string }).channelId = PERSONAL_EVENT_REMINDER_CHANNEL_ID;
  }
  await Notifications.scheduleNotificationAsync({
    identifier: entry.osIdentifier,
    content,
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      ...(Platform.OS === 'android' ? { channelId: PERSONAL_EVENT_REMINDER_CHANNEL_ID } : {}),
    },
  });
}

function cloneJournal(journal: PersonalEventReminderJournal): PersonalEventReminderJournal {
  return JSON.parse(JSON.stringify(journal)) as PersonalEventReminderJournal;
}

function queuePendingCancel(
  journal: PersonalEventReminderJournal,
  entry: Pick<
    PersonalEventReminderEntry,
    'osIdentifier' | 'lookupToken' | 'intentGeneration'
  >,
): PersonalEventReminderPendingCancel {
  const item: PersonalEventReminderPendingCancel = {
    osIdentifier: entry.osIdentifier,
    lookupToken: entry.lookupToken,
    intentGeneration: entry.intentGeneration,
    scopeOwner: journal.scope.owner,
    scopeSchoolId: journal.scope.schoolId,
  };
  if (
    !journal.pendingCancels.some(
      (row) =>
        row.osIdentifier === item.osIdentifier &&
        row.intentGeneration === item.intentGeneration,
    )
  ) {
    journal.pendingCancels.push(item);
  }
  return item;
}

type ScheduledFeatureRow = {
  identifier: string;
  lookupToken?: string;
  generation?: number;
  /** Absolute trigger ms when the OS reports one (e.g. Android DATE value). */
  absoluteTriggerAt?: number;
  /** True when OS returned a relative timeInterval shape (iOS DATE read-back). */
  relativeTrigger: boolean;
};

type ScheduledInventory = {
  all: Notifications.NotificationRequest[];
  feature: ScheduledFeatureRow[];
  otherCount: number;
};

/**
 * Parse installed Expo 0.32.16 native read-back shapes.
 * Android DATE → `{ type:'date', value:timestamp }`.
 * iOS DATE input becomes nonrepeating timeInterval → `{ seconds, repeats }` —
 * never derive an absolute time by adding seconds to Date.now().
 */
function parseNativeFeatureRow(row: Notifications.NotificationRequest): ScheduledFeatureRow {
  const data = row.content?.data;
  const payloadOk = isPersonalEventReminderPayload(data);
  const lookupToken = payloadOk ? data.t : undefined;
  const generation = payloadOk ? data.g : undefined;
  const trigger = row.trigger as {
    type?: string;
    date?: Date | number | string;
    value?: number;
    seconds?: number;
    repeats?: boolean;
  } | null;

  let absoluteTriggerAt: number | undefined;
  let relativeTrigger = false;
  if (trigger) {
    if (trigger.type === 'date' && typeof trigger.value === 'number' && Number.isFinite(trigger.value)) {
      absoluteTriggerAt = trigger.value;
    } else if (trigger.date != null) {
      const ms = new Date(trigger.date).getTime();
      if (Number.isFinite(ms)) absoluteTriggerAt = ms;
    } else if (
      trigger.type === 'timeInterval' ||
      (typeof trigger.seconds === 'number' && trigger.date == null && trigger.value == null)
    ) {
      // Installed iOS serializer — do not convert relative seconds into an absolute clock.
      relativeTrigger = true;
    }
  }
  return {
    identifier: row.identifier,
    lookupToken,
    generation,
    absoluteTriggerAt,
    relativeTrigger,
  };
}

async function listScheduledInventory(): Promise<ScheduledInventory> {
  let scheduled: Notifications.NotificationRequest[];
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    throw error instanceof Error ? error : new Error('無法讀取系統提醒清單。');
  }
  const feature = scheduled
    .filter((row) => isPersonalEventReminderOsId(row.identifier))
    .map(parseNativeFeatureRow);
  return {
    all: scheduled,
    feature,
    otherCount: scheduled.length - feature.length,
  };
}

async function listFeatureScheduled(): Promise<ScheduledFeatureRow[]> {
  return (await listScheduledInventory()).feature;
}

async function listFeatureScheduledIds(): Promise<string[]> {
  return (await listFeatureScheduled()).map((row) => row.identifier);
}

async function attemptCancelItems(
  items: PersonalEventReminderPendingCancel[],
  active: () => boolean,
): Promise<{ remaining: PersonalEventReminderPendingCancel[]; cancelError?: string }> {
  const remaining: PersonalEventReminderPendingCancel[] = [];
  let cancelError: string | undefined;
  for (const item of items) {
    if (!active()) {
      remaining.push(item);
      continue;
    }
    try {
      await cancelFeatureNotification(item.osIdentifier);
      await forgetPersonalEventReminderOsIds([item.osIdentifier]);
    } catch (error) {
      remaining.push(item);
      cancelError = USER_CANCEL_ERROR;
      void error;
    }
  }
  return { remaining, cancelError };
}

/**
 * Drain durable cross-scope cleanup. Returns false when unresolved work still blocks
 * new-identity native schedules. Corrupt cleanup never authorizes new schedules.
 */
async function drainGlobalCleanup(active: () => boolean): Promise<{
  settled: boolean;
  cancelError?: string;
}> {
  let pending: PersonalEventReminderPendingCancel[];
  try {
    pending = await loadPersonalEventReminderCleanupPending();
  } catch (error) {
    if (error instanceof PersonalEventReminderCleanupCorruptError) {
      return { settled: false, cancelError: CLEANUP_CORRUPT_MESSAGE };
    }
    throw error;
  }
  if (!pending.length) return { settled: true };
  const { remaining, cancelError } = await attemptCancelItems(pending, active);
  try {
    await replacePersonalEventReminderCleanup(remaining);
  } catch (error) {
    if (error instanceof PersonalEventReminderCleanupCorruptError) {
      return { settled: false, cancelError: CLEANUP_CORRUPT_MESSAGE };
    }
    throw error;
  }
  return { settled: remaining.length === 0, cancelError };
}

async function flushJournalPendingCancels(
  journal: PersonalEventReminderJournal,
  active: () => boolean,
): Promise<{ journal: PersonalEventReminderJournal; cancelError?: string }> {
  const next = cloneJournal(journal);
  const { remaining, cancelError } = await attemptCancelItems(next.pendingCancels, active);
  next.pendingCancels = remaining;
  return { journal: next, cancelError };
}

/**
 * Durably publish remaining cancel intents after a drain — including the empty
 * success receipt. Must complete before any replacement reuses a stable OS id.
 * Callers fail closed if this throws; durable retry state stays intact.
 */
async function publishPendingCancelDrainReceipt(
  scope: PersonalImportScope,
  active: () => boolean,
  remaining: PersonalEventReminderPendingCancel[],
  decorate?: (journal: PersonalEventReminderJournal) => void,
): Promise<void> {
  await mutatePersonalEventReminderJournal(scope, active, (current) => {
    const copy = cloneJournal(current);
    copy.pendingCancels = remaining.map((item) => ({ ...item }));
    decorate?.(copy);
    return { journal: copy, result: undefined };
  });
}

/**
 * Recognize a healthy unchanged OS request from durable owned intent identity.
 * Absolute OS clocks (Android) must match; relative iOS shapes rely on durable timing.
 */
function osMatchesDesired(
  live: ScheduledFeatureRow | undefined,
  entry: PersonalEventReminderEntry,
  triggerAt: Date,
): boolean {
  if (!live || live.identifier !== entry.osIdentifier) return false;
  if (live.lookupToken !== entry.lookupToken) return false;
  if (live.generation !== entry.intentGeneration) return false;
  const desiredMs = triggerAt.getTime();
  if (entry.scheduledTriggerAt != null && entry.scheduledTriggerAt !== desiredMs) return false;
  if (live.absoluteTriggerAt != null && live.absoluteTriggerAt !== desiredMs) return false;
  // Relative-only read-back: identity + durable intent timing already checked above.
  return true;
}

/**
 * Before any new-scope native schedule: cancel feature-namespace requests that are not
 * owned by the current journal. Empty global cleanup is NOT proof prior cleanup settled.
 */
async function clearForeignFeatureRequests(options: {
  scope: PersonalImportScope;
  ownedOsIds: Set<string>;
  active: () => boolean;
}): Promise<{ settled: boolean; cancelError?: string }> {
  let inventory: ScheduledInventory;
  try {
    inventory = await listScheduledInventory();
  } catch {
    return { settled: false, cancelError: '無法讀取系統提醒清單，請稍後重試。' };
  }
  if (!options.active()) return { settled: false };

  let registered: string[] = [];
  try {
    registered = await listRegisteredPersonalEventReminderOsIds();
  } catch (error) {
    if (error instanceof PersonalEventReminderRegistryCorruptError) {
      return { settled: false, cancelError: '此裝置的提醒系統登錄資料無法讀取，已保留原資料。' };
    }
    throw error;
  }
  if (!options.active()) return { settled: false };

  const foreignIds = [
    ...new Set([
      ...inventory.feature.map((row) => row.identifier),
      ...registered,
    ]),
  ].filter((id) => isPersonalEventReminderOsId(id) && !options.ownedOsIds.has(id));

  if (!foreignIds.length) return { settled: true };

  const failed: PersonalEventReminderPendingCancel[] = [];
  for (const osIdentifier of foreignIds) {
    const token = osIdentifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX)
      ? osIdentifier.slice(PERSONAL_EVENT_REMINDER_OS_PREFIX.length)
      : osIdentifier;
    if (!options.active()) {
      failed.push({
        osIdentifier,
        lookupToken: token || osIdentifier,
        intentGeneration: 0,
        scopeOwner: options.scope.owner,
        scopeSchoolId: options.scope.schoolId,
      });
      continue;
    }
    try {
      await cancelFeatureNotification(osIdentifier);
      await forgetPersonalEventReminderOsIds([osIdentifier]);
    } catch {
      failed.push({
        osIdentifier,
        lookupToken: token || osIdentifier,
        intentGeneration: 0,
        scopeOwner: options.scope.owner,
        scopeSchoolId: options.scope.schoolId,
      });
    }
  }

  if (failed.length) {
    try {
      await enqueuePersonalEventReminderCleanup(failed);
    } catch {
      return { settled: false, cancelError: CLEANUP_BLOCK_MESSAGE };
    }
    return { settled: false, cancelError: USER_CANCEL_ERROR };
  }
  return { settled: true };
}

function compareReminderCandidates(
  a: { eventId: string; triggerAt: number },
  b: { eventId: string; triggerAt: number },
): number {
  if (a.triggerAt !== b.triggerAt) return a.triggerAt - b.triggerAt;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

async function persistIntentBeforeOs(
  scope: PersonalImportScope,
  active: () => boolean,
  eventId: string,
  patch: (entry: PersonalEventReminderEntry) => void,
): Promise<PersonalEventReminderEntry | null> {
  return mutatePersonalEventReminderJournal(scope, active, (journal) => {
    const copy = cloneJournal(journal);
    const entry = copy.entries[eventId];
    if (!entry) return { journal: copy, result: null };
    patch(entry);
    entry.updatedAt = new Date().toISOString();
    copy.entries[eventId] = entry;
    return { journal: copy, result: entry };
  });
}

async function reconcileScopeJournal(
  scope: PersonalImportScope,
  active: () => boolean,
  now: Date,
  options: { allowSchedule: boolean } = { allowSchedule: true },
): Promise<void> {
  let globalCleanup: { settled: boolean; cancelError?: string };
  try {
    globalCleanup = await drainGlobalCleanup(active);
  } catch (error) {
    if (error instanceof PersonalEventReminderCleanupCorruptError) {
      globalCleanup = { settled: false, cancelError: CLEANUP_CORRUPT_MESSAGE };
    } else {
      throw error;
    }
  }
  if (!active()) return;

  let journal: PersonalEventReminderJournal;
  try {
    journal = await loadPersonalEventReminderJournal(scope);
  } catch (error) {
    if (error instanceof PersonalEventReminderJournalCorruptError) return;
    throw error;
  }
  if (!active()) return;

  const flushed = await flushJournalPendingCancels(journal, active);
  journal = flushed.journal;
  if (!active()) return;

  // Publish drain receipt (including empty success) before any replacement schedule.
  // Publication failure propagates to the scope-fenced worker/runtime boundary.
  await publishPendingCancelDrainReceipt(scope, active, journal.pendingCancels);
  if (!active()) return;

  // Foreign/orphan own-namespace requests must be cleaned BEFORE new schedules.
  const ownedOsIds = new Set(
    Object.values(journal.entries).map((entry) => entry.osIdentifier).filter(Boolean),
  );
  const foreignCleanup = await clearForeignFeatureRequests({
    scope,
    ownedOsIds,
    active,
  });
  if (!active()) return;

  const cleanupBlocksSchedule =
    !options.allowSchedule ||
    !globalCleanup.settled ||
    !foreignCleanup.settled ||
    !!flushed.cancelError ||
    journal.pendingCancels.length > 0;
  const cleanupBlockMessage =
    globalCleanup.cancelError ||
    foreignCleanup.cancelError ||
    CLEANUP_BLOCK_MESSAGE;

  let ledgerRecords: PersonalImportRecord[] = [];
  try {
    const ledger = await loadPersonalImports(scope);
    if (!active()) return;
    ledgerRecords = ledger.records;
  } catch {
    return;
  }

  const byId = new Map(ledgerRecords.map((row) => [row.id, row]));
  const permission = await readPersonalReminderPermission();
  if (!active()) return;

  let inventory: ScheduledInventory | null = null;
  let liveRows: ScheduledFeatureRow[] = [];
  let otherCount = 0;
  let enumerationError: string | undefined;
  try {
    inventory = await listScheduledInventory();
    liveRows = inventory.feature;
    otherCount = inventory.otherCount;
  } catch {
    enumerationError = '無法讀取系統提醒清單，請稍後重試。';
  }
  if (!active()) return;

  let registryBlocked = false;
  try {
    await listRegisteredPersonalEventReminderOsIds();
  } catch (error) {
    if (error instanceof PersonalEventReminderRegistryCorruptError) {
      registryBlocked = true;
    } else {
      throw error;
    }
  }
  if (!active()) return;

  const liveById = new Map(liveRows.map((row) => [row.identifier, row]));
  const budgetSlots = Math.max(0, PERSONAL_EVENT_REMINDER_DEVICE_BUDGET - otherCount);

  // Phase 1: persist revision/generation/cancel/desired intents BEFORE any OS mutation.
  const intentSnapshot = await mutatePersonalEventReminderJournal(scope, active, (current) => {
    const next = cloneJournal(current);
    next.pendingCancels = journal.pendingCancels;

    type Candidate = {
      eventId: string;
      triggerAt: number;
      matched: boolean;
    };
    const candidates: Candidate[] = [];

    for (const entry of Object.values(next.entries)) {
      if (!entry.preference.enabled) {
        if (entry.status !== 'off' || entry.scheduledTriggerAt != null) {
          queuePendingCancel(next, entry);
          entry.status = 'off';
          entry.lastError = undefined;
          entry.scheduledTriggerAt = undefined;
          entry.updatedAt = now.toISOString();
        }
        continue;
      }

      const row = byId.get(entry.eventId);
      if (!row || row.kind !== 'events') {
        queuePendingCancel(next, entry);
        entry.preference = defaultOffPreference();
        entry.status = 'off';
        entry.lastError = undefined;
        entry.scheduledTriggerAt = undefined;
        entry.updatedAt = now.toISOString();
        continue;
      }

      const revision = personalEventReminderRevision(row);
      if (revision !== entry.revision) {
        queuePendingCancel(next, {
          osIdentifier: entry.osIdentifier,
          lookupToken: entry.lookupToken,
          // Cancel the previous generation only — never a newer one sharing the same OS id.
          intentGeneration: entry.intentGeneration,
        });
        entry.intentGeneration += 1;
        entry.revision = revision;
        entry.status = 'pending';
        entry.lastError = undefined;
        entry.scheduledTriggerAt = undefined;
        entry.updatedAt = now.toISOString();
      }

      const trigger = computePersonalEventReminderTrigger(row, entry.preference, now);
      if (trigger.ok === false) {
        queuePendingCancel(next, entry);
        entry.status = trigger.reason === 'elapsed' ? 'elapsed' : 'error';
        entry.lastError =
          trigger.reason === 'elapsed' ? undefined : '提醒時間無效，請重新設定。';
        entry.scheduledTriggerAt = undefined;
        entry.updatedAt = now.toISOString();
        continue;
      }

      if (permission.unsupported) {
        entry.status = 'unsupported';
        entry.lastError = undefined;
        entry.updatedAt = now.toISOString();
        continue;
      }
      if (!permission.granted) {
        queuePendingCancel(next, entry);
        entry.status = 'permission_needed';
        entry.lastError = undefined;
        entry.scheduledTriggerAt = undefined;
        entry.updatedAt = now.toISOString();
        continue;
      }

      if (registryBlocked) {
        entry.status = 'error';
        entry.lastError = '此裝置的提醒系統登錄資料無法讀取，已保留原資料。';
        entry.updatedAt = now.toISOString();
        continue;
      }

      if (enumerationError) {
        entry.status = 'error';
        entry.lastError = enumerationError;
        entry.updatedAt = now.toISOString();
        continue;
      }

      const live = liveById.get(entry.osIdentifier);
      const probeEntry: PersonalEventReminderEntry = {
        ...entry,
        scheduledTriggerAt: trigger.triggerAt.getTime(),
      };
      const matchedLive = osMatchesDesired(live, probeEntry, trigger.triggerAt);

      if (cleanupBlocksSchedule) {
        // Block new native writes, but keep healthy already-on-OS rows as scheduled.
        if (matchedLive && entry.status === 'scheduled') {
          entry.scheduledTriggerAt = trigger.triggerAt.getTime();
          entry.lastError = undefined;
          entry.updatedAt = now.toISOString();
        } else if (matchedLive) {
          entry.status = 'scheduled';
          entry.scheduledTriggerAt = trigger.triggerAt.getTime();
          entry.lastError = undefined;
          entry.updatedAt = now.toISOString();
        } else {
          entry.status = 'error';
          entry.lastError = cleanupBlockMessage;
          entry.scheduledTriggerAt = undefined;
          entry.updatedAt = now.toISOString();
        }
        continue;
      }

      candidates.push({
        eventId: entry.eventId,
        triggerAt: trigger.triggerAt.getTime(),
        matched: matchedLive,
      });
    }

    candidates.sort(compareReminderCandidates);
    const selectedIds = new Set(
      candidates.slice(0, budgetSlots).map((row) => row.eventId),
    );

    for (const candidate of candidates) {
      const entry = next.entries[candidate.eventId];
      if (!entry) continue;
      if (!selectedIds.has(candidate.eventId)) {
        // Retain preference; show deferred/limit state. No native schedule.
        if (entry.status === 'scheduled' || entry.status === 'pending') {
          queuePendingCancel(next, entry);
        }
        entry.status = 'limit_deferred';
        entry.lastError = undefined;
        entry.scheduledTriggerAt = undefined;
        entry.updatedAt = now.toISOString();
        continue;
      }

      if (candidate.matched) {
        // Already matches durable intent — no native rewrite (incl. receipt-write recovery).
        if (
          entry.status !== 'scheduled' ||
          entry.scheduledTriggerAt !== candidate.triggerAt ||
          entry.lastError
        ) {
          entry.status = 'scheduled';
          entry.lastError = undefined;
          entry.scheduledTriggerAt = candidate.triggerAt;
          entry.updatedAt = now.toISOString();
        }
        continue;
      }

      entry.status = 'pending';
      entry.lastError = undefined;
      entry.scheduledTriggerAt = candidate.triggerAt;
      entry.updatedAt = now.toISOString();
    }

    return { journal: next, result: cloneJournal(next) };
  });

  if (!active() || !intentSnapshot) return;

  // Flush cancels queued by the intent phase before issuing new schedules.
  const afterIntentFlush = await flushJournalPendingCancels(intentSnapshot, active);
  if (!active()) return;
  const globalAfterIntent = await drainGlobalCleanup(active).catch((error) => {
    if (error instanceof PersonalEventReminderCleanupCorruptError) {
      return { settled: false as const, cancelError: CLEANUP_CORRUPT_MESSAGE };
    }
    throw error;
  });
  if (
    afterIntentFlush.cancelError ||
    afterIntentFlush.journal.pendingCancels.length ||
    !globalAfterIntent.settled
  ) {
    // Remaining intents stay durable; publication failure stays visible via worker boundary.
    await publishPendingCancelDrainReceipt(
      scope,
      active,
      afterIntentFlush.journal.pendingCancels,
      (copy) => {
        for (const entry of Object.values(copy.entries)) {
          if (entry.preference.enabled && entry.status === 'pending') {
            entry.status = 'error';
            entry.lastError = CLEANUP_BLOCK_MESSAGE;
            entry.scheduledTriggerAt = undefined;
            entry.updatedAt = now.toISOString();
          }
        }
      },
    );
    return;
  }

  // Successful drain — publish empty receipt before replacement on the stable OS id.
  // Publication failure propagates; do not schedule until the clear receipt is durable.
  await publishPendingCancelDrainReceipt(
    scope,
    active,
    afterIntentFlush.journal.pendingCancels,
  );
  if (!active()) return;

  // Re-check foreign barrier after intent cancels — still blocks new schedules.
  const ownedAfterIntent = new Set(
    Object.values(afterIntentFlush.journal.entries)
      .map((entry) => entry.osIdentifier)
      .filter(Boolean),
  );
  const foreignAfterIntent = await clearForeignFeatureRequests({
    scope,
    ownedOsIds: ownedAfterIntent,
    active,
  });
  if (!active()) return;
  if (!foreignAfterIntent.settled) {
    await mutatePersonalEventReminderJournal(scope, active, (current) => {
      const copy = cloneJournal(current);
      for (const entry of Object.values(copy.entries)) {
        if (entry.preference.enabled && entry.status === 'pending') {
          entry.status = 'error';
          entry.lastError = foreignAfterIntent.cancelError || CLEANUP_BLOCK_MESSAGE;
          entry.scheduledTriggerAt = undefined;
          entry.updatedAt = now.toISOString();
        }
      }
      return { journal: copy, result: undefined };
    });
    return;
  }

  const selectedPending = Object.values(afterIntentFlush.journal.entries)
    .filter(
      (entry) =>
        entry.preference.enabled &&
        entry.status === 'pending' &&
        entry.scheduledTriggerAt != null,
    )
    .sort((a, b) =>
      compareReminderCandidates(
        { eventId: a.eventId, triggerAt: a.scheduledTriggerAt! },
        { eventId: b.eventId, triggerAt: b.scheduledTriggerAt! },
      ),
    );

  // Phase 2: native schedule only for durable pending intents; re-read before publish.
  for (const entry of selectedPending) {
    if (!active()) return;

    const triggerAt = new Date(entry.scheduledTriggerAt!);
    try {
      await rememberPersonalEventReminderOsIds([entry.osIdentifier]);
      if (!active()) {
        // Scope invalidated after registry write — cancel this exact own ID.
        try {
          await cancelFeatureNotification(entry.osIdentifier);
          await forgetPersonalEventReminderOsIds([entry.osIdentifier]);
        } catch {
          await enqueuePersonalEventReminderCleanup([
            {
              osIdentifier: entry.osIdentifier,
              lookupToken: entry.lookupToken,
              intentGeneration: entry.intentGeneration,
              scopeOwner: scope.owner,
              scopeSchoolId: scope.schoolId,
            },
          ]);
        }
        return;
      }

      // Recheck durable ledger/journal after awaits — do not publish a stale clone.
      const latestJournal = await loadPersonalEventReminderJournal(scope);
      if (!active()) return;
      const latestEntry = latestJournal.entries[entry.eventId];
      if (
        !latestEntry ||
        !latestEntry.preference.enabled ||
        latestEntry.intentGeneration !== entry.intentGeneration ||
        latestEntry.revision !== entry.revision ||
        latestEntry.osIdentifier !== entry.osIdentifier ||
        latestEntry.status === 'limit_deferred'
      ) {
        try {
          await cancelFeatureNotification(entry.osIdentifier);
        } catch {
          await enqueuePersonalEventReminderCleanup([
            {
              osIdentifier: entry.osIdentifier,
              lookupToken: entry.lookupToken,
              intentGeneration: entry.intentGeneration,
              scopeOwner: scope.owner,
              scopeSchoolId: scope.schoolId,
            },
          ]);
        }
        continue;
      }

      const liveBefore = (await listFeatureScheduled()).find(
        (row) => row.identifier === entry.osIdentifier,
      );
      if (osMatchesDesired(liveBefore, latestEntry, triggerAt)) {
        await persistIntentBeforeOs(scope, active, entry.eventId, (row) => {
          if (row.intentGeneration !== entry.intentGeneration) return;
          row.status = 'scheduled';
          row.lastError = undefined;
          row.scheduledTriggerAt = triggerAt.getTime();
        });
        continue;
      }

      await scheduleFeatureNotification(entry, triggerAt);
      if (!active()) {
        try {
          await cancelFeatureNotification(entry.osIdentifier);
          await forgetPersonalEventReminderOsIds([entry.osIdentifier]);
        } catch {
          await enqueuePersonalEventReminderCleanup([
            {
              osIdentifier: entry.osIdentifier,
              lookupToken: entry.lookupToken,
              intentGeneration: entry.intentGeneration,
              scopeOwner: scope.owner,
              scopeSchoolId: scope.schoolId,
            },
          ]);
        }
        return;
      }

      // Receipt publication: recover via enumeration + known ID if this write fails later.
      let stillThere = false;
      try {
        stillThere = (await listFeatureScheduledIds()).includes(entry.osIdentifier);
      } catch {
        // Enumeration error is not an empty success — keep pending/error.
        await persistIntentBeforeOs(scope, active, entry.eventId, (row) => {
          if (row.intentGeneration !== entry.intentGeneration) return;
          row.status = 'error';
          row.lastError = '無法確認系統提醒，請重試。';
        });
        continue;
      }

      await persistIntentBeforeOs(scope, active, entry.eventId, (row) => {
        if (row.intentGeneration !== entry.intentGeneration) return;
        if (!stillThere) {
          row.status = 'error';
          row.lastError = '系統未保留此提醒，請重試。';
          row.scheduledTriggerAt = undefined;
        } else {
          row.status = 'scheduled';
          row.lastError = undefined;
          row.scheduledTriggerAt = triggerAt.getTime();
        }
      });
    } catch {
      await persistIntentBeforeOs(scope, active, entry.eventId, (row) => {
        if (row.intentGeneration !== entry.intentGeneration) return;
        row.status = 'error';
        row.lastError = USER_SCHEDULE_ERROR;
        row.scheduledTriggerAt = undefined;
      }).catch(() => undefined);
    }
  }

  if (!active()) return;

  // Complete selected-set verification — revoke false scheduled receipts for missing IDs.
  let liveAfterVerify: ScheduledFeatureRow[] = [];
  try {
    liveAfterVerify = await listFeatureScheduled();
  } catch {
    await mutatePersonalEventReminderJournal(scope, active, (current) => {
      const copy = cloneJournal(current);
      for (const entry of Object.values(copy.entries)) {
        if (entry.preference.enabled && entry.status === 'scheduled') {
          entry.status = 'error';
          entry.lastError = '無法確認系統提醒，請重試。';
          entry.updatedAt = now.toISOString();
        }
      }
      return { journal: copy, result: undefined };
    }).catch(() => undefined);
    return;
  }
  if (!active()) return;

  const liveAfterIds = new Set(liveAfterVerify.map((row) => row.identifier));
  const verifyJournal = await loadPersonalEventReminderJournal(scope);
  if (!active()) return;
  const selectedDesiredIds = new Set(
    Object.values(verifyJournal.entries)
      .filter(
        (entry) =>
          entry.preference.enabled &&
          (entry.status === 'scheduled' || entry.status === 'pending') &&
          entry.scheduledTriggerAt != null,
      )
      .map((entry) => entry.osIdentifier),
  );

  await mutatePersonalEventReminderJournal(scope, active, (current) => {
    const copy = cloneJournal(current);
    let changed = false;
    for (const entry of Object.values(copy.entries)) {
      if (!entry.preference.enabled) continue;
      if (entry.status !== 'scheduled' && entry.status !== 'pending') continue;
      if (!selectedDesiredIds.has(entry.osIdentifier)) continue;
      if (liveAfterIds.has(entry.osIdentifier)) continue;
      entry.status = 'error';
      entry.lastError = '系統未保留此提醒，請重試。';
      entry.scheduledTriggerAt = undefined;
      entry.updatedAt = now.toISOString();
      changed = true;
    }
    return { journal: copy, result: changed };
  });
  if (!active()) return;

  // Orphans: feature-namespaced OS requests not desired by current durable intents.
  let liveAfter: ScheduledFeatureRow[] = [];
  try {
    liveAfter = await listFeatureScheduled();
  } catch {
    return;
  }
  if (!active()) return;

  let registeredAfter: string[] = [];
  try {
    registeredAfter = await listRegisteredPersonalEventReminderOsIds();
  } catch (error) {
    if (error instanceof PersonalEventReminderRegistryCorruptError) return;
    throw error;
  }

  const freshJournal = await loadPersonalEventReminderJournal(scope);
  if (!active()) return;
  const liveDesired = new Set(
    Object.values(freshJournal.entries)
      .filter(
        (entry) =>
          entry.preference.enabled &&
          (entry.status === 'scheduled' || entry.status === 'pending'),
      )
      .map((entry) => entry.osIdentifier),
  );

  const orphanIds = new Set<string>([
    ...liveAfter.map((row) => row.identifier).filter((id) => !liveDesired.has(id)),
    ...registeredAfter.filter((id) => !liveDesired.has(id)),
  ]);

  const orphanCancels: PersonalEventReminderPendingCancel[] = [];
  for (const osIdentifier of orphanIds) {
    if (!active()) break;
    const token = osIdentifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX)
      ? osIdentifier.slice(PERSONAL_EVENT_REMINDER_OS_PREFIX.length)
      : osIdentifier;
    try {
      await cancelFeatureNotification(osIdentifier);
      await forgetPersonalEventReminderOsIds([osIdentifier]);
    } catch {
      orphanCancels.push({
        osIdentifier,
        lookupToken: token || osIdentifier,
        intentGeneration: 0,
        scopeOwner: scope.owner,
        scopeSchoolId: scope.schoolId,
      });
    }
  }
  if (orphanCancels.length) {
    try {
      await enqueuePersonalEventReminderCleanup(orphanCancels);
    } catch {
      /* Barrier will keep blocking until durable cleanup can be recorded. */
    }
    await mutatePersonalEventReminderJournal(scope, active, (current) => {
      const copy = cloneJournal(current);
      for (const item of orphanCancels) {
        queuePendingCancel(copy, item);
      }
      return { journal: copy, result: undefined };
    }).catch(() => undefined);
  }
}

/**
 * Cancel feature-namespace leftovers when auth is unresolved (previous scope may be null).
 */
async function cleanupFeatureNamespaceWhileUnresolved(active: () => boolean): Promise<void> {
  await drainGlobalCleanup(active);
  if (!active()) return;

  let registered: string[] = [];
  try {
    registered = await listRegisteredPersonalEventReminderOsIds();
  } catch (error) {
    if (error instanceof PersonalEventReminderRegistryCorruptError) return;
    throw error;
  }

  let liveIds: string[] = [];
  try {
    liveIds = await listFeatureScheduledIds();
  } catch {
    return;
  }
  if (!active()) return;

  const targets = [...new Set([...registered, ...liveIds])];
  const failed: PersonalEventReminderPendingCancel[] = [];
  for (const osIdentifier of targets) {
    if (!active()) break;
    const token = osIdentifier.startsWith('per-evtrem.')
      ? osIdentifier.slice('per-evtrem.'.length)
      : osIdentifier;
    try {
      await cancelFeatureNotification(osIdentifier);
      await forgetPersonalEventReminderOsIds([osIdentifier]);
    } catch {
      failed.push({
        osIdentifier,
        lookupToken: token || osIdentifier,
        intentGeneration: 0,
        scopeOwner: 'unresolved',
        scopeSchoolId: 'unresolved',
      });
    }
  }
  if (failed.length) await enqueuePersonalEventReminderCleanup(failed);
}

/**
 * Serialized reconciliation. Late results must not overwrite a newer preference or scope.
 */
export function reconcilePersonalEventReminders(
  scope: PersonalImportScope | null,
  options: { active?: () => boolean; now?: Date } = {},
): Promise<void> {
  const epoch = noteLatestScope(scope);
  const now = options.now ?? new Date();
  fencePersonalEventReminderRuntimeFailure(scope);
  return enqueueWorker(async () => {
    const active = () =>
      scopeStillCurrent(scope, epoch) && (options.active ? options.active() : true);
    try {
      if (!active()) return;
      if (!scope) {
        await cleanupFeatureNamespaceWhileUnresolved(active);
        return;
      }
      await reconcileScopeJournal(scope, active, now, { allowSchedule: true });
      if (active()) clearPersonalEventReminderRuntimeFailure(scope);
    } catch (error) {
      if (active() && scope) {
        publishPersonalEventReminderRuntimeFailure(
          scope,
          userFacingReminderFailureMessage(error),
        );
      }
      throw error;
    }
  });
}

/**
 * When scope becomes unresolved or switches, invalidate old work synchronously,
 * persist cancellation intents first, and block new schedules until cleanup settles.
 */
export async function invalidatePersonalEventRemindersForScopeChange(
  previous: PersonalImportScope | null,
  next: PersonalImportScope | null,
): Promise<void> {
  // Synchronously drop prior scope error publication before any async work.
  fencePersonalEventReminderRuntimeFailure(next);
  const epoch = noteLatestScope(next);
  return enqueueWorker(async () => {
    let cleanupRecorded = true;
    if (previous && !sameScope(previous, next)) {
      const activePrevious = () => true;
      try {
        const cancelItems = await mutatePersonalEventReminderJournal(
          previous,
          activePrevious,
          (journal) => {
            const copy = cloneJournal(journal);
            const queued: PersonalEventReminderPendingCancel[] = [];
            for (const entry of Object.values(copy.entries)) {
              if (
                entry.preference.enabled ||
                entry.status === 'scheduled' ||
                entry.status === 'pending' ||
                entry.status === 'error' ||
                entry.status === 'limit_deferred'
              ) {
                queued.push(queuePendingCancel(copy, entry));
              }
            }
            for (const item of copy.pendingCancels) {
              if (
                !queued.some(
                  (row) =>
                    row.osIdentifier === item.osIdentifier &&
                    row.intentGeneration === item.intentGeneration,
                )
              ) {
                queued.push(item);
              }
            }
            return { journal: copy, result: queued };
          },
        );
        // Durable cancel intent is recorded before any OS cancel attempt.
        try {
          await enqueuePersonalEventReminderCleanup(cancelItems);
        } catch {
          cleanupRecorded = false;
        }
        if (cleanupRecorded) {
          try {
            const pending = await loadPersonalEventReminderCleanupPending();
            const flushed = await attemptCancelItems(pending, activePrevious);
            await replacePersonalEventReminderCleanup(flushed.remaining);
            await mutatePersonalEventReminderJournal(previous, activePrevious, (journal) => {
              const copy = cloneJournal(journal);
              copy.pendingCancels = flushed.remaining.filter(
                (row) =>
                  row.scopeOwner === previous.owner && row.scopeSchoolId === previous.schoolId,
              );
              return { journal: copy, result: undefined };
            }).catch(() => undefined);
          } catch {
            cleanupRecorded = false;
          }
        }
      } catch (error) {
        cleanupRecorded = false;
        if (error instanceof PersonalEventReminderJournalCorruptError) {
          /* Corrupt previous journal still must not authorize new-scope schedules. */
        }
      }
    } else if (!previous && !next) {
      await cleanupFeatureNamespaceWhileUnresolved(() => scopeEpoch === epoch);
    }

    if (!scopeStillCurrent(next, epoch)) return;
    if (!next) {
      await cleanupFeatureNamespaceWhileUnresolved(() => scopeStillCurrent(next, epoch));
      return;
    }

    let cleanupSettled = cleanupRecorded;
    try {
      const cleanup = await drainGlobalCleanup(() => scopeStillCurrent(next, epoch));
      cleanupSettled = cleanupRecorded && cleanup.settled;
    } catch (error) {
      cleanupSettled = false;
      if (!(error instanceof PersonalEventReminderCleanupCorruptError)) throw error;
    }
    if (!scopeStillCurrent(next, epoch)) return;
    try {
      await reconcileScopeJournal(
        next,
        () => scopeStillCurrent(next, epoch),
        new Date(),
        { allowSchedule: cleanupSettled },
      );
      if (scopeStillCurrent(next, epoch)) clearPersonalEventReminderRuntimeFailure(next);
    } catch (error) {
      if (scopeStillCurrent(next, epoch)) {
        publishPersonalEventReminderRuntimeFailure(
          next,
          userFacingReminderFailureMessage(error),
        );
      }
      throw error;
    }
  });
}

export async function getPersonalEventReminderEntry(
  scope: PersonalImportScope,
  eventId: string,
): Promise<PersonalEventReminderEntry | null> {
  try {
    const journal = await loadPersonalEventReminderJournal(scope);
    return journal.entries[eventId] ?? null;
  } catch (error) {
    if (error instanceof PersonalEventReminderJournalCorruptError) {
      return {
        eventId,
        revision: '',
        preference: defaultOffPreference(),
        lookupToken: '',
        osIdentifier: '',
        intentGeneration: 0,
        status: 'corrupt_blocked',
        updatedAt: new Date().toISOString(),
        lastError: error.message,
      };
    }
    throw error;
  }
}

export async function listPersonalEventReminderEntries(
  scope: PersonalImportScope,
): Promise<Record<string, PersonalEventReminderEntry>> {
  try {
    return (await loadPersonalEventReminderJournal(scope)).entries;
  } catch (error) {
    if (error instanceof PersonalEventReminderJournalCorruptError) {
      throw error;
    }
    throw error;
  }
}

export async function hasUnresolvedPersonalEventReminderCleanup(): Promise<boolean> {
  const pending = await loadPersonalEventReminderCleanupPending();
  return pending.length > 0;
}

type SetReminderResult = {
  entry: PersonalEventReminderEntry;
  eventSavedIndependent: true;
  permission: PersonalReminderPermissionState;
};

/**
 * Durably record desired preference BEFORE reporting status. Event ledger writes stay separate.
 */
export async function setPersonalEventReminder(options: {
  scope: PersonalImportScope;
  record: PersonalImportRecord;
  preference: PersonalEventReminderPreference;
  active?: () => boolean;
  requestPermission?: boolean;
  now?: Date;
}): Promise<SetReminderResult> {
  const callerActive = options.active ?? (() => true);
  const now = options.now ?? new Date();
  if (options.record.kind !== 'events') throw new Error('只有個人行程可以設定提醒。');
  if (options.record.schoolId !== options.scope.schoolId) throw new Error('資料範圍不符。');

  const revision = personalEventReminderRevision(options.record);
  let permission = await readPersonalReminderPermission();
  if (!callerActive()) throw new Error('帳號或學校已切換，請稍後再試。');

  if (
    options.preference.enabled &&
    options.requestPermission &&
    !permission.granted &&
    !permission.unsupported
  ) {
    permission = await requestPersonalReminderPermissionExplicit();
    if (!callerActive()) throw new Error('帳號或學校已切換，請稍後再試。');
  }

  const epoch = noteLatestScope(options.scope);
  const active = () => scopeStillCurrent(options.scope, epoch) && callerActive();

  const entry = await enqueueWorker(async () => {
    if (!active()) throw new Error('帳號或學校已切換，請稍後再試。');

    const cleanup = await drainGlobalCleanup(active);
    if (!active()) throw new Error('帳號或學校已切換，請稍後再試。');

    const nextEntry = await mutatePersonalEventReminderJournal(
      options.scope,
      active,
      async (journal) => {
        const copy = cloneJournal(journal);
        const existing = copy.entries[options.record.id];
        if (existing?.preference.enabled && !options.preference.enabled) {
          queuePendingCancel(copy, existing);
        } else if (
          existing &&
          (existing.revision !== revision ||
            JSON.stringify(existing.preference) !== JSON.stringify(options.preference))
        ) {
          queuePendingCancel(copy, existing);
        }

        const lookupToken = existing?.lookupToken || createOpaqueToken();
        const osIdentifier = existing?.osIdentifier || osIdentifierForToken(lookupToken);
        await rememberPersonalEventReminderOsIds([osIdentifier]);

        let status: PersonalEventReminderStatus = 'off';
        let lastError: string | undefined;
        let scheduledTriggerAt: number | undefined;
        if (!options.preference.enabled) {
          status = 'off';
        } else if (permission.unsupported) {
          status = 'unsupported';
        } else if (!permission.granted) {
          status = 'permission_needed';
        } else if (!cleanup.settled) {
          status = 'error';
          lastError = cleanup.cancelError || CLEANUP_BLOCK_MESSAGE;
        } else {
          const trigger = computePersonalEventReminderTrigger(
            options.record,
            options.preference,
            now,
          );
          if (trigger.ok === false) {
            status = trigger.reason === 'elapsed' ? 'elapsed' : 'error';
            lastError = trigger.reason === 'elapsed' ? undefined : '提醒時間無效。';
          } else {
            status = 'pending';
            scheduledTriggerAt = trigger.triggerAt.getTime();
          }
        }

        const built: PersonalEventReminderEntry = {
          eventId: options.record.id,
          revision,
          preference: options.preference,
          lookupToken,
          osIdentifier,
          intentGeneration: (existing?.intentGeneration ?? 0) + 1,
          status,
          lastError,
          scheduledTriggerAt,
          updatedAt: now.toISOString(),
        };
        copy.entries[options.record.id] = built;
        return { journal: copy, result: built };
      },
    );

    // Intent is durable. Reconcile may cancel/disable this row while preserving other
    // already-enabled schedules. Only unresolved foreign cleanup blocks new schedules.
    await reconcileScopeJournal(options.scope, active, now, {
      allowSchedule: cleanup.settled,
    });
    return (await getPersonalEventReminderEntry(options.scope, options.record.id)) || nextEntry;
  });

  return { entry, eventSavedIndependent: true, permission };
}

export async function enableTimedPersonalEventReminder(
  scope: PersonalImportScope,
  record: PersonalImportRecord,
  leadMinutes: TimedLeadMinutes,
  active?: () => boolean,
) {
  return setPersonalEventReminder({
    scope,
    record,
    preference: timedPreference(leadMinutes),
    active,
    requestPermission: true,
  });
}

export async function enableAllDayPersonalEventReminder(
  scope: PersonalImportScope,
  record: PersonalImportRecord,
  active?: () => boolean,
) {
  return setPersonalEventReminder({
    scope,
    record,
    preference: allDayPreference(),
    active,
    requestPermission: true,
  });
}

export async function disablePersonalEventReminder(
  scope: PersonalImportScope,
  record: PersonalImportRecord,
  active?: () => boolean,
) {
  return setPersonalEventReminder({
    scope,
    record,
    preference: defaultOffPreference(),
    active,
    requestPermission: false,
  });
}

export async function retryPersonalEventReminder(
  scope: PersonalImportScope,
  record: PersonalImportRecord,
  active?: () => boolean,
) {
  const existing = await getPersonalEventReminderEntry(scope, record.id);
  if (!existing?.preference.enabled) {
    throw new Error('此行程尚未啟用提醒。');
  }
  return setPersonalEventReminder({
    scope,
    record,
    preference: existing.preference,
    active,
    requestPermission: true,
  });
}

/**
 * Validate a notification tap against the current ledger + journal.
 * Rejects deleted / disabled / edited / owner-school-mismatched items.
 */
export async function resolvePersonalEventReminderTap(
  payload: unknown,
  scope: PersonalImportScope | null,
): Promise<
  | { ok: true; eventId: string; record: PersonalImportRecord }
  | { ok: false; reason: string }
> {
  if (!isPersonalEventReminderPayload(payload)) return { ok: false, reason: 'not_personal_reminder' };
  if (!scope) return { ok: false, reason: 'scope_unresolved' };
  let journal: PersonalEventReminderJournal;
  try {
    journal = await loadPersonalEventReminderJournal(scope);
  } catch {
    return { ok: false, reason: 'journal_unavailable' };
  }
  const entry = Object.values(journal.entries).find((row) => row.lookupToken === payload.t);
  if (!entry) return { ok: false, reason: 'unknown_token' };
  if (entry.intentGeneration !== payload.g) return { ok: false, reason: 'stale_generation' };
  if (!entry.preference.enabled) return { ok: false, reason: 'disabled' };
  let record: PersonalImportRecord | undefined;
  try {
    const ledger = await loadPersonalImports(scope);
    record = ledger.records.find((row) => row.id === entry.eventId);
  } catch {
    return { ok: false, reason: 'ledger_unavailable' };
  }
  if (!record || record.kind !== 'events') return { ok: false, reason: 'missing_event' };
  if (record.schoolId !== scope.schoolId) return { ok: false, reason: 'school_mismatch' };
  if (personalEventReminderRevision(record) !== entry.revision)
    return { ok: false, reason: 'revision_mismatch' };
  return { ok: true, eventId: record.id, record };
}

/** Test helper — reset worker fence between isolated cases. */
export function __resetPersonalEventReminderWorkerForTests() {
  workerChain = Promise.resolve();
  scopeEpoch += 1;
  latestScope = null;
  clearPersonalEventReminderRuntimeFailure();
}
