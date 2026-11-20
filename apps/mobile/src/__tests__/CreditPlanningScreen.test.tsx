import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import CreditPlanningScreen from '../screens/CreditPlanningScreen';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { readMobileCreditPlan, writeMobileCreditPlan } from '../features/academics/creditPlanRepository';

let mockUid: string | null = 'student-a';
let mockLoading = false;
let mockSchool = { id: 'pu', name: '靜宜大學' };
const mockFileText = jest.fn();
const mockFileWrite = jest.fn();
const mockFileDelete = jest.fn();

jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: mockLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    Screen: ({ title, subtitle, children, headerRight }: {
      title: string; subtitle?: string; children: React.ReactNode; headerRight?: React.ReactNode;
    }) => React.createElement(View, null, React.createElement(Text, null, title),
      React.createElement(Text, null, subtitle), headerRight, children),
    Spinner: () => null,
  };
});
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ uri: 'file:///tmp/plan.json',
    text: () => mockFileText(), write: (raw: string) => mockFileWrite(raw), delete: () => mockFileDelete(),
  })), Paths: { cache: '/tmp' },
}));
jest.mock('../features/academics/creditPlanRepository', () => ({
  CREDIT_PLAN_BACKUP_MAX_BYTES: 90_000,
  mobileCreditPlanKey: (uid: string | null, schoolId: string) => `plan:${uid ?? 'guest'}:${schoolId}`,
  readMobileCreditPlan: jest.fn(), writeMobileCreditPlan: jest.fn(),
  parsePortableCreditPlan: (raw: string) => JSON.parse(raw),
  portableCreditPlanJson: (plan: unknown) => JSON.stringify(plan),
}));

const hero = '把未來的學分，排成可執行的計畫。';
const read = jest.mocked(readMobileCreditPlan);
const write = jest.mocked(writeMobileCreditPlan);
const pick = jest.mocked(getDocumentAsync);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '20', target: '128', courses: [
    { id: 'one', name: '資料庫管理', credits: 3, term: 1, category: 'required', status: 'considering' },
  ] };
}
function confirm(title: string, text: string): NonNullable<AlertButton['onPress']> {
  const call = jest.mocked(Alert.alert).mock.calls.findLast((entry) => entry[0] === title);
  const button = call?.[2]?.find((entry) => entry.text === text);
  if (!button?.onPress) throw new Error(`Missing confirmation: ${title}/${text}`);
  return button.onPress;
}
async function switchUser(view: ReturnType<typeof render>, uid: string) {
  mockUid = uid;
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
}
const picked = { canceled: false as const, assets: [{ uri: 'file:///backup.json', name: 'backup.json', size: 100 }] };
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'student-a'; mockLoading = false; mockSchool = { id: 'pu', name: '靜宜大學' };
  read.mockReset().mockResolvedValue(emptyCreditPlan());
  write.mockReset().mockResolvedValue(undefined);
  pick.mockReset().mockResolvedValue(picked);
  mockFileText.mockReset().mockResolvedValue(JSON.stringify(sample()));
  mockFileWrite.mockReset().mockResolvedValue(undefined);
  mockFileDelete.mockReset();
  jest.mocked(isAvailableAsync).mockReset().mockResolvedValue(true);
  jest.mocked(shareAsync).mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('saves goals then a hypothetical course, without increasing confirmed credits', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '128');
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫管理');
  fireEvent.press(view.getByText('加入修課規劃'));
  await view.findByText('課程已加入未來規劃。');
  const latest = write.mock.calls.at(-1)![1];
  expect(latest.recognized).toBe('60');
  expect(latest.courses[0]).toMatchObject({ name: '資料庫管理', credits: 3, status: 'considering' });
});

test('does not read guest drafts while authentication is still resolving', async () => {
  mockLoading = true;
  const view = render(<CreditPlanningScreen />);
  expect(view.queryByLabelText('課程名稱')).toBeNull();
  expect(read).not.toHaveBeenCalled();
  mockLoading = false;
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
  expect(read).toHaveBeenCalledWith('plan:student-a:pu');
});

test('switching school/account clears unsaved inputs and does not write them into a new scope', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('課程名稱'), '私人課程草稿');
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '89');
  mockUid = 'student-b'; mockSchool = { id: 'nchu', name: '中興大學' };
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
  expect(view.getByLabelText('課程名稱').props.value).toBe('');
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('');
  expect(read).toHaveBeenCalledWith('plan:student-b:nchu');
  expect(write).not.toHaveBeenCalled();
});

test('a file picker finishing after A -> B -> A cannot open a stale confirmation', async () => {
  const pending = deferred<Awaited<ReturnType<typeof getDocumentAsync>>>();
  pick.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByText('匯入 Web／手機 JSON 備份'));
  await switchUser(view, 'student-b');
  await switchUser(view, 'student-a');
  await act(async () => { pending.resolve(picked); });
  expect(mockFileText).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test('an already-open backup confirmation remains invalid after returning to the same account', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByText('匯入 Web／手機 JSON 備份'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('確認匯入學分規劃', expect.any(String), expect.any(Array), expect.any(Object)));
  const oldConfirm = confirm('確認匯入學分規劃', '確認取代');
  await switchUser(view, 'student-b');
  await switchUser(view, 'student-a');
  await act(async () => { oldConfirm(); });
  expect(write).not.toHaveBeenCalled();
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('');
});

test('a delayed delete cannot overwrite newer saved goals with its old plan snapshot', async () => {
  read.mockResolvedValue(sample());
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByLabelText('移除資料庫管理'));
  const remove = confirm('移除課程', '移除');
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  await act(async () => { remove(); });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][1].recognized).toBe('60');
  expect(write.mock.calls[0][1].courses).toHaveLength(1);
  expect(Alert.alert).toHaveBeenCalledWith('規劃已更新', expect.any(String));
});

test('an old write completion cannot restore an earlier plan after A -> B -> A', async () => {
  const pending = deferred<void>();
  write.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.press(view.getByText('儲存學分目標'));
  await waitFor(() => expect(write).toHaveBeenCalled());
  await switchUser(view, 'student-b');
  read.mockResolvedValueOnce({ ...sample(), recognized: '44' });
  await switchUser(view, 'student-a');
  await act(async () => { pending.resolve(undefined); });
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('44');
  expect(view.queryByText('個人目標已保存在這台裝置。')).toBeNull();
});

test('storage failure keeps draft inputs, reports no success, and permits retry', async () => {
  write.mockRejectedValueOnce(new Error('disk full'));
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.press(view.getByText('儲存學分目標'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('規劃未儲存', 'disk full'));
  expect(view.queryByText('個人目標已保存在這台裝置。')).toBeNull();
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('60');
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  expect(write).toHaveBeenCalledTimes(2);
});

test('damaged local data is only replaced after an explicit valid backup confirmation', async () => {
  read.mockRejectedValueOnce(new Error('invalid local plan'));
  const view = render(<CreditPlanningScreen />);
  await view.findByText('invalid local plan');
  expect(view.getByText(/原有資料沒有被重設或覆寫/)).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('使用 JSON 備份修復'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('確認匯入學分規劃', expect.any(String), expect.any(Array), expect.any(Object)));
  expect(write).not.toHaveBeenCalled();
  await act(async () => { confirm('確認匯入學分規劃', '確認取代')(); });
  await view.findByText(hero);
  expect(write).toHaveBeenCalledWith('plan:student-a:pu', sample());
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('20');
  expect(mockFileDelete).not.toHaveBeenCalled();
});

test('export cannot open a share sheet for the prior account after a delayed capability check', async () => {
  const available = deferred<boolean>();
  jest.mocked(isAvailableAsync).mockReturnValueOnce(available.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  await waitFor(() => expect(isAvailableAsync).toHaveBeenCalled());
  await switchUser(view, 'student-b');
  await act(async () => { available.resolve(true); });
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockFileDelete).toHaveBeenCalledTimes(1);
});

test('unsupported sharing does not announce a completed backup and cleans temporary output', async () => {
  jest.mocked(isAvailableAsync).mockResolvedValueOnce(false);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('目前無法分享備份', expect.stringContaining('尚未完成備份')));
  expect(mockFileDelete).toHaveBeenCalledTimes(1);
  expect(shareAsync).not.toHaveBeenCalled();
});

test('editing targets the chosen course and a visible back action remains available', async () => {
  read.mockResolvedValue(sample());
  const navigation = { goBack: jest.fn() };
  const view = render(<CreditPlanningScreen navigation={navigation} />);
  await view.findByText(hero);
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  expect(view.getByLabelText('課程名稱').props.value).toBe('資料庫管理');
  expect(view.getByText('儲存課程修改')).toBeTruthy();
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});


test('mobile displays honest average load and does not allocate unscheduled credits to a term', async () => {
  const plan = { ...emptyCreditPlan(), recognized: '60', target: '128', extra: '20' };
  read.mockResolvedValue(plan);
  const view = render(<CreditPlanningScreen />);
  await view.findByText('學期負擔與下一步');
  expect(view.getByText('平均每學期還需')).toBeTruthy();
  expect(view.getByText('尚未排入學期')).toBeTruthy();
  expect(view.getByText(/學期推演不會把/)).toBeTruthy();
  expect(view.getAllByText('累積 60')).toHaveLength(4);
});
