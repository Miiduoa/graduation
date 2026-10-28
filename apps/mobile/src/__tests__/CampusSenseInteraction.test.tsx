import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { CampusSenseChangesCard } from '../screens/CampusSenseChangesCard';
import { askCampusAssistant } from '../features/campusAssistant';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';

let mockUid = 'A';
let mockSchool = 'pu';
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool, name: '靜宜大學' } }) }));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  OnDeviceAssistantError: class extends Error {},
  getOnDeviceAssistantReadiness: jest.fn(async () => ({ available: true, ready: false, reason: '尚未下載免費模型' })),
}));
jest.mock('../features/campusAssistantActions', () => ({ confirmCampusAgentWrite: jest.fn() }));
jest.mock('../services/campusAssignmentReminders', () => ({ getCampusAssignmentReminderStatus: jest.fn(async () => []) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
type Row = CampusSenseSnapshot['assignments']['items'][number];
const row = (id: string, title = '資料庫報告', dueAt: string | null = '2026-11-05T09:00:00Z'): Row => ({
  title, groupName: '資料庫', dueAt,
  source: { kind: 'group-assignment', groupId: 'g', assignmentId: id },
});
const snapshot = (items: Row[]): CampusSenseSnapshot => ({
  userId: mockUid, schoolId: mockSchool, checkedAt: new Date().toISOString(),
  schedule: { status: 'unavailable', count: null },
  announcements: { status: 'available', items: [] },
  assignments: { status: 'available', count: items.length, items },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  mockUid = 'A'; mockSchool = 'pu';
  mockCallable.mockReset().mockResolvedValue({ data: snapshot([row('a')]) });
  jest.mocked(askCampusAssistant).mockReset();
});

test('manual sync cancellation unlocks the draft, ignores a late result and permits an explicit retry', async () => {
  const pending = deferred<{ data: CampusSenseSnapshot }>();
  mockCallable.mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '保留我的問題');
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.getByText('正在確認校園資料來源…')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.editable).toBe(false);
  fireEvent.press(view.getByText('送出問題'));
  fireEvent.press(view.getByText('校園即時 · 需網路'));
  expect(askCampusAssistant).not.toHaveBeenCalled();
  expect(view.getByText('✓ 手機本地 AI · 免費推論')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('停止同步')));
  await waitFor(() => expect(view.queryByText('停止同步')).toBeNull());
  expect(view.getByLabelText('詢問校園助理').props.editable).toBe(true);
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('保留我的問題');
  await act(async () => pending.resolve({ data: snapshot([row('old', '不得顯示的舊資料')]) }));
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.getByText('已取得本次授權資料')).toBeTruthy();
  expect(mockCallable).toHaveBeenCalledTimes(2);
  expect(askCampusAssistant).not.toHaveBeenCalled();
});

test('stopping a weekly brief while reading does not fall back to inference or cloud', async () => {
  const pending = deferred<{ data: CampusSenseSnapshot }>();
  mockCallable.mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('未來七天')));
  await act(async () => fireEvent.press(view.getByText('停止同步')));
  await waitFor(() => expect(view.queryByText('停止同步')).toBeNull());
  expect(askCampusAssistant).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ data: snapshot([row('a')]) }));
  expect(askCampusAssistant).not.toHaveBeenCalled();
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
});

test('validated page progress is visible but the partial list is never installed', async () => {
  const pending = deferred<{ data: CampusSenseSnapshot }>();
  const first = snapshot(Array.from({ length: 50 }, (_, i) => row('a_' + i)));
  first.assignments.count = 80;
  mockCallable.mockResolvedValueOnce({ data: {
    ...first, assignments: { ...first.assignments, paging: { version: 1, offset: 0, nextOffset: 50, revision: 'a'.repeat(64) } },
  } }).mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.getByText('已核對 50 / 80 筆作業')).toBeTruthy();
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('停止同步')));
  expect(mockCallable).toHaveBeenCalledTimes(2);
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
});

test.each(['account', 'school'] as const)('%s switch prevents late progress or a snapshot from reaching the next session', async (kind) => {
  const pending = deferred<{ data: CampusSenseSnapshot }>();
  const old = snapshot([row('a', '上一個帳號的作業')]);
  mockCallable.mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  if (kind === 'account') mockUid = 'B'; else mockSchool = 'other';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => pending.resolve({ data: old }));
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
  expect(view.queryByText('停止同步')).toBeNull();
  expect(view.queryByText('上一個帳號的作業')).toBeNull();
});

test('leaving a sync stops accepting data without starting a model', async () => {
  const pending = deferred<{ data: CampusSenseSnapshot }>();
  mockCallable.mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  view.unmount();
  await act(async () => pending.resolve({ data: snapshot([row('a')]) }));
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(askCampusAssistant).not.toHaveBeenCalled();
});

test('two complete manual syncs show additions and earlier deadlines, with a verified homework shortcut', async () => {
  const before = snapshot([row('a'), row('gone', '本次未列出的任務')]);
  const after = snapshot([row('a', '資料庫報告', '2026-11-03T09:00:00Z'), row('new', '新的作業')]);
  mockCallable.mockResolvedValueOnce({ data: before }).mockResolvedValueOnce({ data: after });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.queryByText('新增作業')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重新同步校園資料')));
  expect(view.getByText('截止提前')).toBeTruthy();
  expect(view.getByText('新增作業')).toBeTruthy();
  expect(view.getByText('本次清單未列出')).toBeTruthy();
  expect(view.getByText(/不能據此判定已完成/)).toBeTruthy();
  fireEvent.press(view.getAllByText('查看這份作業')[0]);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(askCampusAssistant).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('清除本次校園摘要')));
  expect(view.queryByText('本次同步變更')).toBeNull();
});

test('partial lists never render a removed/completed conclusion', () => {
  const first = snapshot([row('a')]);
  const second = snapshot([]);
  second.assignments.count = 10;
  const props = { userId: 'A', schoolId: 'pu', isCurrent: () => true, disabled: false };
  const view = render(<CampusSenseChangesCard {...props} snapshot={first} />);
  view.rerender(<CampusSenseChangesCard {...props} snapshot={second} />);
  expect(view.getByText(/這次或上次資料不完整/)).toBeTruthy();
  expect(view.queryByText('本次清單未列出')).toBeNull();
});
