import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  appendPersonalImports,
  editPersonalImport,
  loadPersonalImports,
} from '../services/personalImports';
import {
  __resetPersonalEventReminderWorkerForTests,
  enableTimedPersonalEventReminder,
  listPersonalEventReminderEntries,
  reconcilePersonalEventReminders,
} from '../services/personalEventReminders';
import {
  PERSONAL_EVENT_REMINDER_OS_PREFIX,
  personalEventReminderJournalKey,
} from '../services/personalEventReminderModel';
import {
  __resetPersonalEventReminderRuntimeStateForTests,
  getPersonalEventReminderRuntimeFailure,
} from '../services/personalEventReminderRuntimeState';

const mockScope = { owner: 'guest:device', schoolId: 'pu' };
const mockOs = new Map<
  string,
  { identifier: string; content: { data?: { type?: string; t?: string; g?: number } }; trigger: { date?: Date | number } }
>();

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
}));

jest.mock('../services/notifications', () => ({
  checkPushPermission: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  openNotificationSettings: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockOs.clear();
  jest.clearAllMocks();
  __resetPersonalEventReminderWorkerForTests();
  __resetPersonalEventReminderRuntimeStateForTests();
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (request: {
      identifier?: string;
      content: { data?: { type?: string; t?: string; g?: number } };
      trigger: { date?: Date | number };
    }) => {
      await new Promise((r) => setTimeout(r, 2));
      const id = request.identifier || `auto-${mockOs.size}`;
      mockOs.set(id, { identifier: id, content: request.content, trigger: request.trigger });
      return id;
    },
  );
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => [
    ...mockOs.values(),
  ]);
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      mockOs.delete(id);
    },
  );
  (Notifications.dismissNotificationAsync as jest.Mock).mockResolvedValue(undefined);
});

async function seed() {
  await appendPersonalImports(mockScope, [
    {
      id: 'independent-event',
      kind: 'events',
      title: '私人行程',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2027-12-01',
      startTime: '15:00',
      endTime: '16:00',
      source: { type: 'paste', name: '手動新增', line: 1, rawText: '私人行程' },
    },
  ]);
  return (await loadPersonalImports(mockScope)).records[0]!;
}

function keepUnrelated() {
  mockOs.set('ai-agent-keep', {
    identifier: 'ai-agent-keep',
    content: { data: { type: 'other' } },
    trigger: { date: Date.now() + 60_000 },
  });
}

test('after a revision replacement a healthy schedule is not cancelled again on the next reconcile', async () => {
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  await editPersonalImport(mockScope, record, { ...record, startTime: '17:00', endTime: '18:00' });
  await reconcilePersonalEventReminders(mockScope);
  (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
  await reconcilePersonalEventReminders(mockScope);
  expect({
    cancel: (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.length,
    schedule: (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length,
  }).toEqual({ cancel: 0, schedule: 0 });
});

test('a healthy changed-date reminder survives foreground reconciliation even if native rescheduling is unavailable', async () => {
  const record = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, record, 10);
  await editPersonalImport(mockScope, record, { ...record, startTime: '17:00', endTime: '18:00' });
  await reconcilePersonalEventReminders(mockScope);
  expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
  (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValue(
    new Error('temporary native schedule failure'),
  );
  await reconcilePersonalEventReminders(mockScope);
  expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
});

test('post-intent successful-drain receipt storage failure blocks replacement until durable clear', async () => {
  keepUnrelated();
  const record = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, record, 10);
  const key = personalEventReminderJournalKey(mockScope);
  const set = AsyncStorage.setItem as jest.Mock;
  const original = set.getMockImplementation()!;
  let sawQueuedCancel = false;
  set.mockImplementation(async (k: string, v: string) => {
    if (k === key) {
      const parsed = JSON.parse(v) as { pendingCancels: unknown[] };
      if (parsed.pendingCancels.length > 0) sawQueuedCancel = true;
      if (sawQueuedCancel && parsed.pendingCancels.length === 0) {
        throw new Error('post-intent drain receipt disk failure');
      }
    }
    return original(k, v);
  });
  try {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await editPersonalImport(mockScope, record, { ...record, startTime: '17:00', endTime: '18:00' });
    await reconcilePersonalEventReminders(mockScope).catch(() => undefined);

    expect(getPersonalEventReminderRuntimeFailure(mockScope)).not.toBeNull();
    const raw = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(raw.pendingCancels.length).toBeGreaterThan(0);
    expect(mockOs.has(enabled.entry.osIdentifier)).toBe(false);
    expect(mockOs.has('ai-agent-keep')).toBe(true);
    expect((Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length).toBe(0);

    set.mockImplementation(original);
    __resetPersonalEventReminderWorkerForTests();
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
    await reconcilePersonalEventReminders(mockScope);

    expect(getPersonalEventReminderRuntimeFailure(mockScope)).toBeNull();
    const after = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(after.pendingCancels).toEqual([]);
    expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
    expect(mockOs.has('ai-agent-keep')).toBe(true);
    const entries = await listPersonalEventReminderEntries(mockScope);
    expect(entries[record.id]?.status).toBe('scheduled');
    expect(entries[record.id]?.intentGeneration).toBeGreaterThan(1);

    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
    await reconcilePersonalEventReminders(mockScope);
    expect({
      cancel: (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.length,
      schedule: (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length,
    }).toEqual({ cancel: 0, schedule: 0 });
  } finally {
    set.mockImplementation(original);
  }
});

test('initial successful-drain receipt storage failure preserves retry state and blocks schedules', async () => {
  keepUnrelated();
  const record = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, record, 10);
  const key = personalEventReminderJournalKey(mockScope);

  // Simulate durable cancel left behind after a prior successful OS cancel.
  const seeded = JSON.parse((await AsyncStorage.getItem(key))!);
  seeded.pendingCancels = [
    {
      osIdentifier: enabled.entry.osIdentifier,
      lookupToken: enabled.entry.lookupToken,
      intentGeneration: enabled.entry.intentGeneration,
      scopeOwner: mockScope.owner,
      scopeSchoolId: mockScope.schoolId,
    },
  ];
  await AsyncStorage.setItem(key, JSON.stringify(seeded));

  const set = AsyncStorage.setItem as jest.Mock;
  const original = set.getMockImplementation()!;
  set.mockImplementation(async (k: string, v: string) => {
    if (k === key) {
      const parsed = JSON.parse(v) as { pendingCancels: unknown[] };
      if (parsed.pendingCancels.length === 0) {
        throw new Error('initial drain receipt disk failure');
      }
    }
    return original(k, v);
  });
  try {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await reconcilePersonalEventReminders(mockScope).catch(() => undefined);

    expect(getPersonalEventReminderRuntimeFailure(mockScope)).not.toBeNull();
    const raw = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(raw.pendingCancels.length).toBe(1);
    expect(raw.pendingCancels[0].osIdentifier).toBe(enabled.entry.osIdentifier);
    expect((Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length).toBe(0);
    expect(mockOs.has('ai-agent-keep')).toBe(true);

    set.mockImplementation(original);
    __resetPersonalEventReminderWorkerForTests();
    await reconcilePersonalEventReminders(mockScope);

    expect(getPersonalEventReminderRuntimeFailure(mockScope)).toBeNull();
    const after = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(after.pendingCancels).toEqual([]);
    expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
    expect(mockOs.has('ai-agent-keep')).toBe(true);
    expect([...mockOs.keys()].filter((id) => id.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX))).toHaveLength(
      1,
    );
  } finally {
    set.mockImplementation(original);
  }
});

test('partial cancel failure keeps remaining intents durable and recoverable without touching unrelated ids', async () => {
  keepUnrelated();
  const record = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, record, 10);
  const key = personalEventReminderJournalKey(mockScope);

  await editPersonalImport(mockScope, record, { ...record, startTime: '17:00', endTime: '18:00' });
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      if (id === enabled.entry.osIdentifier) throw new Error('injected cancel failure');
      mockOs.delete(id);
    },
  );
  await reconcilePersonalEventReminders(mockScope).catch(() => undefined);

  const blocked = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(blocked.pendingCancels.some((row: { osIdentifier: string }) => row.osIdentifier === enabled.entry.osIdentifier)).toBe(
    true,
  );
  expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
  expect(mockOs.has('ai-agent-keep')).toBe(true);
  const blockedEntry = (await listPersonalEventReminderEntries(mockScope))[record.id];
  expect(blockedEntry?.status).toBe('error');

  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(async (id: string) => {
    mockOs.delete(id);
  });
  __resetPersonalEventReminderWorkerForTests();
  await reconcilePersonalEventReminders(mockScope);

  const after = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(after.pendingCancels).toEqual([]);
  expect(mockOs.has(enabled.entry.osIdentifier)).toBe(true);
  expect(mockOs.has('ai-agent-keep')).toBe(true);
  expect((await listPersonalEventReminderEntries(mockScope))[record.id]?.status).toBe('scheduled');
});
