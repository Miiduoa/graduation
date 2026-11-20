import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { LegacyAssignmentReminders } from '../screens/LegacyAssignmentReminders';
import { CampusAssignmentReminderAction } from '../screens/CampusAssignmentReminderAction';
import { reconcileSubmittedAssignmentReminders } from '../services/submittedAssignmentReminders';
import { useSubmittedAssignmentReminders } from '../app/useSubmittedAssignmentReminders';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import type { CampusPlanStep } from '../services/offlineCampusPlanner';
import { AppState } from 'react-native';

type Alarm = {
  identifier: string;
  content: { data?: Record<string, unknown> };
  trigger: { date: Date };
};
const mockStorage = new Map<string, string>();
const mockAlarms = new Map<string, Alarm>();
let mockScheduleFailure = false;
let mockCancelFailure = false;
const mockReader = { getAssignment: jest.fn(), getSubmission: jest.fn() };
jest.mock('../firebase', () => ({
  isFirebaseMockMode: () => false,
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
}));
jest.mock('../services/campusSenseSnapshot', () => ({
  ...jest.requireActual('../services/campusSenseSnapshot'),
  refreshCampusSenseSnapshot: jest.fn(async () => mockSnapshot()),
}));
jest.mock('../data/firebaseSource', () => ({ firebaseSource: mockReader }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: async (key: string) => {
      mockStorage.delete(key);
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
  getPermissionsAsync: async () => ({ granted: true }),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...mockAlarms.values()]),
  scheduleNotificationAsync: async (alarm: Alarm) => {
    if (mockScheduleFailure) throw new Error('native failure');
    mockAlarms.set(alarm.identifier, alarm);
    return alarm.identifier;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    if (mockCancelFailure) return;
    mockAlarms.delete(id);
  },
}));
const current = () => true;
const scope = { uid: 'alice', schoolId: 'pu' };
const source = { kind: 'group-assignment' as const, groupId: 'course', assignmentId: 'work' };
const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
const step: CampusPlanStep = {
  id: 'display-0',
  title: '期末報告',
  groupName: '資料庫',
  dueAt,
  detail: '請核對',
  priority: 'normal',
  evidence: 'authorized-assignments',
  route: '/classroom',
};
function mockSnapshot(): CampusSenseSnapshot {
  return {
    userId: 'alice',
    schoolId: 'pu',
    checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'unavailable', items: [] },
    assignments: {
      status: 'available',
      count: 1,
      items: [{ title: step.title, groupName: '資料庫', dueAt, source }],
    },
  };
}
function Reminder() {
  return (
    <CampusAssignmentReminderAction
      step={step}
      snapshot={mockSnapshot()}
      userId="alice"
      schoolId="pu"
      disabled={false}
      isCurrent={current}
    />
  );
}
function Reopened() {
  useSubmittedAssignmentReminders('alice', 'pu');
  return null;
}
beforeEach(() => {
  mockScheduleFailure = false;
  mockCancelFailure = false;
  mockStorage.clear();
  mockAlarms.clear();
  jest.clearAllMocks();
  mockReader.getAssignment.mockResolvedValue({
    id: 'work',
    groupId: 'course',
    title: '期末報告',
    dueAt,
  });
  mockReader.getSubmission.mockResolvedValue(null);
});
async function optIn() {
  const view = render(<Reminder />);
  await waitFor(() => expect(view.queryByText('正在核對手機已設定的提醒…')).toBeNull());
  fireEvent.press(view.getByText('設定手機本機截止提醒'));
  fireEvent.press(view.getByText('確認設定本機提醒'));
  expect(await view.findByText('已設定截止前 1 小時提醒')).toBeTruthy();
  return view;
}
test('使用者設定提醒，伺服器確認已繳後取消；撤回後恢復原提醒', async () => {
  let view = await optIn();
  expect(mockAlarms.size).toBe(1);
  mockReader.getSubmission.mockResolvedValue({
    id: 'alice',
    userId: 'alice',
    groupId: 'course',
    assignmentId: 'work',
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  });
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  view.unmount();
  view = render(<Reminder />);
  expect(await view.findByText('已保留提醒偏好，目前暫停通知')).toBeTruthy();
  expect(mockAlarms.size).toBe(0);
  mockReader.getSubmission.mockResolvedValue(null);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60_000);
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  clock.mockRestore();
  view.unmount();
  view = render(<Reminder />);
  expect(await view.findByText('已設定截止前 1 小時提醒')).toBeTruthy();
  expect(mockAlarms.size).toBe(1);
});
test('App 重開時重新核對伺服器；讀不到收據時仍保留已設定提醒', async () => {
  const view = await optIn();
  view.unmount();
  AppState.currentState = 'active';
  mockReader.getSubmission.mockRejectedValue(new Error('offline'));
  const reopened = render(<Reopened />);
  await waitFor(() => expect(mockReader.getSubmission).toHaveBeenCalledTimes(2));
  expect(mockAlarms.size).toBe(1);
  reopened.unmount();
  mockReader.getSubmission.mockResolvedValue({
    id: 'alice',
    userId: 'alice',
    groupId: 'course',
    assignmentId: 'work',
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 60_000);
  const online = render(<Reopened />);
  await waitFor(() => expect(mockAlarms.size).toBe(0));
  online.unmount();
  clock.mockRestore();
  jest.restoreAllMocks();
});

test('截止時間變更後，畫面仍是同一份提醒，手機只保留更新後的時間', async () => {
  const view = await optIn();
  const identifier = [...mockAlarms.keys()][0];
  const newDue = new Date(Date.parse(dueAt) + 86_400_000).toISOString();
  mockReader.getAssignment.mockResolvedValue({
    id: 'work',
    groupId: 'course',
    title: '期末報告修訂',
    dueAt: newDue,
  });
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  expect(view.getByText('已設定截止前 1 小時提醒')).toBeTruthy();
  expect([...mockAlarms.keys()]).toEqual([identifier]);
  expect(mockAlarms.get(identifier).trigger.date.toISOString()).toBe(
    new Date(Date.parse(newDue) - 3_600_000).toISOString(),
  );
  view.unmount();
});

test('已設定提醒後摘要過期，仍能依最後核對的作業 ID 取消原提醒', async () => {
  const lastKnown = mockSnapshot();
  const view = await optIn();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  const { cancelCampusAssignmentReminder } =
    require('../services/campusAssignmentReminders') as typeof import('../services/campusAssignmentReminders');
  await act(async () =>
    cancelCampusAssignmentReminder({
      scope,
      step,
      snapshot: lastKnown,
      leadMinutes: 60,
      isCurrent: current,
    }),
  );
  expect(mockAlarms.size).toBe(0);
  clock.mockRestore();
  view.unmount();
});


test('保留舊版排程與資料升級後能看到、去重並在確認繳交後全部取消', async () => {
  const { scheduleCampusAssignmentReminder, getCampusAssignmentReminderStatus } =
    require('../services/campusAssignmentReminders') as typeof import('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  for (const leadMinutes of [60, 1440] as const)
    await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes, isCurrent: current });
  expect(mockAlarms.size).toBe(2);
  const view = render(<Reminder />);
  expect(await view.findByText('已設定截止前 1 小時提醒')).toBeTruthy();
  await act(async () => scheduleCampusAssignmentReminder({ scope, step, snapshot: mockSnapshot(), leadMinutes: 60, isCurrent: current }));
  expect(mockAlarms.size).toBe(2);
  mockReader.getSubmission.mockResolvedValue({
    id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work',
    status: 'submitted', submittedAt: new Date().toISOString(),
  });
  const { reconcileSubmittedAssignmentReceipt } = require('../services/submittedAssignmentReminders');
  await act(async () => reconcileSubmittedAssignmentReceipt(await mockReader.getSubmission()));
  expect(mockAlarms.size).toBe(0);
  expect(await getCampusAssignmentReminderStatus({ scope, step, snapshot: mockSnapshot(), isCurrent: current })).toEqual([60, 1440]);
  view.unmount();
});

test('已繳暫停後可從畫面退訂兩種偏好，撤回、延期與重開不會復活', async () => {
  let view = await optIn();
  const { scheduleSubmittedAssignmentReminder } = require('../services/submittedAssignmentReminders');
  await act(async () => scheduleSubmittedAssignmentReminder({ scope, source, leadMinutes: 1440, isCurrent: current }));
  mockReader.getSubmission.mockResolvedValue({
    id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work',
    status: 'submitted', submittedAt: new Date().toISOString(),
  });
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  view.unmount();
  view = render(<Reminder />);
  expect(await view.findByText('已保留提醒偏好，目前暫停通知')).toBeTruthy();
  fireEvent.press(view.getByText('取消這項本機提醒'));
  await view.findByText('已退訂並清除提醒偏好，撤回或延期後也不會自動恢復。');
  expect([...mockStorage.keys()].filter((key) => key.startsWith('@assignment-due:v2:'))).toEqual([]);
  mockReader.getSubmission.mockResolvedValue(null);
  mockReader.getAssignment.mockResolvedValue({ id: 'work', groupId: 'course', dueAt: new Date(Date.parse(dueAt) + 86_400_000).toISOString() });
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  view.unmount();
  view = render(<Reminder />);
  expect(await view.findByText('設定手機本機截止提醒')).toBeTruthy();
  expect(mockAlarms.size).toBe(0);
  view.unmount();
});


test('舊版提醒升級後可直接從畫面取消，個人行事曆不受影響', async () => {
  const { scheduleCampusAssignmentReminder } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  mockAlarms.set('calendar', { identifier: 'calendar', content: {}, trigger: { date: new Date() } });
  const view = render(<Reminder />);
  expect(await view.findByText('已設定截止前 1 小時提醒')).toBeTruthy();
  fireEvent.press(view.getByText('取消這項本機提醒'));
  await view.findByText('已退訂並清除提醒偏好，撤回或延期後也不會自動恢復。');
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
  view.unmount();
});

test('改名或改期而無法還原的舊提醒有明確管理入口，清理前阻止重複新增', async () => {
  const { scheduleCampusAssignmentReminder } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  const changed = mockSnapshot();
  changed.assignments.items[0].title = '報告改名';
  const changedStep = { ...step, title: '報告改名' };
  await expect(scheduleCampusAssignmentReminder({ scope, step: changedStep, snapshot: changed, leadMinutes: 60, isCurrent: current }))
    .rejects.toThrow('legacy-cleanup-required');
  const view = render(<LegacyAssignmentReminders uid="alice" schoolId="pu" snapshot={changed} isCurrent={current} />);
  expect(await view.findByText(/這台手機有 1 筆尚未辨識/)).toBeTruthy();
  fireEvent.press(view.getByText('取消所有未辨識的舊版作業提醒'));
  await waitFor(() => expect(mockAlarms.size).toBe(0));
  await scheduleCampusAssignmentReminder({ scope, step: changedStep, snapshot: changed, leadMinutes: 60, isCurrent: current });
  expect(mockAlarms.size).toBe(1);
  view.unmount();
});


test('舊版轉換的新排程失敗時仍保留原排程與可取消的偏好', async () => {
  const { scheduleCampusAssignmentReminder, getCampusAssignmentReminderStatus } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  const oldIds = [...mockAlarms.keys()];
  mockScheduleFailure = true;
  await expect(scheduleCampusAssignmentReminder({ scope, step, snapshot: mockSnapshot(), leadMinutes: 60, isCurrent: current }))
    .rejects.toThrow('native failure');
  mockScheduleFailure = false;
  expect([...mockAlarms.keys()]).toEqual(oldIds);
  expect(await getCampusAssignmentReminderStatus({ scope, step, snapshot: mockSnapshot(), isCurrent: current })).toEqual([60]);
});


test('摘要已不再包含已繳作業時，管理入口仍能退訂所有保留偏好', async () => {
  const view = await optIn();
  mockReader.getSubmission.mockResolvedValue({
    id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work',
    status: 'submitted', submittedAt: new Date().toISOString(),
  });
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
  view.unmount();
  const manager = render(<LegacyAssignmentReminders uid="alice" schoolId="pu" snapshot={null} isCurrent={current} />);
  const button = await manager.findByText('退訂期末報告的所有提醒');
  fireEvent.press(button);
  await waitFor(() => expect(mockStorage.size).toBe(0));
  expect(mockAlarms.size).toBe(0);
  manager.unmount();
});


test('原生取消未生效時明確失敗並保留偏好，重試確認後才清除', async () => {
  const { scheduleCampusAssignmentReminder, cancelCampusAssignmentReminder, getCampusAssignmentReminderStatus } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  await getCampusAssignmentReminderStatus({ scope, step, snapshot: mockSnapshot(), isCurrent: current });
  mockCancelFailure = true;
  await expect(cancelCampusAssignmentReminder({ scope, step, snapshot: mockSnapshot(), leadMinutes: 60, isCurrent: current }))
    .rejects.toThrow('cancel-unconfirmed');
  expect(mockAlarms.size).toBe(1);
  expect(await getCampusAssignmentReminderStatus({ scope, step, snapshot: mockSnapshot(), isCurrent: current })).toEqual([60]);
  mockCancelFailure = false;
  await cancelCampusAssignmentReminder({ scope, step, snapshot: mockSnapshot(), leadMinutes: 60, isCurrent: current });
  expect(mockAlarms.size).toBe(0);
  expect(mockStorage.size).toBe(0);
});

test('升級後未開助理直接繳交，兩種舊提醒都會配對取消且保留其他通知', async () => {
  const { scheduleCampusAssignmentReminder, prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  for (const leadMinutes of [60, 1440])
    await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes, isCurrent: current });
  mockAlarms.set('calendar', { identifier: 'calendar', content: {}, trigger: { date: new Date() } });
  await prepareAssignmentReminderSubmission('alice', async () => 'pu');
  const { reconcileSubmittedAssignmentReceipt } = require('../services/submittedAssignmentReminders');
  await reconcileSubmittedAssignmentReceipt({
    id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work',
    status: 'submitted', submittedAt: new Date().toISOString(),
  });
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
  await reconcileSubmittedAssignmentReminders(scope, current);
  expect([...mockAlarms.keys()]).toEqual(['calendar']);
});

test('繳交前配對遇到改名或不完整摘要，不猜測取消並提示舊提醒管理', async () => {
  const { scheduleCampusAssignmentReminder, prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  const ids = [...mockAlarms.keys()];
  const { refreshCampusSenseSnapshot } = require('../services/campusSenseSnapshot');
  const partial = mockSnapshot();
  partial.assignments.coverage = { complete: false, reason: 'read-budget', pages: 8 };
  refreshCampusSenseSnapshot.mockResolvedValueOnce(partial);
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('舊版作業提醒管理');
  expect([...mockAlarms.keys()]).toEqual(ids);
  const renamed = mockSnapshot();
  renamed.assignments.items[0].title = '已改名';
  refreshCampusSenseSnapshot.mockResolvedValueOnce(renamed);
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('舊版作業提醒管理');
  expect([...mockAlarms.keys()]).toEqual(ids);
});


test.each(['native', 'storage'])('空提醒的讀取故障只警告，恢復後可重試：%s', async (kind) => {
  const { prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const storage = require('@react-native-async-storage/async-storage').default;
  const notifications = require('expo-notifications');
  const read = kind === 'native' ? notifications.getAllScheduledNotificationsAsync : storage.getAllKeys;
  read.mockRejectedValueOnce(new Error('temporary failure'));
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('重試');
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toBeUndefined();
});

test('摘要服務故障保留未知提醒，稍後可重試配對並依收據取消', async () => {
  const { scheduleCampusAssignmentReminder, prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  const ids = [...mockAlarms.keys()];
  const { refreshCampusSenseSnapshot } = require('../services/campusSenseSnapshot');
  refreshCampusSenseSnapshot.mockRejectedValueOnce(new Error('unavailable'));
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('重試');
  expect([...mockAlarms.keys()]).toEqual(ids);
  await prepareAssignmentReminderSubmission('alice', async () => 'pu');
  const { reconcileSubmittedAssignmentReceipt } = require('../services/submittedAssignmentReminders');
  await reconcileSubmittedAssignmentReceipt({ id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work', status: 'submitted', submittedAt: new Date().toISOString() });
  expect(mockAlarms.size).toBe(0);
});


test('本作業可配對時仍保留另一份未知舊提醒，收據只取消本作業', async () => {
  const { scheduleCampusAssignmentReminder, prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  const other = { ...step, title: '另一份已改名作業' };
  const otherSnapshot = mockSnapshot();
  otherSnapshot.assignments.items = [{ ...previous.assignments.items[0], title: other.title }];
  await scheduleCampusAssignmentReminder({ scope, step: other, snapshot: otherSnapshot, leadMinutes: 60, isCurrent: current });
  const otherIds = [...mockAlarms.keys()];
  for (const leadMinutes of [60, 1440])
    await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes, isCurrent: current });
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('仍可能響鈴');
  const { reconcileSubmittedAssignmentReceipt } = require('../services/submittedAssignmentReminders');
  await reconcileSubmittedAssignmentReceipt({ id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work', status: 'submitted', submittedAt: new Date().toISOString() });
  expect([...mockAlarms.keys()]).toEqual(otherIds);
});

test('舊提醒配對儲存失敗只警告且保留排程，恢復後可重試取消', async () => {
  const { scheduleCampusAssignmentReminder, prepareAssignmentReminderSubmission } = require('../services/campusAssignmentReminders');
  const previous = mockSnapshot();
  delete previous.assignments.items[0].source;
  await scheduleCampusAssignmentReminder({ scope, step, snapshot: previous, leadMinutes: 60, isCurrent: current });
  const ids = [...mockAlarms.keys()];
  const storage = require('@react-native-async-storage/async-storage').default;
  storage.setItem.mockRejectedValueOnce(new Error('write unavailable'));
  await expect(prepareAssignmentReminderSubmission('alice', async () => 'pu')).resolves.toContain('重試');
  expect([...mockAlarms.keys()]).toEqual(ids);
  await prepareAssignmentReminderSubmission('alice', async () => 'pu');
  const { reconcileSubmittedAssignmentReceipt } = require('../services/submittedAssignmentReminders');
  await reconcileSubmittedAssignmentReceipt({ id: 'alice', userId: 'alice', groupId: 'course', assignmentId: 'work', status: 'submitted', submittedAt: new Date().toISOString() });
  expect(mockAlarms.size).toBe(0);
});
