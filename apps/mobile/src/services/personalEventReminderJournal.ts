import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportScope } from './personalImports';
import {
  ALL_DAY_REMINDER_HOUR,
  ALL_DAY_REMINDER_MINUTE,
  PERSONAL_EVENT_REMINDER_CLEANUP_KEY,
  PERSONAL_EVENT_REMINDER_JOURNAL_VERSION,
  PERSONAL_EVENT_REMINDER_OS_PREFIX,
  PERSONAL_EVENT_REMINDER_REGISTRY_CORRUPT_KEY,
  PERSONAL_EVENT_REMINDER_REGISTRY_KEY,
  TIMED_LEAD_OPTIONS,
  emptyReminderJournal,
  personalEventReminderCorruptKey,
  personalEventReminderJournalKey,
  type PersonalEventReminderCleanupStore,
  type PersonalEventReminderEntry,
  type PersonalEventReminderJournal,
  type PersonalEventReminderOsRegistry,
  type PersonalEventReminderPendingCancel,
  type PersonalEventReminderPreference,
  type PersonalEventReminderStatus,
  type TimedLeadMinutes,
} from './personalEventReminderModel';

export class PersonalEventReminderJournalCorruptError extends Error {
  readonly scope: PersonalImportScope;
  constructor(scope: PersonalImportScope) {
    super('此裝置的個人行程提醒設定無法讀取，已保留原資料。');
    this.name = 'PersonalEventReminderJournalCorruptError';
    this.scope = scope;
  }
}

export class PersonalEventReminderRegistryCorruptError extends Error {
  constructor() {
    super('此裝置的提醒系統登錄資料無法讀取，已保留原資料。');
    this.name = 'PersonalEventReminderRegistryCorruptError';
  }
}

export class PersonalEventReminderCleanupCorruptError extends Error {
  constructor() {
    super('此裝置的提醒清除紀錄無法讀取，已保留原資料。');
    this.name = 'PersonalEventReminderCleanupCorruptError';
  }
}

const journalLocks = new Map<string, Promise<unknown>>();
const registryLock = { current: Promise.resolve() as Promise<unknown> };
const cleanupLock = { current: Promise.resolve() as Promise<unknown> };

type JournalListener = (scope: PersonalImportScope) => void;
const journalListeners = new Set<JournalListener>();

export function subscribePersonalEventReminderJournal(listener: JournalListener) {
  journalListeners.add(listener);
  return () => {
    journalListeners.delete(listener);
  };
}

function notifyJournal(scope: PersonalImportScope) {
  for (const listener of journalListeners) {
    try {
      listener(scope);
    } catch {
      /* A view cannot invalidate a durable write. */
    }
  }
}

function isTimedLead(value: unknown): value is TimedLeadMinutes {
  return typeof value === 'number' && (TIMED_LEAD_OPTIONS as readonly number[]).includes(value);
}

function parsePreference(value: unknown): PersonalEventReminderPreference | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.enabled === false) return { enabled: false };
  if (row.enabled !== true) return null;
  if (row.mode === 'timed' && isTimedLead(row.leadMinutes)) {
    return { enabled: true, mode: 'timed', leadMinutes: row.leadMinutes };
  }
  if (
    row.mode === 'allDay' &&
    row.hour === ALL_DAY_REMINDER_HOUR &&
    row.minute === ALL_DAY_REMINDER_MINUTE
  ) {
    return {
      enabled: true,
      mode: 'allDay',
      hour: ALL_DAY_REMINDER_HOUR,
      minute: ALL_DAY_REMINDER_MINUTE,
    };
  }
  return null;
}

const STATUSES: readonly PersonalEventReminderStatus[] = [
  'off',
  'pending',
  'scheduled',
  'error',
  'permission_needed',
  'elapsed',
  'unsupported',
  'corrupt_blocked',
  'limit_deferred',
];

function parseEntry(value: unknown, eventId: string): PersonalEventReminderEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.eventId !== eventId || typeof row.eventId !== 'string') return null;
  if (typeof row.revision !== 'string' || !row.revision) return null;
  if (typeof row.lookupToken !== 'string' || !row.lookupToken) return null;
  if (typeof row.osIdentifier !== 'string' || !row.osIdentifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX))
    return null;
  if (!Number.isInteger(row.intentGeneration) || (row.intentGeneration as number) < 0) return null;
  if (typeof row.status !== 'string' || !STATUSES.includes(row.status as PersonalEventReminderStatus))
    return null;
  if (typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  const preference = parsePreference(row.preference);
  if (!preference) return null;
  const entry: PersonalEventReminderEntry = {
    eventId,
    revision: row.revision,
    preference,
    lookupToken: row.lookupToken,
    osIdentifier: row.osIdentifier,
    intentGeneration: row.intentGeneration as number,
    status: row.status as PersonalEventReminderStatus,
    updatedAt: row.updatedAt,
  };
  if (typeof row.lastError === 'string') entry.lastError = row.lastError;
  if (typeof row.scheduledTriggerAt === 'number' && Number.isFinite(row.scheduledTriggerAt)) {
    entry.scheduledTriggerAt = row.scheduledTriggerAt;
  }
  return entry;
}

function parsePendingCancel(value: unknown): PersonalEventReminderPendingCancel | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.osIdentifier !== 'string' || !row.osIdentifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX))
    return null;
  if (typeof row.lookupToken !== 'string' || !row.lookupToken) return null;
  if (!Number.isInteger(row.intentGeneration) || (row.intentGeneration as number) < 0) return null;
  if (typeof row.scopeOwner !== 'string' || !row.scopeOwner) return null;
  if (typeof row.scopeSchoolId !== 'string' || !row.scopeSchoolId) return null;
  return {
    osIdentifier: row.osIdentifier,
    lookupToken: row.lookupToken,
    intentGeneration: row.intentGeneration as number,
    scopeOwner: row.scopeOwner,
    scopeSchoolId: row.scopeSchoolId,
  };
}

function parseJournal(
  raw: string,
  scope: PersonalImportScope,
): PersonalEventReminderJournal | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.version !== PERSONAL_EVENT_REMINDER_JOURNAL_VERSION) return null;
  const storedScope = row.scope as PersonalImportScope | undefined;
  if (
    !storedScope ||
    storedScope.owner !== scope.owner ||
    storedScope.schoolId !== scope.schoolId
  )
    return null;
  if (!row.entries || typeof row.entries !== 'object' || Array.isArray(row.entries)) return null;
  if (!Array.isArray(row.pendingCancels)) return null;
  const entries: Record<string, PersonalEventReminderEntry> = {};
  for (const [eventId, entryRaw] of Object.entries(row.entries as Record<string, unknown>)) {
    const entry = parseEntry(entryRaw, eventId);
    if (!entry) return null;
    entries[eventId] = entry;
  }
  const pendingCancels: PersonalEventReminderPendingCancel[] = [];
  for (const item of row.pendingCancels) {
    const cancel = parsePendingCancel(item);
    if (!cancel) return null;
    pendingCancels.push(cancel);
  }
  return {
    version: PERSONAL_EVENT_REMINDER_JOURNAL_VERSION,
    scope: { owner: scope.owner, schoolId: scope.schoolId },
    entries,
    pendingCancels,
  };
}

async function preserveCorrupt(scope: PersonalImportScope, raw: string): Promise<void> {
  const corruptKey = personalEventReminderCorruptKey(scope);
  const existing = await AsyncStorage.getItem(corruptKey);
  if (!existing) await AsyncStorage.setItem(corruptKey, raw);
}

export async function loadPersonalEventReminderJournal(
  scope: PersonalImportScope,
): Promise<PersonalEventReminderJournal> {
  const key = personalEventReminderJournalKey(scope);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return emptyReminderJournal(scope);
  const parsed = parseJournal(raw, scope);
  if (!parsed) {
    await preserveCorrupt(scope, raw);
    throw new PersonalEventReminderJournalCorruptError(scope);
  }
  return parsed;
}

export async function mutatePersonalEventReminderJournal<T>(
  scope: PersonalImportScope,
  active: () => boolean,
  update: (
    journal: PersonalEventReminderJournal,
  ) =>
    | { journal: PersonalEventReminderJournal; result: T }
    | Promise<{ journal: PersonalEventReminderJournal; result: T }>,
): Promise<T> {
  const key = personalEventReminderJournalKey(scope);
  const previous = journalLocks.get(key) || Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      if (!active()) throw new Error('帳號或學校已切換，請稍後再試。');
      const current = await loadPersonalEventReminderJournal(scope);
      if (!active()) throw new Error('帳號或學校已切換，請稍後再試。');
      const { journal, result } = await update(current);
      if (!active()) throw new Error('帳號或學校已切換，請稍後再試。');
      if (
        journal.scope.owner !== scope.owner ||
        journal.scope.schoolId !== scope.schoolId ||
        journal.version !== PERSONAL_EVENT_REMINDER_JOURNAL_VERSION
      ) {
        throw new Error('提醒設定範圍不符。');
      }
      const serialized = JSON.stringify(journal);
      const previousRaw = await AsyncStorage.getItem(key);
      if (previousRaw !== serialized) {
        await AsyncStorage.setItem(key, serialized);
        notifyJournal(scope);
      }
      return result;
    });
  journalLocks.set(key, task);
  void task
    .finally(() => {
      if (journalLocks.get(key) === task) journalLocks.delete(key);
    })
    .catch(() => undefined);
  return task;
}

function parseRegistry(raw: string): PersonalEventReminderOsRegistry | null {
  try {
    const value = JSON.parse(raw) as PersonalEventReminderOsRegistry;
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.identifiers) ||
      value.identifiers.some(
        (id) => typeof id !== 'string' || !id.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX),
      )
    ) {
      return null;
    }
    return { version: 1, identifiers: [...new Set(value.identifiers)] };
  } catch {
    return null;
  }
}

async function loadRegistry(): Promise<PersonalEventReminderOsRegistry> {
  const raw = await AsyncStorage.getItem(PERSONAL_EVENT_REMINDER_REGISTRY_KEY);
  if (!raw) return { version: 1, identifiers: [] };
  const parsed = parseRegistry(raw);
  if (!parsed) {
    const existing = await AsyncStorage.getItem(PERSONAL_EVENT_REMINDER_REGISTRY_CORRUPT_KEY);
    if (!existing) await AsyncStorage.setItem(PERSONAL_EVENT_REMINDER_REGISTRY_CORRUPT_KEY, raw);
    throw new PersonalEventReminderRegistryCorruptError();
  }
  return parsed;
}

export async function rememberPersonalEventReminderOsIds(ids: string[]): Promise<void> {
  const featureIds = [...new Set(ids.filter((id) => id.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX)))];
  if (!featureIds.length) return;
  const previous = registryLock.current;
  const task = previous.catch(() => undefined).then(async () => {
    const registry = await loadRegistry();
    const next = [...new Set([...registry.identifiers, ...featureIds])];
    if (next.length === registry.identifiers.length) return;
    await AsyncStorage.setItem(
      PERSONAL_EVENT_REMINDER_REGISTRY_KEY,
      JSON.stringify({ version: 1, identifiers: next } satisfies PersonalEventReminderOsRegistry),
    );
  });
  registryLock.current = task;
  await task;
}

export async function forgetPersonalEventReminderOsIds(ids: string[]): Promise<void> {
  const remove = new Set(ids.filter((id) => id.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX)));
  if (!remove.size) return;
  const previous = registryLock.current;
  const task = previous.catch(() => undefined).then(async () => {
    const registry = await loadRegistry();
    const next = registry.identifiers.filter((id) => !remove.has(id));
    if (next.length === registry.identifiers.length) return;
    await AsyncStorage.setItem(
      PERSONAL_EVENT_REMINDER_REGISTRY_KEY,
      JSON.stringify({ version: 1, identifiers: next } satisfies PersonalEventReminderOsRegistry),
    );
  });
  registryLock.current = task;
  await task;
}

export async function listRegisteredPersonalEventReminderOsIds(): Promise<string[]> {
  return (await loadRegistry()).identifiers;
}

function parseCleanupStore(raw: string): PersonalEventReminderCleanupStore | null {
  try {
    const value = JSON.parse(raw) as PersonalEventReminderCleanupStore;
    if (!value || value.version !== 1 || !Array.isArray(value.pending)) return null;
    const pending: PersonalEventReminderPendingCancel[] = [];
    for (const item of value.pending) {
      const cancel = parsePendingCancel(item);
      if (!cancel) return null;
      pending.push(cancel);
    }
    return { version: 1, pending };
  } catch {
    return null;
  }
}

const CLEANUP_CORRUPT_KEY = `${PERSONAL_EVENT_REMINDER_CLEANUP_KEY}:corrupt`;

async function loadCleanupStore(): Promise<PersonalEventReminderCleanupStore> {
  const raw = await AsyncStorage.getItem(PERSONAL_EVENT_REMINDER_CLEANUP_KEY);
  if (!raw) return { version: 1, pending: [] };
  const parsed = parseCleanupStore(raw);
  if (!parsed) {
    const existing = await AsyncStorage.getItem(CLEANUP_CORRUPT_KEY);
    if (!existing) await AsyncStorage.setItem(CLEANUP_CORRUPT_KEY, raw);
    // Never replace the corrupt primary value with an empty success.
    throw new PersonalEventReminderCleanupCorruptError();
  }
  return parsed;
}

export async function loadPersonalEventReminderCleanupPending(): Promise<
  PersonalEventReminderPendingCancel[]
> {
  return (await loadCleanupStore()).pending;
}

export async function enqueuePersonalEventReminderCleanup(
  items: PersonalEventReminderPendingCancel[],
): Promise<void> {
  if (!items.length) return;
  const previous = cleanupLock.current;
  const task = previous.catch(() => undefined).then(async () => {
    const store = await loadCleanupStore();
    const next = [...store.pending];
    for (const item of items) {
      if (
        next.some(
          (row) =>
            row.osIdentifier === item.osIdentifier &&
            row.intentGeneration === item.intentGeneration,
        )
      ) {
        continue;
      }
      next.push(item);
    }
    await AsyncStorage.setItem(
      PERSONAL_EVENT_REMINDER_CLEANUP_KEY,
      JSON.stringify({ version: 1, pending: next } satisfies PersonalEventReminderCleanupStore),
    );
  });
  cleanupLock.current = task;
  await task;
}

export async function replacePersonalEventReminderCleanup(
  pending: PersonalEventReminderPendingCancel[],
): Promise<void> {
  const previous = cleanupLock.current;
  const task = previous.catch(() => undefined).then(async () => {
    // Refuse to clobber a corrupt primary value.
    await loadCleanupStore();
    await AsyncStorage.setItem(
      PERSONAL_EVENT_REMINDER_CLEANUP_KEY,
      JSON.stringify({ version: 1, pending } satisfies PersonalEventReminderCleanupStore),
    );
  });
  cleanupLock.current = task;
  await task;
}
