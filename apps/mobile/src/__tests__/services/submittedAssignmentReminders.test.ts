import {
  scheduleSubmittedAssignmentReminder,
  reconcileSubmittedAssignmentReminders,
  submittedAssignmentReminderStatus,
  cancelSubmittedAssignmentReminder,
  clearSubmittedAssignmentReminders,
} from '../../services/submittedAssignmentReminders';
import type { DataSource } from '../../data/source';

type Alarm = {
  identifier: string;
  content: { data?: Record<string, unknown> };
  trigger: { date: Date };
};
const mockStorage = new Map<string, string>();
const mockAlarms = new Map<string, Alarm>();
let mockUid = 'student';
let mockPermission = true;
jest.mock('../../firebase', () => ({
  isFirebaseMockMode: () => false,
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: async () => [...mockStorage.keys()],
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStorage.delete(key);
    },
    multiRemove: async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    },
  },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('crypto').createHash('sha256').update(value).digest('hex'),
}));
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getPermissionsAsync: async () => ({ granted: mockPermission, canAskAgain: false }),
  getAllScheduledNotificationsAsync: async () => [...mockAlarms.values()],
  scheduleNotificationAsync: async (alarm: Alarm) => {
    mockAlarms.set(alarm.identifier, alarm);
    return alarm.identifier;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    mockAlarms.delete(id);
  },
}));
const scope = { uid: 'student', schoolId: 'school' };
const source = { kind: 'group-assignment' as const, groupId: 'course', assignmentId: 'work' };
const input = { scope, source, leadMinutes: 60 as const, isCurrent: () => true };
const ds = { getAssignment: jest.fn(), getSubmission: jest.fn() };
let dueAt: string;
const receipt = {
  id: 'receipt',
  groupId: 'course',
  assignmentId: 'work',
  userId: 'student',
  submittedAt: '2026-10-01T00:00:00Z',
  status: 'submitted' as const,
};
const sync = () =>
  reconcileSubmittedAssignmentReminders(
    scope,
    () => true,
    ds as Pick<DataSource, 'getAssignment' | 'getSubmission'>,
  );
beforeEach(() => {
  mockStorage.clear();
  mockAlarms.clear();
  mockUid = 'student';
  mockPermission = true;
  jest.clearAllMocks();
  dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  ds.getAssignment.mockResolvedValue({ ...source, id: 'work', title: '報告', dueAt });
  ds.getSubmission.mockResolvedValue(null);
});

test('伺服器確認繳交後，手機不再保留這份作業的通知，其他作業照常提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  mockAlarms.set('calendar', {
    identifier: 'calendar',
    content: {},
    trigger: { date: new Date() },
  });
  ds.getSubmission.mockResolvedValue(receipt);
  await sync();
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
  expect(await submittedAssignmentReminderStatus(input)).toEqual([60]);
  expect(await submittedAssignmentReminderStatus({ ...input, scheduledOnly: true })).toEqual([]);
  expect(mockStorage.size).toBe(1);
});

test('撤回後重新確認未繳交，沿用原本選擇的時間排回同一筆通知', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  const identifier = [...mockAlarms.keys()][0];
  ds.getSubmission.mockResolvedValue(receipt);
  await sync();
  ds.getSubmission.mockResolvedValue(null);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60_000);
  await sync();
  clock.mockRestore();
  expect([...mockAlarms.keys()]).toEqual([identifier]);
  expect([...mockAlarms.values()][0].trigger.date.toISOString()).toBe(
    new Date(Date.parse(dueAt) - 3_600_000).toISOString(),
  );
});

test('截止時間和名稱改變仍是同一份作業，只保留新的提醒時間', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  const identifier = [...mockAlarms.keys()][0];
  const later = new Date(Date.parse(dueAt) + 86_400_000).toISOString();
  ds.getAssignment.mockResolvedValue({ ...source, id: 'work', title: '報告修訂', dueAt: later });
  await sync();
  await sync();
  expect([...mockAlarms.keys()]).toEqual([identifier]);
  const alarm = [...mockAlarms.values()][0];
  expect(alarm.trigger.date.toISOString()).toBe(
    new Date(Date.parse(later) - 3_600_000).toISOString(),
  );
  expect(alarm.content.data).toMatchObject({ ...scope, groupId: 'course', assignmentId: 'work' });
});

test('重新啟動只讀持久偏好和伺服器收據，補取消其他裝置已繳交的提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  jest.resetModules();
  ds.getSubmission.mockResolvedValue(receipt);
  const restarted =
    require('../../services/submittedAssignmentReminders') as typeof import('../../services/submittedAssignmentReminders');
  await restarted.reconcileSubmittedAssignmentReminders(scope, () => true, ds);
  expect(mockAlarms.size).toBe(0);
});

test('離線與尚未確認的繳交紀錄不取消原提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  const original = [...mockAlarms.values()][0];
  ds.getSubmission.mockRejectedValueOnce(new Error('offline'));
  await expect(sync()).rejects.toThrow('offline');
  expect([...mockAlarms.values()]).toEqual([original]);
  ds.getSubmission.mockResolvedValue({ ...receipt, submittedAt: null });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 60_000);
  await expect(sync()).rejects.toThrow('receipt-unconfirmed');
  clock.mockRestore();
  expect([...mockAlarms.values()]).toEqual([original]);
});

test('跨帳號或不符的收據不能取消提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  ds.getSubmission.mockResolvedValue({ ...receipt, userId: 'other' });
  await expect(sync()).rejects.toThrow('receipt-mismatch');
  expect(mockAlarms.size).toBe(1);
  mockUid = 'other';
  await expect(sync()).rejects.toThrow('session-changed');
  expect(mockAlarms.size).toBe(1);
});

test('手動取消會清除偏好，撤回或重開不會偷偷恢復；登出只清自己的提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  await cancelSubmittedAssignmentReminder(input);
  await sync();
  expect(mockAlarms.size).toBe(0);
  await scheduleSubmittedAssignmentReminder(input, ds);
  mockAlarms.set('calendar', {
    identifier: 'calendar',
    content: {},
    trigger: { date: new Date() },
  });
  await clearSubmittedAssignmentReminders();
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
  expect(mockStorage.size).toBe(0);
});

test('截止前撤回時即使原提醒時間已過，仍排回一次提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  ds.getSubmission.mockResolvedValue(receipt);
  await sync();
  ds.getSubmission.mockResolvedValue(null);
  ds.getAssignment.mockResolvedValue({
    ...source,
    id: 'work',
    dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  const resumeClock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60_000);
  await sync();
  resumeClock.mockRestore();
  expect(mockAlarms.size).toBe(1);
  const alarm = [...mockAlarms.values()][0];
  expect(alarm.trigger.date.getTime()).toBeLessThan(Date.now() + 30 * 60_000);
  mockAlarms.clear();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 17 * 60_000);
  await sync();
  expect(mockAlarms.size).toBe(0);
  clock.mockRestore();
});

test('已核對的伺服器收據即使隨後斷線，仍直接取消該作業所有提前時間的提醒', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  await scheduleSubmittedAssignmentReminder({ ...input, leadMinutes: 1440 }, ds);
  ds.getAssignment.mockRejectedValue(new Error('offline'));
  ds.getSubmission.mockRejectedValue(new Error('offline'));
  const { reconcileSubmittedAssignmentReceipt } =
    require('../../services/submittedAssignmentReminders') as typeof import('../../services/submittedAssignmentReminders');
  await reconcileSubmittedAssignmentReceipt(receipt);
  expect(mockAlarms.size).toBe(0);
  expect(mockStorage.size).toBe(2);
});


test('兩種提前時間共用作業與收據讀取，已繳偏好在間隔內不再讀取', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  await scheduleSubmittedAssignmentReminder({ ...input, leadMinutes: 1440 }, ds);
  jest.clearAllMocks();
  ds.getSubmission.mockResolvedValue(receipt);
  await sync();
  expect(ds.getAssignment).toHaveBeenCalledTimes(1);
  expect(ds.getSubmission).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) await sync();
  expect(ds.getSubmission).toHaveBeenCalledTimes(1);
});

test('歷史偏好截止七天後清理，不再讀伺服器或重排', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  jest.clearAllMocks();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(dueAt) + 8 * 86_400_000);
  await sync();
  await sync();
  expect(ds.getAssignment).not.toHaveBeenCalled();
  expect(ds.getSubmission).not.toHaveBeenCalled();
  expect(mockStorage.size).toBe(0);
  expect(mockAlarms.size).toBe(0);
  clock.mockRestore();
});

test('離線採取退避但不移除已排通知，三十天後清理不再重試', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  jest.clearAllMocks();
  ds.getAssignment.mockRejectedValue(new Error('offline'));
  await expect(sync()).rejects.toThrow('offline');
  for (let i = 0; i < 10; i++) await sync();
  expect(ds.getAssignment).toHaveBeenCalledTimes(1);
  expect(mockAlarms.size).toBe(1);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 86_400_000);
  await sync();
  expect(mockStorage.size).toBe(0);
  expect(mockAlarms.size).toBe(0);
  clock.mockRestore();
});

test('活躍偏好有容量限制，歷史資料每輪最多核對三十二份且輪流處理', async () => {
  for (let i = 0; i < 32; i++) {
    const assignmentId = `work-${i}`;
    ds.getAssignment.mockResolvedValue({ id: assignmentId, groupId: 'course', dueAt });
    await scheduleSubmittedAssignmentReminder({ ...input, source: { ...source, assignmentId } }, ds);
  }
  await expect(scheduleSubmittedAssignmentReminder({ ...input, source: { ...source, assignmentId: 'extra' } }, ds))
    .rejects.toThrow('device-capacity');
  ds.getAssignment.mockImplementation(async (id: string) => ({ id, groupId: 'course', dueAt }));
  jest.clearAllMocks();
  await sync();
  expect(ds.getAssignment).toHaveBeenCalledTimes(32);
});


test('保留大量歷史資料升級後，核對集合有界且不讓後面的作業餓死', async () => {
  for (let i = 0; i < 80; i++) {
    const assignmentId = `history-${i}`;
    const digest = require('crypto').createHash('sha256')
      .update(JSON.stringify([scope.uid, scope.schoolId, source.groupId, assignmentId, 60])).digest('hex');
    const identifier = `assignment-due.v2.${digest}`;
    mockStorage.set(`@assignment-due:v2:${identifier}`, JSON.stringify({
      ...scope, ...source, assignmentId, identifier, leadMinutes: 60,
      lastDueAt: i < 40 ? Date.now() - 8 * 86_400_000 : Date.parse(dueAt),
    }));
  }
  ds.getAssignment.mockImplementation(async (id: string) => ({ id, groupId: 'course', dueAt }));
  ds.getSubmission.mockImplementation(async (id: string) => ({ ...receipt, assignmentId: id }));
  await sync();
  expect(mockStorage.size).toBe(40);
  expect(ds.getAssignment).toHaveBeenCalledTimes(32);
  await sync();
  expect(ds.getAssignment).toHaveBeenCalledTimes(40);
  expect(new Set(ds.getAssignment.mock.calls.map(([id]) => id)).size).toBe(40);
});
