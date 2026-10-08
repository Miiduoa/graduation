import React from 'react';
import { StyleSheet } from 'react-native';
import { applyTheme } from '../ui/theme';
import { aiTokens } from '../ui/aiFirst';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { defaultNotificationPreferences } from '@campus/shared/src/notifications';
import {
  loadNotificationPreferencesState,
  saveNotificationPreferences,
  enablePushNotificationsForUser,
} from '../services/notifications';
let mockUser: { uid: string } | null;
let mockSchool: string;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../services/notifications', () => ({
  loadNotificationPreferencesState: jest.fn(),
  saveNotificationPreferences: jest.fn(),
  enablePushNotificationsForUser: jest.fn(),
  openNotificationSettings: jest.fn(),
  isNotificationTime: (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
}));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const load = loadNotificationPreferencesState as jest.Mock;
const save = saveNotificationPreferences as jest.Mock;
const push = enablePushNotificationsForUser as jest.Mock;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function screen() {
  const view = render(<NotificationSettingsScreen />);
  await act(async () => undefined);
  return view;
}
beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  mockUser = { uid: 'u1' };
  mockSchool = 's1';
  load.mockResolvedValue({ preferences: { ...defaultNotificationPreferences }, source: 'server' });
  save.mockResolvedValue({ status: 'server' });
  push.mockResolvedValue({ status: 'enabled', token: 'private-token' });
});
test('a failed save retains edits and only server acknowledgment shows saved', async () => {
  save.mockRejectedValueOnce(new Error('permission-denied'));
  const view = await screen();
  fireEvent(view.getByLabelText('公告通知'), 'valueChange', false);
  await act(async () => fireEvent.press(view.getByText('儲存設定')));
  expect(view.getByText(/尚未確認設定已儲存/)).toBeTruthy();
  expect(view.queryByText('設定已儲存至帳號。')).toBeNull();
  expect(view.getByLabelText('公告通知').props.value).toBe(false);
  await act(async () => fireEvent.press(view.getByText('重試儲存')));
  expect(save.mock.calls[1][1].announcements).toBe(false);
  expect(view.getByText('設定已儲存至帳號。')).toBeTruthy();
});
test('local-only save remains explicitly unsynced and offers retry', async () => {
  save.mockResolvedValueOnce({ status: 'local' });
  const view = await screen();
  await act(async () => fireEvent.press(view.getByText('儲存設定')));
  expect(view.getByText(/設定已保留在這台裝置/)).toBeTruthy();
  expect(view.queryByText('設定已儲存至帳號。')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重試儲存')));
  expect(view.getByText('設定已儲存至帳號。')).toBeTruthy();
});
test('failed initial read offers retry and prevents overwriting unknown settings with defaults', async () => {
  load.mockRejectedValueOnce(new Error('offline'));
  const view = await screen();
  expect(view.queryByText('儲存設定')).toBeNull();
  expect(view.getByText(/無法讀取通知設定/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重新讀取')));
  expect(view.getByText('儲存設定')).toBeTruthy();
});
test('offline first load with no cache cannot save until the account preferences are read', async () => {
  load.mockResolvedValueOnce({
    preferences: defaultNotificationPreferences,
    source: 'unavailable',
  });
  const view = await screen();
  expect(view.getByText('重新讀取')).toBeTruthy();
  expect(view.queryByText('儲存設定')).toBeNull();
  expect(view.getByLabelText('通知總開關').props.disabled).toBe(true);
});
test.each(['account', 'school'])('changing %s isolates a late initial read', async (change) => {
  const old = deferred();
  load.mockReturnValueOnce(old.promise);
  const view = render(<NotificationSettingsScreen />);
  const guard = load.mock.calls[0][1].isCurrent;
  if (change === 'account') mockUser = { uid: 'u2' };
  else mockSchool = 's2';
  await act(async () => view.rerender(<NotificationSettingsScreen />));
  expect(guard()).toBe(false);
  await act(async () =>
    old.resolve({
      preferences: { ...defaultNotificationPreferences, announcements: false },
      source: 'local',
    }),
  );
  expect(view.getByLabelText('公告通知').props.value).toBe(true);
  expect(view.queryByText(/設定已保留在這台裝置/)).toBeNull();
});
test.each(['account', 'school'])(
  'changing %s discards late save status and starts fresh settings',
  async (change) => {
    const old = deferred();
    save.mockReturnValueOnce(old.promise);
    const view = await screen();
    fireEvent(view.getByLabelText('公告通知'), 'valueChange', false);
    fireEvent.press(view.getByText('儲存設定'));
    const guard = save.mock.calls[0][2].isCurrent;
    if (change === 'account') mockUser = { uid: 'u2' };
    else mockSchool = 's2';
    await act(async () => view.rerender(<NotificationSettingsScreen />));
    expect(guard()).toBe(false);
    await act(async () => old.resolve({ status: 'server' }));
    expect(view.queryByText('設定已儲存至帳號。')).toBeNull();
    expect(view.getByLabelText('公告通知').props.value).toBe(true);
  },
);
test.each([
  ['denied', '系統通知權限已關閉'],
  ['unsupported', '此裝置目前不支援'],
  ['unconfigured', '此版本尚未完成'],
  ['unavailable', '暫時無法完成'],
])('push status %s has its own explanation', async (status, message) => {
  push.mockResolvedValue({ status });
  const view = await screen();
  await act(async () => fireEvent.press(view.getByText('啟用推播通知')));
  expect(view.getByText(new RegExp(message))).toBeTruthy();
  expect(!!view.queryByText('開啟系統設定')).toBe(status === 'denied');
});
test('late push response after context change is ignored, with no duplicate request or leaked token', async () => {
  const old = deferred();
  push.mockReturnValueOnce(old.promise);
  const view = await screen();
  act(() => {
    fireEvent.press(view.getByText('啟用推播通知'));
    fireEvent.press(view.getByText('啟用推播通知'));
  });
  expect(push).toHaveBeenCalledTimes(1);
  mockUser = { uid: 'u2' };
  await act(async () => view.rerender(<NotificationSettingsScreen />));
  await act(async () => old.resolve({ status: 'enabled', token: 'private-token' }));
  expect(view.queryByText('這台裝置已完成推播註冊。')).toBeNull();
  expect(view.queryByText(/private-token/)).toBeNull();
});
test('invalid quiet-hour time blocks save and a valid minute value is preserved', async () => {
  const view = await screen();
  fireEvent(view.getByLabelText('啟用免打擾'), 'valueChange', true);
  fireEvent.changeText(view.getByLabelText('免打擾開始時間'), '25:00');
  await act(async () => fireEvent.press(view.getByText('儲存設定')));
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('免打擾開始時間'), '22:30');
  await act(async () => fireEvent.press(view.getByText('儲存設定')));
  expect(save.mock.calls[0][1].quietHoursStart).toBe('22:30');
});

test('notification settings has a detail back action and updates inline colors while mounted', async () => {
  const goBack = jest.fn();
  const view = render(<NotificationSettingsScreen navigation={{ goBack }} />);
  await act(async () => undefined);
  fireEvent.press(view.getByLabelText('返回'));
  expect(goBack).toHaveBeenCalledTimes(1);
  const before = StyleSheet.flatten(view.getByText('公告通知').props.style).color;
  act(() => applyTheme('dark'));
  expect(StyleSheet.flatten(view.getByText('公告通知').props.style).color).toBe(aiTokens.text);
  expect(aiTokens.text).not.toBe(before);
});
