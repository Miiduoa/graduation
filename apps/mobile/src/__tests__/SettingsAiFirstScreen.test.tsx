import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import SettingsAiFirstScreen from '../screens/SettingsAiFirstScreen';

let mockAuth: {
  user: { uid: string; email: string } | null;
  profile: { uid: string; displayName: string } | null;
  signOutWithWarning: jest.Mock;
};
let mockMode: 'light' | 'dark' = 'light';
let mockLegalBase: string | null = 'https://nuni.tw';
const mockSetMode = jest.fn();
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({ mode: mockMode, setMode: mockSetMode }),
}));
jest.mock('../services/release', () => ({
  getLegalUrl: (kind: string) => (mockLegalBase ? `${mockLegalBase}/${kind}` : null),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '2.3.4' } }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { uid: 'student-a', email: 'student-a@example.edu' },
    profile: { uid: 'student-a', displayName: '陳同學' },
    signOutWithWarning: jest.fn().mockResolvedValue(true),
  };
  mockMode = 'light';
  mockLegalBase = 'https://nuni.tw';
});
afterEach(() => jest.restoreAllMocks());

test('settings shows real account and version without fabricated permissions, devices or sync state', () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('陳同學')).toBeTruthy();
  expect(view.getByText('student-a@example.edu')).toBeTruthy();
  expect(view.getByText('2.3.4')).toBeTruthy();
  expect(
    view.queryByText(/AI 控制|GDPR|32 MB|09:43|2 台|Google · 已連結|跟隨系統|清空 AI/),
  ).toBeNull();
  fireEvent.press(view.getByText('通知設定'));
  expect(navigation.navigate).toHaveBeenCalledWith('NotificationSettings');
  fireEvent.press(view.getByText('深色'));
  expect(mockSetMode).toHaveBeenCalledWith('dark');
  mockMode = 'dark';
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('目前使用深色模式。')).toBeTruthy();
});

test('logout invokes real auth once, and cancellation never changes navigation', async () => {
  const pending = deferred<boolean>();
  mockAuth.signOutWithWarning.mockReturnValue(pending.promise);
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出'));
  const confirm = alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress;
  act(() => {
    void confirm?.();
    void confirm?.();
  });
  expect(mockAuth.signOutWithWarning).toHaveBeenCalledTimes(1);
  expect(view.getByText('正在登出…')).toBeTruthy();
  await act(async () => pending.resolve(false));
  expect(view.getByText('登出')).toBeTruthy();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('a stale logout confirmation cannot sign out a newly selected account', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出'));
  mockAuth.user = { uid: 'student-b', email: 'student-b@example.edu' };
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.queryByText('陳同學')).toBeNull();
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress?.());
  expect(mockAuth.signOutWithWarning).not.toHaveBeenCalled();
});

test('logout rejection remains on settings with retry and does not pretend to sign out', async () => {
  mockAuth.signOutWithWarning.mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出'));
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress?.());
  expect(view.getByText('無法登出，請稍後重試。')).toBeTruthy();
  expect(view.getByText('登出')).toBeTruthy();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('legal entries open configured documents and report opening failures', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('offline'));
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  await act(async () => fireEvent.press(view.getByText('隱私政策')));
  expect(open).toHaveBeenCalledWith('https://nuni.tw/privacy');
  expect(view.getByText('無法開啟網頁，請確認網路連線後重試。')).toBeTruthy();
});

test('missing legal configuration is unavailable and signed-out users see no account actions', () => {
  mockLegalBase = null;
  mockAuth.user = null;
  const open = jest.spyOn(Linking, 'openURL');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('目前無法提供隱私政策連結')).toBeTruthy();
  fireEvent.press(view.getByText('隱私政策'));
  expect(open).not.toHaveBeenCalled();
  expect(view.queryByText('陳同學')).toBeNull();
  expect(view.queryByText('登出')).toBeNull();
  expect(view.queryByText('匯出我的資料')).toBeNull();
  fireEvent.press(view.getByText('學校登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin');
});
