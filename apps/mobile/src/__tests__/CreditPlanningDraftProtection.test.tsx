import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import type { NavigationAction } from '@react-navigation/native';
import { shareAsync } from 'expo-sharing';
import CreditPlanningScreen from '../screens/CreditPlanningScreen';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { readMobileCreditPlan, writeMobileCreditPlan } from '../features/academics/creditPlanRepository';

let mockUid = 'student-a';
let mockRemoval: { blocked: boolean; callback: (event: { data: { action: NavigationAction } }) => void } | null = null;
const mockFileWrite = jest.fn();
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (blocked: boolean, callback: (event: { data: { action: NavigationAction } }) => void) => {
    mockRemoval = { blocked, callback };
  },
}));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid }, loading: false }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    Screen: ({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) =>
      React.createElement(View, null, React.createElement(Text, null, title), headerRight, children),
    Spinner: () => null,
  };
});
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ uri: 'file:///tmp/plan.json',
    write: (raw: string) => mockFileWrite(raw), delete: jest.fn(),
  })), Paths: { cache: '/tmp' },
}));
jest.mock('../features/academics/creditPlanRepository', () => ({
  CREDIT_PLAN_BACKUP_MAX_BYTES: 90_000,
  mobileCreditPlanKey: (uid: string | null, schoolId: string) => `plan:${uid}:${schoolId}`,
  readMobileCreditPlan: jest.fn(), writeMobileCreditPlan: jest.fn(),
  parsePortableCreditPlan: (raw: string) => JSON.parse(raw),
  portableCreditPlanJson: (plan: unknown) => JSON.stringify(plan),
}));

const read = jest.mocked(readMobileCreditPlan);
const write = jest.mocked(writeMobileCreditPlan);
function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '20', target: '128', courses: [
    { id: 'one', name: '資料庫管理', credits: 3, term: 1, category: 'required', status: 'considering' },
    { id: 'two', name: '資訊安全', credits: 2, term: 2, category: 'elective', status: 'registered' },
  ] };
}
function button(title: string, label: string): NonNullable<AlertButton['onPress']> {
  const call = jest.mocked(Alert.alert).mock.calls.findLast((entry) => entry[0] === title);
  const action = call?.[2]?.find((entry) => entry.text === label)?.onPress;
  if (!action) throw new Error(`Missing confirmation: ${title}/${label}`);
  return action;
}
async function ready(native = false) {
  const navigation = { goBack: jest.fn(), ...(native ? { dispatch: jest.fn() } : {}) };
  const view = render(<CreditPlanningScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('已確認可採計學分').props.value).toBe('20'));
  return { view, navigation };
}
function nativeBack() {
  if (!mockRemoval?.blocked) throw new Error('The native removal guard was not enabled');
  mockRemoval.callback({ data: { action: { type: 'GO_BACK' } } });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'student-a'; mockRemoval = null;
  read.mockReset().mockImplementation(async () => sample());
  write.mockReset().mockResolvedValue(undefined);
  mockFileWrite.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('clean plans and merely selecting a semester do not trigger an unsaved warning', async () => {
  const { view, navigation } = await ready();
  fireEvent.press(view.getByLabelText('第 3 學期 · 0'));
  expect(view.queryByText(/^尚未儲存：/)).toBeNull();
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('back confirms unsaved goals and cancelling keeps the inputs', async () => {
  const { view, navigation } = await ready();
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  expect(view.getByText('尚未儲存：學分目標')).toBeTruthy();
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  expect(navigation.goBack).not.toHaveBeenCalled();
  act(() => button('尚有未儲存的內容', '繼續編輯')());
  expect(view.getByLabelText('希望累計的學分').props.value).toBe('140');
  expect(write).not.toHaveBeenCalled();
});

test('repeated back taps create one confirmation and an accepted action can run only once', async () => {
  const { view, navigation } = await ready();
  fireEvent.changeText(view.getByLabelText('課程名稱'), '尚未加入的課程');
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  const discard = button('尚有未儲存的內容', '捨棄並離開');
  act(() => { discard(); discard(); });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});

test('saving one section does not mark other unsaved sections as saved', async () => {
  const { view } = await ready();
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '網路程式設計');
  expect(view.getByText('尚未儲存：學分目標、課程安排')).toBeTruthy();
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  expect(view.getByText('尚未儲存：課程安排')).toBeTruthy();
  expect(view.getByLabelText('課程名稱').props.value).toBe('網路程式設計');
  expect(write.mock.calls[0][1].courses).toHaveLength(2);
});

test('saving failures retain dirty state and successful retry clears only those changes', async () => {
  write.mockRejectedValueOnce(new Error('disk full'));
  const { view } = await ready(true);
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.press(view.getByText('儲存學分目標'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('規劃未儲存', 'disk full'));
  expect(view.getByText('尚未儲存：學分目標')).toBeTruthy();
  expect(mockRemoval?.blocked).toBe(true);
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  expect(view.queryByText(/^尚未儲存：/)).toBeNull();
  expect(mockRemoval?.blocked).toBe(false);
});

test('switching to another course requires confirmation while cancelling preserves the draft', async () => {
  const { view } = await ready();
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫專題');
  fireEvent.press(view.getByLabelText('編輯資訊安全'));
  expect(view.getByLabelText('課程名稱').props.value).toBe('資料庫專題');
  act(() => button('捨棄目前課程輸入？', '繼續編輯')());
  fireEvent.press(view.getByLabelText('編輯資訊安全'));
  act(() => button('捨棄目前課程輸入？', '捨棄並切換')());
  expect(view.getByLabelText('課程名稱').props.value).toBe('資訊安全');
  expect(view.queryByText(/^尚未儲存：/)).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test('editing the same course again focuses the existing draft instead of resetting it', async () => {
  const { view } = await ready();
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  fireEvent.changeText(view.getByLabelText('課程名稱'), '仍在修改的資料庫');
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  expect(view.getByLabelText('課程名稱').props.value).toBe('仍在修改的資料庫');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('cancelling a modified course requires confirmation without discarding goal inputs', async () => {
  const { view } = await ready();
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  fireEvent.changeText(view.getByLabelText('學分'), '4');
  fireEvent.press(view.getByText('取消修改'));
  expect(view.getByLabelText('學分').props.value).toBe('4');
  act(() => button('捨棄課程修改？', '捨棄修改')());
  expect(view.getByLabelText('課程名稱').props.value).toBe('');
  expect(view.getByLabelText('希望累計的學分').props.value).toBe('140');
  expect(view.getByText('尚未儲存：學分目標')).toBeTruthy();
});

test('an old switch confirmation cannot replace a newer course input', async () => {
  const { view } = await ready();
  fireEvent.changeText(view.getByLabelText('課程名稱'), '草稿 A');
  fireEvent.press(view.getByLabelText('編輯資訊安全'));
  const discard = button('捨棄目前課程輸入？', '捨棄並切換');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '草稿 B');
  act(() => discard());
  expect(view.getByLabelText('課程名稱').props.value).toBe('草稿 B');
});

test('changing away and back to the same input does not revive an old discard confirmation', async () => {
  const { view, navigation } = await ready();
  fireEvent.changeText(view.getByLabelText('課程名稱'), '草稿 A');
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  const discard = button('尚有未儲存的內容', '捨棄並離開');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '草稿 B');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '草稿 A');
  act(() => discard());
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test('a prior account confirmation cannot navigate after switching A -> B -> A', async () => {
  const { view, navigation } = await ready();
  fireEvent.changeText(view.getByLabelText('課程名稱'), '私人草稿');
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  const discard = button('尚有未儲存的內容', '捨棄並離開');
  for (const uid of ['student-b', 'student-a']) {
    mockUid = uid;
    view.rerender(<CreditPlanningScreen navigation={navigation} />);
    await waitFor(() => expect(view.getByLabelText('已確認可採計學分').props.value).toBe('20'));
  }
  act(() => discard());
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(view.getByLabelText('課程名稱').props.value).toBe('');
});

test('native back or swipe removal dispatches the original action only after confirmation', async () => {
  const { view, navigation } = await ready(true);
  expect(mockRemoval?.blocked).toBe(false);
  fireEvent.changeText(view.getByLabelText('課程名稱'), '本機草稿');
  act(() => nativeBack());
  expect(navigation.dispatch).not.toHaveBeenCalled();
  act(() => button('尚有未儲存的內容', '捨棄並離開')());
  expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
});

test('native removal and visible back are blocked during an accepted save', async () => {
  let finish!: () => void;
  write.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const { view, navigation } = await ready(true);
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.press(view.getByText('儲存學分目標'));
  await waitFor(() => expect(write).toHaveBeenCalled());
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  act(() => nativeBack());
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.dispatch).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('請先完成目前操作', expect.any(String));
  await act(async () => { finish(); });
  expect(mockRemoval?.blocked).toBe(false);
});

test('collapsed category and milestone inputs remain represented in unsaved status', async () => {
  const { view } = await ready();
  fireEvent.press(view.getByLabelText('分類門檻與非學分條件'));
  fireEvent.changeText(view.getByLabelText('必修目標門檻'), '60');
  fireEvent.changeText(view.getByLabelText('新增畢業條件（自行核對）'), '英語能力門檻');
  fireEvent.press(view.getByLabelText('分類門檻與非學分條件'));
  expect(view.getByText('尚未儲存：分類門檻、非學分條件')).toBeTruthy();
  fireEvent.press(view.getByLabelText('返回學分總覽'));
  expect(Alert.alert).toHaveBeenCalledWith('尚有未儲存的內容', expect.stringContaining('分類門檻、非學分條件'), expect.any(Array), expect.any(Object));
});

test('export requires an explicit choice when unsaved values differ from the saved backup', async () => {
  const { view } = await ready();
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  expect(mockFileWrite).not.toHaveBeenCalled();
  act(() => button('備份不含尚未儲存的輸入', '返回儲存')());
  expect(shareAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  await act(async () => button('備份不含尚未儲存的輸入', '只匯出已儲存版本')());
  await waitFor(() => expect(shareAsync).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mockFileWrite.mock.calls[0][0]).target).toBe('128');
  expect(view.getByLabelText('希望累計的學分').props.value).toBe('140');
  expect(view.getByText('尚未儲存：學分目標')).toBeTruthy();
});

test('saving after an export warning invalidates its old confirmation and saved snapshot', async () => {
  const { view } = await ready();
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '140');
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  const exportOld = button('備份不含尚未儲存的輸入', '只匯出已儲存版本');
  fireEvent.press(view.getByText('儲存學分目標'));
  await view.findByText('個人目標已保存在這台裝置。');
  await act(async () => exportOld());
  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('匯出規劃 JSON'));
  await waitFor(() => expect(shareAsync).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mockFileWrite.mock.calls[0][0]).target).toBe('140');
});
