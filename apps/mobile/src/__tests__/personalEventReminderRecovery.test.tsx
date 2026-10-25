import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { PersonalEventReminderBridge } from '../components/PersonalEventReminderBridge';
import {
  appendPersonalImports,
  loadPersonalImports,
} from '../services/personalImports';
import {
  __resetPersonalEventReminderWorkerForTests,
  enableTimedPersonalEventReminder,
  invalidatePersonalEventRemindersForScopeChange,
  listPersonalEventReminderEntries,
  reconcilePersonalEventReminders,
  resolvePersonalEventReminderTap,
} from '../services/personalEventReminders';
import {
  PERSONAL_EVENT_REMINDER_CLEANUP_KEY,
  PERSONAL_EVENT_REMINDER_DEVICE_BUDGET,
  PERSONAL_EVENT_REMINDER_OS_PREFIX,
} from '../services/personalEventReminderModel';
import {
  __resetPersonalEventReminderRuntimeStateForTests,
  getPersonalEventReminderRuntimeFailure,
} from '../services/personalEventReminderRuntimeState';

const mockScope = { owner: 'guest:device', schoolId: 'pu' };
let mockActiveScope: typeof mockScope | null = mockScope;
const mockOs = new Map<
  string,
  { identifier: string; content: { data?: { type?: string; t?: string; g?: number } }; trigger: { date?: Date | number } }
>();

jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => mockActiveScope,
}));
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

jest.mock('../services/personalEventReminderNavigation', () => ({
  flushPendingPersonalEventReminderTap: jest.fn(async () => undefined),
  handlePersonalEventReminderResponse: jest.fn(async () => undefined),
  notifyPersonalEventReminderScopeResolved: jest.fn(),
  setPersonalEventReminderScopeProvider: jest.fn(),
  subscribePersonalEventReminderNavigationReady: jest.fn(() => jest.fn()),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockOs.clear();
  jest.clearAllMocks();
  mockActiveScope = mockScope;
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

for (const nativePlatform of ['android', 'ios'] as const) {
  test(`${nativePlatform} native read-back must retain an unchanged schedule`, async () => {
    const record = await seed();
    await enableTimedPersonalEventReminder(mockScope, record, 10);
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () =>
      [...mockOs.values()].map((row) => ({
        ...row,
        trigger:
          nativePlatform === 'android'
            ? {
                type: 'date',
                repeats: false,
                value: Number(row.trigger.date),
              }
            : {
                type: 'timeInterval',
                repeats: false,
                seconds: (Number(row.trigger.date) - Date.now()) / 1000,
              },
      })),
    );
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await reconcilePersonalEventReminders(mockScope);
    await reconcilePersonalEventReminders(mockScope);
    expect((Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length).toBe(0);
  });
}

test('failed global cancel-intent storage must block a new identity even if old OS cancellation also fails', async () => {
  const first = await seed();
  const old = await enableTimedPersonalEventReminder(mockScope, first, 10);
  const other = { owner: 'nuni:other-account', schoolId: 'nthu' };
  await appendPersonalImports(other, [{ ...first, id: 'second-event', schoolId: 'nthu' }]);
  const otherRecord = (await loadPersonalImports(other)).records[0]!;
  const set = AsyncStorage.setItem as jest.Mock;
  const original = set.getMockImplementation()!;
  set.mockImplementation(async (key: string, value: string) => {
    if (key === PERSONAL_EVENT_REMINDER_CLEANUP_KEY) {
      throw new Error('global cleanup disk failure');
    }
    return original(key, value);
  });
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      if (id === old.entry.osIdentifier) throw new Error('old OS cancel failure');
      mockOs.delete(id);
    },
  );
  try {
    await invalidatePersonalEventRemindersForScopeChange(mockScope, other).catch(() => undefined);
    await enableTimedPersonalEventReminder(other, otherRecord, 10).catch(() => undefined);
    expect([...mockOs.keys()]).toEqual([old.entry.osIdentifier]);

    // Recovery / restart legs still cannot schedule foreign-new until old is gone.
    __resetPersonalEventReminderWorkerForTests();
    await reconcilePersonalEventReminders(other).catch(() => undefined);
    expect([...mockOs.keys()]).toEqual([old.entry.osIdentifier]);

    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
      async (id: string) => {
        mockOs.delete(id);
      },
    );
    set.mockImplementation(original);
    await reconcilePersonalEventReminders(other);
    await enableTimedPersonalEventReminder(other, otherRecord, 10);
    expect([...mockOs.keys()].every((id) => id.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX))).toBe(
      true,
    );
    expect(mockOs.has(old.entry.osIdentifier)).toBe(false);
  } finally {
    set.mockImplementation(original);
  }
});

test('bridge contains persistent reminder storage rejection', async () => {
  const get = AsyncStorage.getItem as jest.Mock;
  const original = get.getMockImplementation()!;
  get.mockRejectedValue(new Error('persistent reminder storage read failure'));
  const view = render(React.createElement(PersonalEventReminderBridge));
  try {
    await new Promise((r) => setTimeout(r, 40));
    await waitFor(() => {
      expect(getPersonalEventReminderRuntimeFailure(mockScope)?.message).toBeTruthy();
    });
  } finally {
    view.unmount();
    get.mockImplementation(original);
  }
});

test('capacity eviction cannot leave a removed sibling marked scheduled', async () => {
  const first = await seed();
  await enableTimedPersonalEventReminder(mockScope, first, 10);
  await appendPersonalImports(mockScope, [
    { ...first, id: 'later-event', startTime: '17:00', endTime: '18:00' },
    { ...first, id: 'earlier-event', startTime: '13:00', endTime: '14:00' },
  ]);
  const ledger = await loadPersonalImports(mockScope);
  const later = ledger.records.find((row) => row.id === 'later-event')!;
  const earlier = ledger.records.find((row) => row.id === 'earlier-event')!;
  await enableTimedPersonalEventReminder(mockScope, later, 10);
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (request: {
      identifier?: string;
      content: { data?: { type?: string; t?: string; g?: number } };
      trigger: { date?: Date | number };
    }) => {
      mockOs.set(request.identifier!, {
        identifier: request.identifier!,
        content: request.content,
        trigger: request.trigger,
      });
      const retained = [...mockOs.values()]
        .sort((a, b) => Number(a.trigger.date) - Number(b.trigger.date))
        .slice(0, 2);
      mockOs.clear();
      for (const row of retained) mockOs.set(row.identifier, row);
      return request.identifier;
    },
  );
  await enableTimedPersonalEventReminder(mockScope, earlier, 10);
  const entries = await listPersonalEventReminderEntries(mockScope);
  expect(
    Object.values(entries).filter(
      (row) => row.status === 'scheduled' && !mockOs.has(row.osIdentifier),
    ),
  ).toEqual([]);
});

test('device budget defers later reminders without cancelling other feature ids', async () => {
  // Fill all but one shared slot with unrelated notifications.
  for (let i = 0; i < PERSONAL_EVENT_REMINDER_DEVICE_BUDGET - 1; i += 1) {
    mockOs.set(`other-feature-${i}`, {
      identifier: `other-feature-${i}`,
      content: { data: { type: 'other' } },
      trigger: { date: Date.now() + 60_000 + i },
    });
  }
  const first = await seed();
  await appendPersonalImports(mockScope, [
    { ...first, id: 'second-budget', startTime: '16:00', endTime: '17:00' },
  ]);
  const ledger = await loadPersonalImports(mockScope);
  const second = ledger.records.find((row) => row.id === 'second-budget')!;
  const enabledFirst = await enableTimedPersonalEventReminder(mockScope, first, 10);
  const enabledSecond = await enableTimedPersonalEventReminder(mockScope, second, 10);
  expect(enabledFirst.entry.status).toBe('scheduled');
  expect(enabledSecond.entry.status).toBe('limit_deferred');
  expect(mockOs.has(enabledFirst.entry.osIdentifier)).toBe(true);
  expect(mockOs.has(enabledSecond.entry.osIdentifier)).toBe(false);
  for (let i = 0; i < PERSONAL_EVENT_REMINDER_DEVICE_BUDGET - 1; i += 1) {
    expect(mockOs.has(`other-feature-${i}`)).toBe(true);
  }

  // Free a sibling slot — startup/foreground reconcile recovers deferred preference.
  mockOs.delete('other-feature-0');
  await reconcilePersonalEventReminders(mockScope);
  const after = await listPersonalEventReminderEntries(mockScope);
  expect(after['second-budget']?.status).toBe('scheduled');
  expect(mockOs.has(enabledSecond.entry.osIdentifier)).toBe(true);
});

test('a legitimate delivered notification remains authorized after its trigger time', async () => {
  const first = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, first, 10);
  const payload = {
    type: 'personal_event_reminder_v1',
    v: 1,
    t: enabled.entry.lookupToken,
    g: enabled.entry.intentGeneration,
  };
  const now = jest.spyOn(Date, 'now').mockReturnValue(new Date('2028-01-01T00:00:00+08:00').getTime());
  try {
    expect(await resolvePersonalEventReminderTap(payload, mockScope)).toMatchObject({
      ok: true,
      eventId: first.id,
    });
  } finally {
    now.mockRestore();
  }
});
