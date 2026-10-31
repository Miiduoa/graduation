import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
const mockReader = { getAssignment: jest.fn(), getSubmission: jest.fn() };
jest.mock('../firebase', () => ({
  isFirebaseMockMode: () => false,
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
}));
jest.mock('../data/firebaseSource', () => ({ firebaseSource: mockReader }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
  getAllScheduledNotificationsAsync: async () => [...mockAlarms.values()],
  scheduleNotificationAsync: async (alarm: Alarm) => {
    mockAlarms.set(alarm.identifier, alarm);
    return alarm.identifier;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
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
function snapshot(): CampusSenseSnapshot {
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
      snapshot={snapshot()}
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
  expect(await view.findByText('設定手機本機截止提醒')).toBeTruthy();
  expect(mockAlarms.size).toBe(0);
  mockReader.getSubmission.mockResolvedValue(null);
  await act(async () => reconcileSubmittedAssignmentReminders(scope, current));
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
  const online = render(<Reopened />);
  await waitFor(() => expect(mockAlarms.size).toBe(0));
  online.unmount();
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
  const lastKnown = snapshot();
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
