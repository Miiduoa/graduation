import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { PersonalEventReminderBridge } from '../components/PersonalEventReminderBridge';
import {
  appendPersonalImports,
  editPersonalImport,
  loadPersonalImports,
} from '../services/personalImports';
import {
  __resetPersonalEventReminderWorkerForTests,
  disablePersonalEventReminder,
  enableTimedPersonalEventReminder,
  hasUnresolvedPersonalEventReminderCleanup,
  invalidatePersonalEventRemindersForScopeChange,
  reconcilePersonalEventReminders,
} from '../services/personalEventReminders';
import {
  PERSONAL_EVENT_REMINDER_CLEANUP_KEY,
  personalEventReminderJournalKey,
} from '../services/personalEventReminderModel';

const mockScope = { owner: 'guest:device', schoolId: 'pu' };
let mockActiveScope: typeof mockScope | null = mockScope;
const mockOs = new Map<string, { identifier: string; content: { data?: { g?: number } }; trigger: unknown }>();

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
  flushPendingPersonalEventReminderTap: jest.fn(),
  handlePersonalEventReminderResponse: jest.fn(),
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
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (request: {
      identifier?: string;
      content: { data?: { g?: number } };
      trigger: unknown;
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

test('receipt publication does not trigger repeated native scheduling in mounted bridge', async () => {
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  const before = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;
  const view = render(React.createElement(PersonalEventReminderBridge));
  await new Promise((r) => setTimeout(r, 75));
  view.unmount();
  const calls =
    (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length - before;
  expect(calls).toBeLessThanOrEqual(1);
});

test('a revision cannot be scheduled before its new intent has been persisted', async () => {
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  await editPersonalImport(mockScope, record, {
    ...record,
    startTime: '17:00',
    endTime: '18:00',
  });
  const key = personalEventReminderJournalKey(mockScope);
  const set = AsyncStorage.setItem as jest.Mock;
  const original = set.getMockImplementation()!;
  set.mockImplementation(async (k: string, v: string) => {
    if (k === key && JSON.parse(v).entries[record.id]?.intentGeneration > 1) {
      throw new Error('injected journal write failure');
    }
    return original(k, v);
  });
  try {
    await reconcilePersonalEventReminders(mockScope).catch(() => undefined);
    const raw = JSON.parse((await AsyncStorage.getItem(key))!);
    const observed = [...mockOs.values()][0];
    expect(observed.content.data?.g).toBe(raw.entries[record.id].intentGeneration);
  } finally {
    set.mockImplementation(original);
  }
});

test('failed foreign-scope cleanup blocks scheduling into a new owner and school', async () => {
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  const other = { owner: 'nuni:other-account', schoolId: 'nthu' };
  await appendPersonalImports(other, [{ ...record, id: 'second-event', schoolId: 'nthu' }]);
  const otherRecord = (await loadPersonalImports(other)).records[0]!;
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValue(
    new Error('injected cancel failure'),
  );
  await invalidatePersonalEventRemindersForScopeChange(mockScope, other);
  await enableTimedPersonalEventReminder(other, otherRecord, 10);
  expect(mockOs.size).toBe(1);
  expect(await hasUnresolvedPersonalEventReminderCleanup()).toBe(true);
});

test('cancel failure retries later and preserves unrelated notifications', async () => {
  mockOs.set('ai-agent-keep', {
    identifier: 'ai-agent-keep',
    content: { data: undefined },
    trigger: null,
  });
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  const featureId = [...mockOs.keys()].find((id) => id.startsWith('per-evtrem.'))!;

  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      if (id === featureId) throw new Error('injected cancel failure');
      mockOs.delete(id);
    },
  );
  await invalidatePersonalEventRemindersForScopeChange(mockScope, null);
  expect(mockOs.has(featureId)).toBe(true);
  expect(mockOs.has('ai-agent-keep')).toBe(true);
  expect(await hasUnresolvedPersonalEventReminderCleanup()).toBe(true);

  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
    async (id: string) => {
      mockOs.delete(id);
    },
  );
  await reconcilePersonalEventReminders(null);
  await waitFor(async () => {
    expect(mockOs.has(featureId)).toBe(false);
  });
  expect(mockOs.has('ai-agent-keep')).toBe(true);
  expect(await hasUnresolvedPersonalEventReminderCleanup()).toBe(false);
});

test('unresolved cold start removes old feature requests while preserving other notifications', async () => {
  const record = await seed();
  await enableTimedPersonalEventReminder(mockScope, record, 10);
  mockOs.set('unrelated-ai', {
    identifier: 'unrelated-ai',
    content: { data: undefined },
    trigger: null,
  });
  mockActiveScope = null;
  const view = render(React.createElement(PersonalEventReminderBridge));
  await new Promise((r) => setTimeout(r, 30));
  view.unmount();
  await new Promise((r) => setTimeout(r, 10));
  expect([...mockOs.keys()]).toEqual(['unrelated-ai']);
});

test('turning off one event leaves a second enabled event scheduled', async () => {
  const first = await seed();
  await enableTimedPersonalEventReminder(mockScope, first, 10);
  await appendPersonalImports(mockScope, [
    { ...first, id: 'another-event', startTime: '19:00', endTime: '20:00' },
  ]);
  const second = (await loadPersonalImports(mockScope)).records.find(
    (r) => r.id === 'another-event',
  )!;
  const other = await enableTimedPersonalEventReminder(mockScope, second, 10);
  await disablePersonalEventReminder(mockScope, first);
  expect(mockOs.has(other.entry.osIdentifier)).toBe(true);
  expect(mockOs.size).toBe(1);
});

test('a corrupt cleanup log is preserved and cannot authorize new native schedules', async () => {
  const first = await seed();
  const enabled = await enableTimedPersonalEventReminder(mockScope, first, 10);
  await AsyncStorage.setItem(PERSONAL_EVENT_REMINDER_CLEANUP_KEY, '{broken-cleanup');
  await appendPersonalImports(mockScope, [
    { ...first, id: 'new-after-corrupt', startTime: '19:00', endTime: '20:00' },
  ]);
  const second = (await loadPersonalImports(mockScope)).records.find(
    (r) => r.id === 'new-after-corrupt',
  )!;
  await enableTimedPersonalEventReminder(mockScope, second, 10).catch(() => undefined);
  expect([...mockOs.keys()].every((id) => id === enabled.entry.osIdentifier)).toBe(true);
  expect(await AsyncStorage.getItem(PERSONAL_EVENT_REMINDER_CLEANUP_KEY)).toBe(
    '{broken-cleanup',
  );
});
