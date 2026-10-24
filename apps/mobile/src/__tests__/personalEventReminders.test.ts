import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createPersonalImportId, type PersonalImportRow } from '@campus/shared';
import {
  appendPersonalImports,
  editPersonalImport,
  deletePersonalImport,
  loadPersonalImports,
} from '../services/personalImports';
import {
  __resetPersonalEventReminderWorkerForTests,
  disablePersonalEventReminder,
  enableTimedPersonalEventReminder,
  enableAllDayPersonalEventReminder,
  getPersonalEventReminderEntry,
  listPersonalEventReminderEntries,
  reconcilePersonalEventReminders,
  resolvePersonalEventReminderTap,
  retryPersonalEventReminder,
  setPersonalEventReminder,
} from '../services/personalEventReminders';
import { PersonalEventReminderJournalCorruptError } from '../services/personalEventReminderJournal';
import {
  PERSONAL_EVENT_REMINDER_OS_PREFIX,
  PERSONAL_EVENT_REMINDER_TYPE,
  allDayPreference,
  buildPersonalEventReminderPayload,
  defaultOffPreference,
  personalEventReminderJournalKey,
  personalEventReminderRevision,
  timedPreference,
} from '../services/personalEventReminderModel';

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => ({})),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
}));

const mockCheckPushPermission = jest.fn();
jest.mock('../services/notifications', () => ({
  checkPushPermission: (...args: unknown[]) => mockCheckPushPermission(...args),
  openNotificationSettings: jest.fn(),
}));

const scope = {
  owner: 'guest:device',
  schoolId: 'pu',
};

const scheduled = new Map<string, { identifier: string; content: unknown; trigger: unknown }>();

function futureEvent(overrides: Partial<PersonalImportRow> = {}): PersonalImportRow {
  return {
    id: createPersonalImportId(),
    kind: 'events',
    title: '私人讀書會',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-12-01',
    startTime: '15:00',
    endTime: '16:00',
    source: { type: 'paste', name: '手動新增', line: 1, rawText: '私人讀書會' },
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  scheduled.clear();
  jest.clearAllMocks();
  __resetPersonalEventReminderWorkerForTests();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockCheckPushPermission.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    canAskAgain: true,
  });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async (request: {
    identifier?: string;
    content: unknown;
    trigger: unknown;
  }) => {
    const id = request.identifier || `auto-${scheduled.size}`;
    scheduled.set(id, { identifier: id, content: request.content, trigger: request.trigger });
    return id;
  });
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      scheduled.delete(id);
    },
  );
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () =>
    [...scheduled.values()].map((row) => ({
      identifier: row.identifier,
      content: row.content,
      trigger: row.trigger,
    })),
  );
});

async function seedEvent(row = futureEvent()) {
  const result = await appendPersonalImports(scope, [row]);
  const ledger = await loadPersonalImports(scope);
  const record = ledger.records.find((item) => item.id === row.id)!;
  return { result, record };
}

test('reminders default off and enable uses one stable OS identifier without push/network token calls', async () => {
  const { record } = await seedEvent();
  expect(await getPersonalEventReminderEntry(scope, record.id)).toBeNull();

  const enabled = await enableTimedPersonalEventReminder(scope, record, 30);
  expect(enabled.entry.preference).toEqual(timedPreference(30));
  expect(enabled.entry.osIdentifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX)).toBe(true);
  expect(scheduled.size).toBe(1);
  expect(scheduled.has(enabled.entry.osIdentifier)).toBe(true);

  const content = scheduled.get(enabled.entry.osIdentifier)!.content as {
    title: string;
    body: string;
    data: Record<string, unknown>;
  };
  expect(content.title).toBe('個人行程提醒');
  expect(content.body).toContain('個人行程即將開始');
  expect(JSON.stringify(content)).not.toContain('私人讀書會');
  expect(content.data.type).toBe(PERSONAL_EVENT_REMINDER_TYPE);

  const retried = await retryPersonalEventReminder(scope, record);
  expect(retried.entry.osIdentifier).toBe(enabled.entry.osIdentifier);
  expect(scheduled.size).toBe(1);
});

test('denied permission keeps preference but does not schedule; refusal does not erase events', async () => {
  mockCheckPushPermission.mockResolvedValue({
    granted: false,
    canAskAgain: false,
    status: 'denied',
  });
  const { record } = await seedEvent();
  const result = await enableTimedPersonalEventReminder(scope, record, 10);
  expect(result.entry.status).toBe('permission_needed');
  expect(result.entry.preference.enabled).toBe(true);
  expect(scheduled.size).toBe(0);
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
});

test('all-day enable requires explicit Taiwan 09:00 preference path', async () => {
  const { record } = await seedEvent(
    futureEvent({ allDay: true, startTime: undefined, endTime: undefined }),
  );
  const result = await enableAllDayPersonalEventReminder(scope, record);
  expect(result.entry.preference).toEqual(allDayPreference());
  expect(scheduled.size).toBe(1);
  const trigger = scheduled.get(result.entry.osIdentifier)!.trigger as {
    type: string;
    date: Date;
  };
  expect(trigger.type).toBe('date');
  expect(new Date(trigger.date).toISOString()).toBe('2026-12-01T01:00:00.000Z');
});

test('edit moves time, revokes old tap generation, and reschedules with the same OS id', async () => {
  const { record } = await seedEvent();
  const enabled = await enableTimedPersonalEventReminder(scope, record, 0);
  const oldPayload = buildPersonalEventReminderPayload(enabled.entry);

  const editedRow = {
    ...record,
    startTime: '17:00',
    endTime: '18:00',
  };
  await editPersonalImport(scope, record, editedRow);
  const ledger = await loadPersonalImports(scope);
  const updated = ledger.records[0]!;
  await reconcilePersonalEventReminders(scope);

  const entry = await getPersonalEventReminderEntry(scope, record.id);
  expect(entry?.preference.enabled).toBe(true);
  expect(entry?.revision).toBe(personalEventReminderRevision(updated));
  expect(entry?.osIdentifier).toBe(enabled.entry.osIdentifier);
  expect(entry!.intentGeneration).toBeGreaterThan(enabled.entry.intentGeneration);

  const stale = await resolvePersonalEventReminderTap(oldPayload, scope);
  expect(stale.ok).toBe(false);
  const fresh = await resolvePersonalEventReminderTap(
    buildPersonalEventReminderPayload(entry!),
    scope,
  );
  expect(fresh.ok).toBe(true);
  if (fresh.ok) expect(fresh.eventId).toBe(record.id);
});

test('deletion clears preference and cancels OS request; sync-like restore does not silently re-enable', async () => {
  const { record } = await seedEvent();
  await enableTimedPersonalEventReminder(scope, record, 10);
  expect(scheduled.size).toBe(1);
  await deletePersonalImport(scope, record);
  await reconcilePersonalEventReminders(scope);
  const entry = await getPersonalEventReminderEntry(scope, record.id);
  expect(entry?.preference.enabled).toBe(false);
  expect(scheduled.size).toBe(0);

  await appendPersonalImports(scope, [futureEvent({ id: record.id })]);
  await reconcilePersonalEventReminders(scope);
  const afterRestore = await getPersonalEventReminderEntry(scope, record.id);
  expect(afterRestore?.preference.enabled ?? false).toBe(false);
  expect(scheduled.size).toBe(0);
});

test('owner/school fence rejects foreign scope taps and corrupt journal is preserved', async () => {
  const { record } = await seedEvent();
  const enabled = await enableTimedPersonalEventReminder(scope, record, 0);
  const payload = buildPersonalEventReminderPayload(enabled.entry);

  expect(
    (
      await resolvePersonalEventReminderTap(payload, {
        owner: 'nuni:other',
        schoolId: 'pu',
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await resolvePersonalEventReminderTap(payload, {
        owner: 'guest:device',
        schoolId: 'nthu',
      })
    ).ok,
  ).toBe(false);
  expect((await resolvePersonalEventReminderTap(payload, null)).ok).toBe(false);

  const key = personalEventReminderJournalKey(scope);
  await AsyncStorage.setItem(key, '{not-json');
  await expect(enableTimedPersonalEventReminder(scope, record, 0)).rejects.toThrow(/無法讀取/);
  await expect(listPersonalEventReminderEntries(scope)).rejects.toBeInstanceOf(
    PersonalEventReminderJournalCorruptError,
  );
  expect(await AsyncStorage.getItem(`${key}:corrupt`)).toContain('{not-json');
  expect(await AsyncStorage.getItem(key)).toBe('{not-json');
});

test('OS success with later reconcile still uses persisted identifier; unrelated schedules survive', async () => {
  scheduled.set('ai-agent-keep', {
    identifier: 'ai-agent-keep',
    content: { title: '課表' },
    trigger: null,
  });
  const { record } = await seedEvent();
  const enabled = await enableTimedPersonalEventReminder(scope, record, 60);
  expect(scheduled.has('ai-agent-keep')).toBe(true);
  expect(scheduled.has(enabled.entry.osIdentifier)).toBe(true);

  // Simulate receipt/list flake then restart reconcile
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock)
    .mockResolvedValueOnce([])
    .mockImplementation(async () =>
      [...scheduled.values()].map((row) => ({
        identifier: row.identifier,
        content: row.content,
        trigger: row.trigger,
      })),
    );
  await reconcilePersonalEventReminders(scope);
  expect(scheduled.has(enabled.entry.osIdentifier)).toBe(true);
  expect(scheduled.has('ai-agent-keep')).toBe(true);
});

test('disable intent is durable before reporting off', async () => {
  const { record } = await seedEvent();
  await enableTimedPersonalEventReminder(scope, record, 0);
  const disabled = await disablePersonalEventReminder(scope, record);
  expect(disabled.entry.preference).toEqual(defaultOffPreference());
  expect(disabled.entry.status).toBe('off');
  expect(scheduled.size).toBe(0);
});

test('set reminder failure path never claims schedule success when permission missing after explicit ask', async () => {
  mockCheckPushPermission.mockResolvedValue({
    granted: false,
    canAskAgain: true,
    status: 'denied',
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'denied',
    canAskAgain: false,
  });
  const { record } = await seedEvent();
  const result = await setPersonalEventReminder({
    scope,
    record,
    preference: timedPreference(10),
    requestPermission: true,
  });
  expect(result.eventSavedIndependent).toBe(true);
  expect(result.entry.status).toBe('permission_needed');
  expect(result.entry.preference.enabled).toBe(true);
  expect(scheduled.size).toBe(0);
});
