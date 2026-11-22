import React from 'react';
import { AssignmentReplyActions } from '../screens/AssignmentReplyActions';
import { CampusEvidencePlanCard } from '../screens/CampusEvidencePlanCard';
import {
  adoptCampusReminderSnapshot, cancelCampusAssignmentReminder, clearUnlinkedLegacyReminders,
  getCampusAssignmentReminderStatus, scheduleCampusAssignmentReminder, unlinkedLegacyReminders,
} from '../services/campusAssignmentReminders';
import { resolveCampusAssignmentTarget } from '../services/campusAssignmentTarget';
import * as base from './fixtures/campusAssignmentMergeBase';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { LegacyAssignmentReminders } from '../screens/LegacyAssignmentReminders';
import { CampusAssignmentReminderAction } from '../screens/CampusAssignmentReminderAction';
import { reconcileSubmittedAssignmentReminders, scheduleSubmittedAssignmentReminder } from '../services/submittedAssignmentReminders';
import { useSubmittedAssignmentReminders } from '../app/useSubmittedAssignmentReminders';
import { ASSIGNMENT_SUMMARY_TITLE_LIMIT, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { buildOfflineCampusPlan, type CampusPlanStep } from '../services/offlineCampusPlanner';
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
const mockSenseCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockSenseCallable }));
jest.mock('../firebase', () => ({
  isFirebaseMockMode: () => false,
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
  getFunctionsInstance: () => ({}),
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

function planCard(snapshot: CampusSenseSnapshot) {
  const plan = buildOfflineCampusPlan({
    question: '安排未來七天作業計畫',
    uid: scope.uid,
    snapshot,
    context: {
      checkedAt: snapshot.checkedAt,
      schoolId: scope.schoolId,
      schoolName: '靜宜大學',
      timetable: { source: 'not-available', updatedAt: null, courses: [] },
    },
  });
  if (!plan) throw new Error('Expected an assignment plan');
  const navigation = { navigate: jest.fn() };
  const card = (currentSnapshot: CampusSenseSnapshot | null, owner = scope) => <CampusEvidencePlanCard
    plan={plan} disabled={false} navigation={navigation}
    reminderContext={{ userId: owner.uid, schoolId: owner.schoolId, snapshot: currentSnapshot, isCurrent: current }} />;
  return { plan, navigation, card, view: render(card(snapshot)) };
}

test('計畫卡可開啟唯一的 134 字作業', () => {
  const snapshot = mockSnapshot();
  const title = '長'.repeat(130) + '期末報告';
  snapshot.assignments.items[0].title = title;
  mockReader.getAssignment.mockResolvedValue({ id: 'work', groupId: 'course', title, dueAt });
  const { plan, view, navigation } = planCard(snapshot);
  expect(plan.steps[0].title).toBe(title.slice(0, 130));
  fireEvent.press(view.getAllByText('查看這份作業')[0]);
  expect(navigation.navigate).toHaveBeenCalledWith('學習', {
    initial: false,
    screen: 'HomeworkSubmit',
    params: { groupId: 'course', assignmentId: 'work' },
  });
});

test.each([
  ['長'.repeat(130), 0],
  ['長'.repeat(130), 1_000],
  ['資料庫作業：' + '正規化與索引實作'.repeat(4), 1_000],
])('同名課程的作業須能唯一比對才開啟並顯示完整標題（前綴=%s，截止差=%i 毫秒）', (prefix, dueOffset) => {
  const snapshot = mockSnapshot();
  const dueMinute = Math.floor(Date.parse(dueAt) / 60_000) * 60_000;
  const rows = ['第 1 題', '第 2 題', '第 3 題'].map((suffix, index) => ({
    title: prefix + '｜' + suffix,
    groupName: '資料庫',
    dueAt: new Date(dueMinute + index * dueOffset).toISOString(),
    source: { ...source, groupId: dueOffset ? 'course-' + index : source.groupId, assignmentId: 'work-' + index },
  }));
  snapshot.assignments.items = rows;
  snapshot.assignments.count = rows.length;
  const { plan, view, navigation } = planCard(snapshot);
  const targets = plan.steps.map((assignment) => base.resolveCampusAssignmentTarget({ assignment, snapshot, scope }));
  expect(targets.every(Boolean)).toBe(dueOffset !== 0);
  const buttons = view.queryAllByText('查看這份作業');
  expect(buttons).toHaveLength(targets.filter(Boolean).length);
  for (const [index, row] of rows.entries()) {
    if (!targets[index]) {
      expect(view.queryByText(row.title)).toBeNull();
      expect(view.getAllByText(plan.steps[index].title)).toHaveLength(rows.length);
      continue;
    }
    expect(view.getAllByText(row.title).some((node) => node.props.numberOfLines == null)).toBe(true);
    fireEvent.press(buttons[index]);
    expect(navigation.navigate).toHaveBeenLastCalledWith('學習', {
      initial: false,
      screen: 'HomeworkSubmit',
      params: { groupId: row.source.groupId, assignmentId: row.source.assignmentId },
    });
  }
});

test.each([false, true])('完整標題碰撞時拒絕作業交辦（反序=%s）', (reverse) => {
  const snapshot = mockSnapshot();
  const title = '長'.repeat(130) + '後綴';
  snapshot.assignments.items[0].title = title;
  snapshot.assignments.items.push({
    ...snapshot.assignments.items[0], title, source: { ...source, assignmentId: 'other' },
  });
  snapshot.assignments.count = 2;
  if (reverse) snapshot.assignments.items.reverse();
  const { view } = planCard(snapshot);
  expect(view.queryByText('查看這份作業')).toBeNull();
});

test.each([
  { initialTitle: '長'.repeat(129) + ' 原稿', title: '長'.repeat(129) + ' 新版', assignmentId: 'other', opens: false },
  { initialTitle: '長'.repeat(130) + '原稿', title: '長'.repeat(130) + '新版', assignmentId: 'other', opens: true },
  { initialTitle: '長'.repeat(130) + '原稿', title: '長'.repeat(130), assignmentId: 'other', opens: true },
  { initialTitle: '長'.repeat(130) + '原稿', title: '長'.repeat(130) + '新版', assignmentId: 'work', opens: true },
  { initialTitle: '長'.repeat(139) + ' ', title: '長'.repeat(139), assignmentId: 'work', opens: true },
  { initialTitle: '短標題原稿', title: '短標題原稿', assignmentId: 'other', opens: true },
])('同步後依原有條件顯示查看作業按鈕（案例 %#）', async ({ initialTitle, title, assignmentId, opens }) => {
  const { refreshCampusSenseSnapshot } = jest.requireActual<typeof import('../services/campusSenseSnapshot')>(
    '../services/campusSenseSnapshot',
  );
  const seed = mockSnapshot();
  async function sync(title: string, assignmentId: string) {
    const items = [{ ...seed.assignments.items[0], title, source: { ...source, assignmentId } }];
    mockSenseCallable.mockResolvedValueOnce({ data: { ...seed, assignments: { ...seed.assignments, items } } });
    return refreshCampusSenseSnapshot({ scope, isCurrent: current });
  }
  const initial = await sync(initialTitle, source.assignmentId);
  const { plan, card, view, navigation } = planCard(initial);
  const snapshot = await sync(title, assignmentId);
  if (initialTitle === title + ' ') {
    expect(initial.assignments.items[0].title).toBe(snapshot.assignments.items[0].title);
    expect(initial.assignments.items[0].titleMayBeTruncated).toBe(true);
    expect(snapshot.assignments.items[0].titleMayBeTruncated).toBeUndefined();
  }
  const baseline = base.resolveCampusAssignmentTarget({ assignment: plan.steps[0], snapshot, scope });
  expect(Boolean(baseline)).toBe(opens);
  await act(async () => view.rerender(card(snapshot)));

  if (initialTitle !== title && initialTitle !== plan.steps[0].title) {
    expect(view.queryByText(initialTitle)).toBeNull();
    expect(view.getByText(plan.steps[0].title)).toBeTruthy();
  }
  const button = view.queryByText('查看這份作業');
  expect(Boolean(button)).toBe(opens);
  if (button && baseline) {
    fireEvent.press(button);
    expect(navigation.navigate).toHaveBeenCalledWith('學習', {
      initial: false, screen: baseline.route, params: baseline.params,
    });
  }
});

const displayTitleCases = [129, 130, 131, 139, 140, 141].flatMap((length) =>
  [false, true].flatMap((initialMarked) =>
    [false, true].flatMap((currentMarked) =>
      [false, true].flatMap((titleChanged) =>
        [false, true].flatMap((idChanged) =>
          [1, 2].map((count) => ({ length, initialMarked, currentMarked, titleChanged, idChanged, count })))))));

test.each(displayTitleCases)(
  '計畫卡差異矩陣 長度=$length 原始截斷=$initialMarked 同步截斷=$currentMarked 改名=$titleChanged 換ID=$idChanged 候選=$count',
  ({ length, initialMarked, currentMarked, titleChanged, idChanged, count }) => {
    // Inject both marker states independently. The wire cutoff is covered by the sync tests.
    const seed = mockSnapshot();
    const initialTitle = '長'.repeat(length - 1) + '甲';
    const initialRow = {
      ...seed.assignments.items[0], title: initialTitle,
      titleMayBeTruncated: initialMarked ? true as const : undefined,
    };
    const initial = { ...seed, assignments: { ...seed.assignments, items: [initialRow] } };
    const currentRow = {
      ...initialRow,
      title: titleChanged ? '長'.repeat(length - 1) + '乙' : initialTitle,
      titleMayBeTruncated: currentMarked ? true as const : undefined,
      source: { ...source, assignmentId: idChanged ? 'replacement' : source.assignmentId },
    };
    const items = count === 1 ? [currentRow] : [
      currentRow,
      { ...currentRow, title: length > 130 ? currentRow.title.slice(0, -1) + '丙' : currentRow.title,
        source: { ...source, assignmentId: 'duplicate-prefix' } },
    ];
    const snapshot = { ...seed, assignments: { ...seed.assignments, count, items } };
    const { plan, view, card, navigation } = planCard(initial);
    view.rerender(card(snapshot));

    const assignment = plan.steps[0];
    const baselineTitle = base.campusAssignmentDisplayTitle(initialTitle);
    expect(assignment.title).toBe(baselineTitle);
    const baseline = base.resolveCampusAssignmentTarget({ assignment, snapshot, scope });
    const targetRow = items.find(({ source }) => source.assignmentId === baseline?.params.assignmentId);
    const displayFullTitle = !initialMarked && !targetRow?.titleMayBeTruncated && targetRow?.title === initialTitle;
    const expectedTitle = displayFullTitle ? initialTitle : baselineTitle;
    expect(view.getByText(expectedTitle).props.numberOfLines).toBeUndefined();
    if (initialTitle !== baselineTitle) {
      expect(view.queryByText(displayFullTitle ? baselineTitle : initialTitle)).toBeNull();
    }

    const buttons = view.queryAllByText('查看這份作業');
    expect(buttons).toHaveLength(baseline ? 1 : 0);
    if (baseline) {
      fireEvent.press(buttons[0]);
      expect(navigation.navigate).toHaveBeenCalledWith('學習', {
        initial: false, screen: baseline.route, params: baseline.params,
      });
    }
  },
);

test('單筆回覆的同前綴作業無法唯一比對時不顯示交辦或提醒', () => {
  const snapshot = mockSnapshot();
  const prefix = '長'.repeat(130);
  const selected = { ...snapshot.assignments.items[0], title: prefix + '甲' };
  snapshot.assignments = { status: 'available', count: 2, items: [
    selected, { ...selected, title: prefix + '乙', source: { ...source, assignmentId: 'other' } },
  ] };
  const navigation = { navigate: jest.fn() };
  const view = render(<AssignmentReplyActions
    read={{ userId: scope.uid, schoolId: scope.schoolId, checkedAt: snapshot.checkedAt,
      filterQuestion: selected.title, items: [selected] }}
    snapshot={snapshot}
    context={{ userId: scope.uid, schoolId: scope.schoolId, isCurrent: current, navigation }}
    disabled={false}
    onAsk={jest.fn()}
  />);
  expect(base.resolveCampusAssignmentTarget({ assignment: selected, snapshot, scope })).toBeNull();
  expect(view.queryByText('查看這份作業')).toBeNull();
  expect(view.queryByText('設定手機本機截止提醒')).toBeNull();
});

test.each(['相符', '不同作業', '不唯一', '來源無法解析'] as const)(
  '建卡時沒有作業來源，重新同步結果為%s時依精確身分開啟', async (change) => {
    const initial = mockSnapshot();
    delete initial.assignments.items[0].source;
    const { card, plan, view, navigation } = planCard(initial);
    expect(plan.steps[0].expectedSource).toBeUndefined();
    expect(view.queryByText('查看這份作業')).toBeNull();

    const refreshed = mockSnapshot();
    const row = refreshed.assignments.items[0];
    if (change === '不同作業') row.title = '另一份作業';
    if (change === '不唯一') refreshed.assignments.items.push({ ...row, source: { ...source, assignmentId: 'other' } });
    if (change === '來源無法解析') row.source = { ...source, assignmentId: '' };
    refreshed.assignments.count = refreshed.assignments.items.length;
    await act(async () => view.rerender(card(refreshed)));

    if (change === '相符') {
      fireEvent.press(view.getAllByText('查看這份作業')[0]);
      expect(navigation.navigate).toHaveBeenCalledWith('學習', {
        initial: false,
        screen: 'HomeworkSubmit',
        params: { groupId: source.groupId, assignmentId: source.assignmentId },
      });
    } else {
      expect(view.queryByText('查看這份作業')).toBeNull();
    }
  },
);

test('過期摘要仍可配對舊提醒，批次清理保留已配對的提醒', async () => {
  const snapshot = mockSnapshot();
  const items = [{ ...snapshot.assignments.items[0], source: undefined }];
  const input = { scope, step, leadMinutes: 60 as const, isCurrent: current };
  await scheduleCampusAssignmentReminder({ ...input, snapshot: {
    ...snapshot, assignments: { ...snapshot.assignments, items },
  } });
  const expired = { ...snapshot, checkedAt: new Date(Date.now() - 16 * 60_000).toISOString() };
  await adoptCampusReminderSnapshot({ ...input, snapshot: expired });
  expect(await unlinkedLegacyReminders()).toEqual([]);
  await clearUnlinkedLegacyReminders(input);
  expect(mockAlarms.size).toBe(1);
});

test('改期前的卡片依目前摘要查找時無法退訂改期後的提醒', async () => {
  const snapshot = mockSnapshot();
  const { card, plan, view } = planCard(mockSnapshot());
  expect(plan.steps[0].expectedSource).toEqual(source);
  const newDueAt = new Date(Date.parse(dueAt) + 86_400_000).toISOString();
  snapshot.assignments.items[0].dueAt = newDueAt;
  mockReader.getAssignment.mockResolvedValue({ ...source, id: source.assignmentId, title: step.title, dueAt: newDueAt });
  const input = { scope, step, snapshot, leadMinutes: 60 as const, isCurrent: current };
  await scheduleCampusAssignmentReminder({ ...input, step: { ...step, dueAt: newDueAt } });
  await act(async () => view.rerender(card(snapshot)));
  expect(view.queryByText('取消這項本機提醒')).toBeNull();
  expect(base.knownReminderSource(input)).toBeNull();
  await expect(getCampusAssignmentReminderStatus(input)).resolves.toEqual([]);
  await expect(cancelCampusAssignmentReminder(input)).resolves.toBe(false);
  expect(mockAlarms.size).toBe(1);
});

test('排隊中的確認沿用送出時的摘要來源', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  mockReader.getAssignment.mockImplementationOnce(async () => {
    await blocked;
    return { ...source, id: 'blocker', title: step.title, dueAt };
  });
  const input = { scope, step, leadMinutes: 60 as const, isCurrent: current };
  const earlier = scheduleSubmittedAssignmentReminder({ ...input, source: { ...source, assignmentId: 'blocker' } });
  await waitFor(() => expect(mockReader.getAssignment).toHaveBeenCalledWith('blocker', 'course'));

  const snapshot = mockSnapshot();
  const expected = base.resolveCampusAssignmentTarget({ ...input, assignment: step, snapshot });
  const reminder = (value: CampusSenseSnapshot) => <CampusAssignmentReminderAction
    step={step} snapshot={value} userId={scope.uid} schoolId={scope.schoolId} disabled={false} isCurrent={current}
  />;
  const view = render(reminder(snapshot));
  try {
    fireEvent.press(await view.findByText('設定手機本機截止提醒'));
    fireEvent.press(view.getByText('確認設定本機提醒'));
    const updated = { ...snapshot, assignments: { ...snapshot.assignments, items: [
      { ...snapshot.assignments.items[0], source: { ...source, assignmentId: 'other' } },
    ] } };
    expect(base.resolveCampusAssignmentTarget({ ...input, assignment: step, snapshot: updated })?.params.assignmentId)
      .toBe('other');
    view.rerender(reminder(updated));
  } finally {
    release();
    await earlier;
  }
  await view.findByText('已設定截止前 1 小時提醒');
  expect(mockReader.getAssignment).toHaveBeenLastCalledWith(expected?.params.assignmentId, 'course');
  expect(mockReader.getAssignment).not.toHaveBeenCalledWith('other', 'course');
});

const titleForms = [
  ['控制字元', '\u0001'],
  ['DEL', '\u007F'],
  ['零寬字元', '\u200B'],
  ['全形空白', '\u3000'],
  ['結尾空白', ' '],
  ['連續空白', '   字'],
  ['代理對／emoji', '📚'],
  ['組合字元（NFC）', 'e\u0301'],
  ['相容字元（NFKC）', 'ﬃ'],
  ['換行', '\n字'],
  ['tab', '\t字'],
] as const;

const titleMatrix: Array<{ kind: string; suffix: string; length: number; count: number }> = titleForms.flatMap(([kind, suffix]) =>
  [129, 130, 131, 139, 140, 141].flatMap((length) =>
    [0, 1, 2].map((count) => ({ kind, suffix, length, count }))));
titleMatrix.push({ kind: '摘要缺少後綴', suffix: ' ', length: 142, count: 1 });

test.each(titleMatrix)('作業開啟差異矩陣 $kind 原始長度=$length 摘要相符=$count', async ({ kind, suffix, length, count }) => {
  const { refreshCampusSenseSnapshot } = jest.requireActual<typeof import('../services/campusSenseSnapshot')>(
    '../services/campusSenseSnapshot',
  );
  const rawTitle = kind === '摘要缺少後綴'
    ? ('甲'.repeat(129) + ' ' + '乙'.repeat(12)).slice(0, ASSIGNMENT_SUMMARY_TITLE_LIMIT)
    : '長'.repeat(length - suffix.length) + suffix;
  const seed = mockSnapshot();
  const rawRow = { ...seed.assignments.items[0], title: rawTitle };
  async function sync(items: CampusSenseSnapshot['assignments']['items']) {
    mockSenseCallable.mockResolvedValueOnce({ data: {
      ...seed, assignments: { status: 'available', count: items.length, items },
    } });
    return refreshCampusSenseSnapshot({ scope, isCurrent: current });
  }
  const initial = await sync([rawRow]);
  const [row] = initial.assignments.items;
  const capped = length >= ASSIGNMENT_SUMMARY_TITLE_LIMIT;
  expect(row.titleMayBeTruncated).toBe(capped ? true : undefined);
  const snapshot = count === 1 ? initial : await sync(count === 0
    ? [{ ...rawRow, title: '另一份作業', source: { ...source, assignmentId: 'other' } }]
    : [rawRow, { ...rawRow, source: { ...source, assignmentId: 'other' } }]);

  const { plan, view, card, navigation } = planCard(initial);
  view.rerender(card(snapshot));
  const planStep = plan.steps[0];
  const day = plan.agenda!.days.find(({ deadlines }) => deadlines.length > 0)!;
  expect(planStep.title).toBe(base.campusAssignmentDisplayTitle(row.title));
  expect(capped ? planStep.summaryAssignmentTitle : planStep.fullAssignmentTitle).toBe(row.title);
  const openLabel = '查看這份作業';
  const stepButtons = view.queryAllByText(openLabel);
  fireEvent.press(view.getByLabelText(day.label + '逐日安排'));
  const agendaButtons = view.queryAllByText(openLabel).slice(stepButtons.length);

  const replyButtons = () => render(<AssignmentReplyActions
    read={{ userId: scope.uid, schoolId: scope.schoolId, checkedAt: initial.checkedAt,
      filterQuestion: row.title, items: [row] }}
    snapshot={snapshot}
    context={{ userId: scope.uid, schoolId: scope.schoolId, isCurrent: current, navigation }}
    disabled={false}
    onAsk={jest.fn()}
  />).queryAllByText(openLabel);

  for (const [entry, title, findButtons] of [
    ['計畫步驟', planStep.title, () => stepButtons],
    ['逐日清單', day.deadlines[0].title, () => agendaButtons],
    ['單筆回覆', row.title, replyButtons],
  ] as const) {
    const buttons = findButtons();
    const assignment = { title, groupName: row.groupName, dueAt: row.dueAt };
    const input = { assignment, snapshot, scope };
    const baseline = base.resolveCampusAssignmentTarget(input);
    if (kind === '摘要缺少後綴' && entry === '計畫步驟') expect(baseline).toBeNull();
    expect({ entry, target: resolveCampusAssignmentTarget(input) }).toEqual({ entry, target: baseline });
    if (count < 2 && !capped && baseline) {
      expect({ entry, opens: buttons.length > 0 }).toEqual({ entry, opens: true });
    }
    expect({ entry, buttons: buttons.length }).toEqual({ entry, buttons: count === 1 && baseline ? 1 : 0 });
    if (buttons.length) {
      fireEvent.press(buttons[0]);
      expect({ entry, calls: navigation.navigate.mock.calls }).toEqual({ entry, calls: [['學習', {
        initial: false, screen: 'HomeworkSubmit', params: { groupId: source.groupId, assignmentId: source.assignmentId },
      }]] });
      navigation.navigate.mockClear();
    }
  }
});

const reminderMatrix = (['source', 'v1', 'v1 with digest'] as const).flatMap((kind) =>
  [4, 129, 130, 131, 134, 139, 140, 141].flatMap((length) =>
    [0, 1, 2].map((count) => ({ kind, length, count }))));

test.each(reminderMatrix)('提醒與交辦差異矩陣 $kind $length 字 $count 筆', async ({ kind, length, count }) => {
  const rawTitle = '長'.repeat(length);
  const row = {
    title: rawTitle.slice(0, 140), groupName: step.groupName ?? '', dueAt, source,
    ...(length >= 140 ? { titleMayBeTruncated: true as const } : {}),
  };
  const snapshot = mockSnapshot();
  snapshot.assignments = { status: 'available', count, items: [
    row, { ...row, source: { ...source, assignmentId: 'other' } },
  ].slice(0, count) };
  const card = { ...step, title: base.campusAssignmentDisplayTitle(rawTitle) };
  const input = { scope, step: card, snapshot, leadMinutes: 60 as const, isCurrent: current };
  const handoff = { scope, snapshot, assignment: card };
  const baseTarget = base.resolveCampusAssignmentTarget(handoff);
  expect(resolveCampusAssignmentTarget(handoff)).toEqual(baseTarget);
  expect(resolveCampusAssignmentTarget({ ...handoff, assignment: {
    ...card, expectedSource: source,
    ...(length >= 140 ? { summaryAssignmentTitle: row.title } : { fullAssignmentTitle: row.title }),
  } })).toEqual(baseTarget);
  expect(resolveCampusAssignmentTarget({ ...handoff, assignment: {
    ...card, expectedSource: { ...source, assignmentId: 'other' },
  } })).toEqual(baseTarget);

  mockReader.getAssignment.mockResolvedValue({ ...source, id: source.assignmentId, title: rawTitle, dueAt });
  if (base.reminderCandidate(snapshot, input)) {
    await expect(scheduleCampusAssignmentReminder(input)).resolves.toMatchObject({ outcome: 'scheduled' });
  } else {
    await expect(scheduleCampusAssignmentReminder(input)).rejects.toMatchObject({ code: 'invalid-source' });
  }
  mockAlarms.clear();
  mockStorage.clear();

  const seed = async () => {
    if (kind === 'source') {
      await scheduleSubmittedAssignmentReminder({ ...input, source });
    } else {
      await scheduleCampusAssignmentReminder({ ...input, snapshot: {
        ...snapshot, assignments: { status: 'available', count: 1, items: [{ ...row, source: undefined }] },
      } });
      if (kind === 'v1 with digest') {
        const [key, raw] = [...mockStorage.entries()][0];
        mockStorage.set(key, JSON.stringify({ ...JSON.parse(raw), cardDigest: 'legacy-digest' }));
      }
    }
  };
  await seed();
  const canCancel = kind !== 'source' || Boolean(base.knownReminderSource(input));
  await expect(getCampusAssignmentReminderStatus(input)).resolves.toEqual(canCancel ? [60] : []);
  await expect(cancelCampusAssignmentReminder(input)).resolves.toBe(canCancel);
  expect(mockAlarms.size).toBe(canCancel ? 0 : 1);

  mockAlarms.clear();
  mockStorage.clear();
  await seed();
  await adoptCampusReminderSnapshot(input);
  await clearUnlinkedLegacyReminders(input);
  expect(mockAlarms.size).toBe(kind === 'source' || base.knownReminderSource(input) ? 1 : 0);
});
