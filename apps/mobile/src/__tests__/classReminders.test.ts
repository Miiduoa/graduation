import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { classMeetingKey, withClassExceptions, type PersonalImportRecord } from '@campus/shared';
import { refreshClassReminders, setClassRemindersEnabled } from '../services/classReminders';

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
const row: PersonalImportRecord = {
  id: 'synthetic',
  batchId: 'batch',
  importedAt: '',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '合成課程',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '12:00',
  location: '原教室',
  source: { type: 'paste', line: 1, rawText: '合成來源' },
};
const now = new Date('2026-11-02T08:00:00+08:00');
const read = async () => ({ records: [row], schoolId: 'pu' });
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
  await refreshClassReminders(null);
});
test('is opt in and schedules dated occurrences instead of recurring weekly notifications', async () => {
  await refreshClassReminders('synthetic', read, now);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await setClassRemindersEnabled('synthetic', true);
  await refreshClassReminders('synthetic', read, now);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: { type: 'date', date: new Date('2026-11-02T08:50:00+08:00') },
      content: expect.objectContaining({ body: '10 分鐘後上課 · 原教室' }),
    }),
  );
});
test('cancels a stopped class and never touches unrelated notifications on logout', async () => {
  await setClassRemindersEnabled('synthetic', true);
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
    { identifier: 'old-class', content: { data: { category: 'personal_class_occurrence' } } },
    { identifier: 'unrelated', content: { data: { category: 'another-feature' } } },
  ] as never);
  const records = withClassExceptions(
    [row],
    [
      {
        id: 'stop',
        courseKey: classMeetingKey(row),
        original: row,
        originalDate: '2026-11-02',
        kind: 'cancel',
        createdAt: '',
      },
    ],
  );
  await refreshClassReminders('synthetic', async () => ({ records, schoolId: 'pu' }), now);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-class');
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('unrelated');
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await refreshClassReminders(null);
});
test('uses the makeup date, overnight ending and changed room', async () => {
  await setClassRemindersEnabled('synthetic', true);
  const records = withClassExceptions(
    [row],
    [
      {
        id: 'move',
        courseKey: classMeetingKey(row),
        original: row,
        originalDate: '2026-11-02',
        kind: 'move',
        date: '2026-11-03',
        endDate: '2026-11-04',
        startTime: '23:30',
        endTime: '01:00',
        location: '補課教室',
        createdAt: '',
      },
    ],
  );
  await refreshClassReminders('synthetic', async () => ({ records, schoolId: 'pu' }), now);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: { type: 'date', date: new Date('2026-11-03T23:20:00+08:00') },
      content: expect.objectContaining({ body: '10 分鐘後上課 · 補課教室' }),
    }),
  );
});
test('an old read cannot create notifications after logout', async () => {
  await setClassRemindersEnabled('synthetic', true);
  let complete!: (value: Awaited<ReturnType<typeof read>>) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = refreshClassReminders(
    'synthetic',
    () => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    now,
  );
  await ready;
  const logout = refreshClassReminders(null);
  complete(await read());
  await Promise.all([old, logout]);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
