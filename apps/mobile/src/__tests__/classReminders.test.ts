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
test.each(['cancel', 'room', 'move'] as const)('%s does not schedule a second period/clock copy', async (kind) => {
  const imported = { ...row, startTime: '09:10' };
  const manual = { ...row, id: 'manual:period', startTime: undefined, endTime: undefined, startPeriod: 2, endPeriod: 4 };
  const records = withClassExceptions([manual, imported], [{ id: 'change', original: imported,
    courseKey: classMeetingKey(imported), originalDate: '2026-11-02', kind, createdAt: '',
    ...(kind === 'room' ? { location: '新教室' } : {}),
    ...(kind === 'move' ? { date: '2026-11-03', startTime: '18:00', endTime: '20:00' } : {}) }]);
  await setClassRemindersEnabled('synthetic', true);
  await refreshClassReminders('synthetic', async () => ({ records, schoolId: 'pu' }), now);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(kind === 'cancel' ? 0 : 1);
  if (kind === 'room') expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ body: '10 分鐘後上課 · 新教室' }) }));
});

test('an overnight reminder includes conflicts that occur only after midnight', async () => {
  const records = withClassExceptions([row, { ...row, id: 'wednesday', title: '凌晨課', dayOfWeek: 3, startTime: '00:30', endTime: '01:30' }], [{
    id: 'overnight', original: row, courseKey: classMeetingKey(row), originalDate: '2026-11-02', kind: 'move', createdAt: '',
    date: '2026-11-03', endDate: '2026-11-04', startTime: '23:30', endTime: '01:00',
  }]);
  await setClassRemindersEnabled('synthetic', true);
  await refreshClassReminders('synthetic', async () => ({ records, schoolId: 'pu' }), new Date('2026-10-28T08:00:00+08:00'));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: '合成課程', body: expect.stringContaining('時間重疊') }) }));
});

describe('reconciling the reminders on the device', () => {
  const category = 'personal_class_occurrence';
  const unrelated = { data: { category: 'another-feature' } };
  const inventory = new Map<string, Notifications.NotificationContentInput>();
  const schedule = jest.mocked(Notifications.scheduleNotificationAsync);
  const cancel = jest.mocked(Notifications.cancelScheduledNotificationAsync);

  beforeEach(async () => {
    inventory.clear();
    inventory.set('unrelated', unrelated);
    let nextId = 0;
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () =>
      Array.from(inventory, ([identifier, content]) => ({ identifier, content })) as Notifications.NotificationRequest[],
    );
    schedule.mockImplementation(async (request) => {
      const identifier = request.identifier ?? `os-${++nextId}`;
      inventory.set(identifier, request.content);
      return identifier;
    });
    cancel.mockImplementation(async (id) => { inventory.delete(id); });
    await setClassRemindersEnabled('synthetic', true);
  });

  test('a failed read preserves current reminders and a retry removes a cancelled occurrence', async () => {
    await refreshClassReminders('synthetic', read, now);
    const [current] = [...inventory.keys()].filter((id) => id !== 'unrelated');
    expect(current).toBeDefined();
    const currentAlarm = inventory.get(current)!;
    inventory.set('foreign', { ...currentAlarm, data: { ...currentAlarm.data, scope: 'other' } });
    inventory.set('legacy-unscoped', { data: { category } });

    const offline = jest.fn(async () => { throw new Error('offline'); });
    await refreshClassReminders('synthetic', offline, now).catch(() => undefined);
    expect(offline).toHaveBeenCalledTimes(1);
    expect([...inventory.keys()]).toEqual(['unrelated', current]);
    expect(cancel).not.toHaveBeenCalledWith(current);

    const records = withClassExceptions([row], [{
      id: 'stop', courseKey: classMeetingKey(row), original: row, originalDate: '2026-11-02',
      kind: 'cancel', createdAt: '',
    }]);
    await refreshClassReminders('synthetic', async () => ({ records, schoolId: 'pu' }), now);
    expect([...inventory.entries()]).toEqual([['unrelated', unrelated]]);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  test('an unchanged refresh leaves the native request in place and a room change replaces it by ID', async () => {
    await refreshClassReminders('synthetic', read, now);
    const [id] = [...inventory.keys()].filter((key) => key !== 'unrelated');
    schedule.mockClear();
    cancel.mockClear();

    await refreshClassReminders('synthetic', read, now);
    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(inventory.get(id)?.data).toEqual(expect.objectContaining({
      scope: 'synthetic', courseId: row.id, startAt: new Date('2026-11-02T09:00:00+08:00').getTime(),
    }));

    await refreshClassReminders('synthetic', async () => ({
      records: [{ ...row, location: '新教室' }], schoolId: 'pu',
    }), now);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      identifier: id, content: expect.objectContaining({ body: '10 分鐘後上課 · 新教室' }),
    }));
    expect(cancel).not.toHaveBeenCalled();
    expect([...inventory.keys()]).toEqual(['unrelated', id]);
  });

  test.each(['disabled', 'revoked', 'logout'] as const)('%s clears only class reminders without reading the timetable', async (reason) => {
    inventory.set('current', { data: { category, scope: 'synthetic' } });
    inventory.set('foreign', { data: { category, scope: 'other' } });
    if (reason === 'disabled') await setClassRemindersEnabled('synthetic', false);
    if (reason === 'revoked') {
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
        granted: false,
      } as Notifications.NotificationPermissionsStatus);
    }
    const readTimetable = jest.fn(read);
    await refreshClassReminders(reason === 'logout' ? null : 'synthetic', readTimetable, now);
    expect([...inventory.entries()]).toEqual([['unrelated', unrelated]]);
    expect(readTimetable).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  test('a native write finishing after logout revokes its own alarm even if inventory cannot be read', async () => {
    const nativeSchedule = schedule.getMockImplementation()!;
    let started!: () => void;
    let finish!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const release = new Promise<void>((resolve) => { finish = resolve; });
    schedule.mockImplementationOnce(async (request) => {
      started();
      await release;
      return nativeSchedule(request);
    });
    const stale = refreshClassReminders('synthetic', read, now);
    await writing;

    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockRejectedValueOnce(new Error('unavailable'));
    const logout = refreshClassReminders(null).catch(() => undefined);
    finish();
    await Promise.all([stale, logout]);

    const id = await schedule.mock.results[0].value;
    expect(cancel.mock.calls).toEqual([[id]]);
    expect([...inventory.entries()]).toEqual([['unrelated', unrelated]]);
  });

  test('logout and the next account finish while an earlier timetable read is still pending', async () => {
    await refreshClassReminders('synthetic', read, now);
    let finish!: (data: Awaited<ReturnType<typeof read>>) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    const stale = refreshClassReminders('synthetic', () => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    }, now);
    await reading;

    let loggedOut = false;
    const logout = refreshClassReminders(null).then(() => { loggedOut = true; });
    // The mocked OS and storage operations settle in microtasks; the timetable deliberately does not.
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(loggedOut).toBe(true);
      expect([...inventory.entries()]).toEqual([['unrelated', unrelated]]);
      await setClassRemindersEnabled('other', true);
      const next = refreshClassReminders('other', read, now);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect([...inventory.values()].map((alarm) => alarm.data?.scope)).toEqual([undefined, 'other']);
      await next;
      schedule.mockClear();
      cancel.mockClear();
    } finally {
      finish(await read());
      await Promise.all([stale, logout]);
    }
    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect([...inventory.values()].map((alarm) => alarm.data?.scope)).toEqual([undefined, 'other']);
  });
});
