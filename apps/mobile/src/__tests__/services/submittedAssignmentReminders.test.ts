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
  expect(await submittedAssignmentReminderStatus(input)).toEqual([]);
  expect(mockStorage.size).toBe(1);
});

test('撤回後重新確認未繳交，沿用原本選擇的時間排回同一筆通知', async () => {
  await scheduleSubmittedAssignmentReminder(input, ds);
  const identifier = [...mockAlarms.keys()][0];
  ds.getSubmission.mockResolvedValue(receipt);
  await sync();
  ds.getSubmission.mockResolvedValue(null);
  await sync();
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
  await expect(sync()).rejects.toThrow('receipt-unconfirmed');
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
  await sync();
  expect(mockAlarms.size).toBe(1);
  const alarm = [...mockAlarms.values()][0];
  expect(alarm.trigger.date.getTime()).toBeLessThan(Date.now() + 30 * 60_000);
  mockAlarms.clear();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60_000);
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
