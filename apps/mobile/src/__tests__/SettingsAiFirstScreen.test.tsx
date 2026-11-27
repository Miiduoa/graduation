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
let mockPlatform: {
  session: { platformAccountId: string } | null;
  loading?: boolean;
  error?: string;
  pendingLogout?: boolean;
} | null = null;
let mockLegalBase: string | null = 'https://nuni.tw';
const mockSetMode = jest.fn();
const mockSelectSchool = jest.fn();
let mockSchoolId = 'pu';
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: { id: mockSchoolId, name: mockSchoolId === 'pu' ? '靜宜大學' : '國立清華大學' },
    setSelection: mockSelectSchool,
  }),
}));
jest.mock('../services/schoolDirectory', () => ({
  fetchSchoolDirectory: jest.fn().mockResolvedValue([
    { id: 'pu', code: 'PU', name: '靜宜大學' },
    { id: 'nthu', code: 'NTHU', name: '國立清華大學', shortName: '清大', themeColor: '#7a0019' },
  ]),
}));
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({ mode: mockMode, appearanceMode: mockMode, setMode: mockSetMode }),
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
  mockPlatform = null;
  mockSchoolId = 'pu';
  mockLegalBase = 'https://nuni.tw';
});
afterEach(() => jest.restoreAllMocks());

test('settings rows keep their titles as native labels so the visible copy is findable', () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-screen')).toBeTruthy();
  const accessibility = view.getByLabelText('無障礙設定');
  expect(accessibility.props.testID).toBe('settings-accessibility');
  expect(accessibility.props.accessibilityHint).toBe('查看裝置輔助功能與閱讀設定');
  expect(view.getByText('無障礙設定')).toBeTruthy();
  expect(view.getByLabelText('介面語言').props.testID).toBe('settings-language');
  expect(view.getByLabelText('匯出我的資料').props.testID).toBe('settings-export-data');
  fireEvent.press(accessibility);
  expect(navigation.navigate).toHaveBeenCalledWith('AccessibilitySettings');
  fireEvent.press(view.getByLabelText('匯出我的資料'));
  expect(navigation.navigate).toHaveBeenCalledWith('DataExport');
});

test('export does not swallow a missing navigator', () => {
  const view = render(<SettingsAiFirstScreen />);
  expect(() => fireEvent.press(view.getByLabelText('匯出我的資料'))).toThrow('DataExport');
});

test('account heading has a stable native accessibility target across identity changes', () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  const heading = view.getByTestId('settings-current-account');
  expect(heading.props.collapsable).toBe(false);
  expect(heading.props.accessible).toBe(true);
  expect(heading.props.accessibilityRole).toBe('header');
  expect(heading.props.accessibilityLabel).toBe('目前登入帳號');
  expect(view.getByText('目前登入帳號')).toBeTruthy();
  expect(view.getByText('陳同學')).toBeTruthy();

  mockAuth.user = null;
  mockAuth.profile = null;
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('尚未登入');
  expect(view.getByText('尚未登入')).toBeTruthy();
  expect(view.queryByText('陳同學')).toBeNull();
});

test('settings shows real account and version without fabricated permissions, devices or sync state', () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  const accountHeading = view.getByTestId('settings-current-account');
  expect(accountHeading.props.accessible).toBe(true);
  expect(accountHeading.props.accessibilityLabel).toBe('目前登入帳號');
  expect(view.getByTestId('settings-screen')).toBeTruthy();
  expect(view.getByText('陳同學')).toBeTruthy();
  expect(view.getByText('student-a@example.edu')).toBeTruthy();
  expect(view.getByText('2.3.4')).toBeTruthy();
  expect(view.queryByText(/AI 控制|GDPR|32 MB|09:43|2 台|Google · 已連結|清空 AI/)).toBeNull();
  fireEvent.press(view.getByText('通知設定'));
  expect(navigation.navigate).toHaveBeenCalledWith('NotificationSettings');
  fireEvent.press(view.getByText('助理權限'));
  expect(navigation.navigate).toHaveBeenCalledWith('AssistantPermissions');
  expect(view.getByRole('tab', { name: '淺色' })).toHaveAccessibilityState({ selected: true });
  fireEvent.press(view.getByRole('tab', { name: '跟隨系統' }));
  expect(mockSetMode).toHaveBeenCalledWith('system');
  fireEvent.press(view.getByText('深色'));
  expect(mockSetMode).toHaveBeenCalledWith('dark');
  mockMode = 'dark';
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('目前使用深色模式。')).toBeTruthy();
});

test('Google-only accounts can open assistant permissions while school account actions stay separate', () => {
  mockAuth.user = null;
  mockPlatform = { session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' } };
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('AI 助理')).toBeTruthy();
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('nuni 帳號已登入');
  expect(view.getByText('尚未登入學校帳號')).toBeTruthy();
  expect(view.getByText('仍可管理助理權限；登入學校帳號後可管理校園個人資料。')).toBeTruthy();
  expect(view.queryByText('陳同學')).toBeNull();
  expect(view.queryByText('尚未登入')).toBeNull();
  fireEvent.press(view.getByText('學校登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin');
  fireEvent.press(view.getByText('助理權限'));
  expect(navigation.navigate).toHaveBeenCalledWith('AssistantPermissions');
  expect(view.queryByText('通知設定')).toBeNull();
  expect(view.queryByText('個人資料')).toBeNull();
  expect(view.queryByText('匯出我的資料')).toBeNull();
  expect(view.queryByText('刪除帳號')).toBeNull();
  mockPlatform = { session: null };
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.queryByText('助理權限')).toBeNull();
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('尚未登入');
  expect(view.queryByText('nuni 帳號已登入')).toBeNull();
  expect(view.queryByText('尚未登入學校帳號')).toBeNull();
});

test.each([
  [{ loading: true }, '正在確認 nuni 帳號'],
  [{ error: 'offline' }, '無法確認 nuni 帳號'],
  [{ pendingLogout: true, loading: true }, 'nuni 帳號登出處理中'],
] as const)('unverified platform session %j does not advertise signed-in assistant access', (status, heading) => {
  mockAuth.user = null;
  const session = { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' };
  mockPlatform = { session, ...status };
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe(heading);
  expect(view.queryByText('nuni 帳號已登入')).toBeNull();
  expect(view.queryByText('助理權限')).toBeNull();
  expect(view.queryByText('陳同學')).toBeNull();
  fireEvent.press(view.getByText('學校登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin');

  mockPlatform = { session, loading: false, error: '', pendingLogout: false };
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('nuni 帳號已登入');
  fireEvent.press(view.getByText('助理權限'));
  expect(navigation.navigate).toHaveBeenCalledWith('AssistantPermissions');
});

test.each([
  { session: null },
  { session: null, loading: true },
  { session: null, error: 'offline' },
  { session: null, pendingLogout: true },
  { session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' } },
])('platform account recovery is directly reachable from settings in state %j', (platform) => {
  mockAuth.user = null;
  mockAuth.profile = null;
  mockPlatform = platform;
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  const entry = view.getByLabelText('Google 帳號與連線');
  expect(entry.props.testID).toBe('settings-google-account');
  expect(entry).toBeEnabled();
  fireEvent.press(entry);
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith('NuniWorkspace', { tab: 'account' });
  expect(mockAuth.signOutWithWarning).not.toHaveBeenCalled();
  expect(view.queryByText('匯出我的資料')).toBeNull();
  expect(view.queryByText('刪除帳號')).toBeNull();
});

test('settings does not offer platform account navigation without a platform provider', () => {
  mockPlatform = null;
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.queryByTestId('settings-google-account')).toBeNull();
});

test('dual account settings retain one assistant permissions entry', () => {
  mockPlatform = { session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' } };
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getAllByText('助理權限')).toHaveLength(1);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('目前登入帳號');
  expect(view.queryByText('尚未登入學校帳號')).toBeNull();
  expect(view.getByText('通知設定')).toBeTruthy();
});

test.each([
  [{ session: null }, '登入 nuni 帳號或管理學校資格'],
  [{ session: null, loading: true }, '正在確認登入狀態'],
  [{ session: null, error: 'offline' }, '無法確認登入狀態；前往帳號管理重試'],
  [{ session: null, pendingLogout: true }, '登出尚未完成；前往帳號管理重試'],
  [{ session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' } }, '已登入 nuni 帳號；管理學校資格與連線狀態'],
] as const)('school sign-in does not mask independent platform status %j', (platform, subtitle) => {
  mockPlatform = platform;
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('目前登入帳號');
  expect(view.getByLabelText('Google 帳號與連線').props.accessibilityHint).toBe(subtitle);
  expect(view.getByText(subtitle)).toBeTruthy();
  expect(view.getAllByText('助理權限')).toHaveLength(1);
});

test('school logout clearly scopes the action and leaves the platform account independently visible', async () => {
  mockPlatform = { session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' } };
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByLabelText('登出學校帳號'));
  expect(alert.mock.calls[0][0]).toBe('登出學校帳號');
  expect(alert.mock.calls[0][1]).toBe('確定要登出學校帳號嗎？不會登出 Google 帳號。');
  expect(mockAuth.signOutWithWarning).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '確定登出')?.onPress?.());
  expect(mockAuth.signOutWithWarning).toHaveBeenCalledTimes(1);
  mockAuth.user = null;
  mockAuth.profile = null;
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByTestId('settings-current-account').props.accessibilityLabel).toBe('nuni 帳號已登入');
  expect(view.queryByLabelText('登出學校帳號')).toBeNull();
  expect(view.getByLabelText('Google 帳號與連線')).toBeTruthy();
  expect(view.getByText('助理權限')).toBeTruthy();
});

test('logout invokes real auth once, and cancellation never changes navigation', async () => {
  const pending = deferred<boolean>();
  mockAuth.signOutWithWarning.mockReturnValue(pending.promise);
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出學校帳號'));
  const confirm = alert.mock.calls[0][2]?.find((item) => item.text === '確定登出')?.onPress;
  act(() => {
    void confirm?.();
    void confirm?.();
  });
  expect(mockAuth.signOutWithWarning).toHaveBeenCalledTimes(1);
  expect(view.getByText('正在登出…')).toBeTruthy();
  await act(async () => pending.resolve(false));
  expect(view.getByText('登出學校帳號')).toBeTruthy();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('a stale logout confirmation cannot sign out a newly selected account', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出學校帳號'));
  mockAuth.user = { uid: 'student-b', email: 'student-b@example.edu' };
  view.rerender(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.queryByText('陳同學')).toBeNull();
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '確定登出')?.onPress?.());
  expect(mockAuth.signOutWithWarning).not.toHaveBeenCalled();
});

test('logout rejection remains on settings with retry and does not pretend to sign out', async () => {
  mockAuth.signOutWithWarning.mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('登出學校帳號'));
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '確定登出')?.onPress?.());
  expect(view.getByText('無法登出，請稍後重試。')).toBeTruthy();
  expect(view.getByText('登出學校帳號')).toBeTruthy();
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
  expect(view.queryByText('登出學校帳號')).toBeNull();
  expect(view.queryByText('匯出我的資料')).toBeNull();
  fireEvent.press(view.getByText('學校登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin');
});

test('selecting another campus changes browsing identity without changing the signed-in account', async () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  expect(view.getByText('靜宜大學')).toBeTruthy();
  fireEvent.press(view.getByText('選擇其他學校'));
  await view.findByText('國立清華大學');
  fireEvent.changeText(view.getByLabelText('搜尋學校'), '清華');
  fireEvent.press(view.getByLabelText('選擇國立清華大學'));
  expect(mockSelectSchool).toHaveBeenCalledWith({
    schoolId: 'nthu',
    code: 'NTHU',
    schoolName: '國立清華大學',
    shortName: '清大',
    themeColor: '#7a0019',
    domains: null,
  });
  expect(view.getByText('student-a@example.edu')).toBeTruthy();
});

test('school search can be cleared and dismissed without changing the selected campus', async () => {
  const view = render(<SettingsAiFirstScreen navigation={navigation} />);
  fireEvent.press(view.getByText('選擇其他學校'));
  await view.findByText('國立清華大學');
  fireEvent.changeText(view.getByLabelText('搜尋學校'), '不存在的校名');
  expect(view.getByText('找不到符合的學校，請換個關鍵字。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '清除學校搜尋' }));
  expect(view.getByLabelText('搜尋學校').props.value).toBe('');
  expect(view.getByText('國立清華大學')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '完成校園選擇' }));
  expect(view.queryByText('選擇瀏覽校園')).toBeNull();
  expect(view.getByText('靜宜大學')).toBeTruthy();
  expect(mockSelectSchool).not.toHaveBeenCalled();
});
