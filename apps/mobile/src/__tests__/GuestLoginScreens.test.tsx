import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { signInWithCredential } from 'firebase/auth';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { SSOLoginScreen } from '../screens/SSOLoginScreen';
import { signInWithStudentId } from '../services/studentIdAuth';
import { safeNavigate } from '../utils/safeNavigate';
import { applyTheme, createLightTheme, createDarkTheme, clearSchoolTheme } from '../ui/theme';
import { Button } from '../ui/components';

const mockNavigation = { navigate: jest.fn() };
const mockRefreshProfile = jest.fn();
let mockPlatformAuth = {
  session: null as { platformAccountId: string } | null,
  loading: false,
  error: '',
  pendingLogout: false,
};
let mockFocus: (() => void) | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => {
    mockFocus = callback;
    jest.requireActual('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ refreshProfile: mockRefreshProfile }) }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockPlatformAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學', shortName: '靜宜' } }),
}));
jest.mock('../services/studentIdAuth', () => ({ signInWithStudentId: jest.fn() }));
jest.mock('../firebase', () => ({ getAuthInstance: jest.fn() }));
jest.mock('firebase/auth', () => ({ signInWithCredential: jest.fn() }));
jest.mock('../services/companionEngine', () => ({ recordCompanionFeatureSignal: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 80,
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatformAuth = { session: null, loading: false, error: '', pendingLogout: false };
  jest.mocked(signInWithStudentId).mockReset();
  mockRefreshProfile.mockReset();
  mockRefreshProfile.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  clearSchoolTheme();
  applyTheme('light');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  act(() => applyTheme('light'));
});

function enterSchoolCredentials(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByTestId('student-id-input'), 'S123456');
  fireEvent.changeText(view.getByTestId('student-password-input'), 'test-password');
}
const schoolResult = {
  displayName: '同學',
  department: '資訊系',
} as Awaited<ReturnType<typeof signInWithStudentId>>;

test('the platform account entry uses the same account destination without signing into Firebase', () => {
  const view = render(<SSOLoginScreen />);
  expect(view.getByText('和網頁版使用同一個帳號')).toBeTruthy();
  expect(view.queryByText(/Firebase|Firestore|Client ID|Demo|TronClass|OAuth/)).toBeNull();
  fireEvent.press(view.getByText('前往 Campus One 帳號'));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('NuniWorkspace');
  expect(signInWithCredential).not.toHaveBeenCalled();
  expect(signInWithStudentId).not.toHaveBeenCalled();
  expect(mockRefreshProfile).not.toHaveBeenCalled();
});

test('a pending school request keeps both the form and platform navigation locked', () => {
  jest.mocked(signInWithStudentId).mockImplementation(() => new Promise(() => undefined));
  const view = render(<SSOLoginScreen />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('使用學號登入'));
  expect(view.getByRole('progressbar', { name: '登入處理中，確認學校帳號' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '重新嘗試' })).toBeNull();
  const platform = view.getByRole('button', { name: '前往 Campus One 帳號' });
  expect(platform).toBeDisabled();
  fireEvent.press(platform);
  fireEvent.press(view.getByRole('button', { name: '登入中…' }));
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(signInWithStudentId).toHaveBeenCalledTimes(1);
});

test.each(['school', 'platform'] as const)(
  '%s owns the same-tick lock before captured handlers can start the other flow',
  (first) => {
    jest.mocked(signInWithStudentId).mockImplementation(() => new Promise(() => undefined));
    const view = render(<SSOLoginScreen />);
    enterSchoolCredentials(view);
    const buttons = view.UNSAFE_getAllByType(Button);
    const school = buttons.find((button) => button.props.text === '使用學號登入')!.props.onPress;
    const platform = buttons.find((button) => button.props.text === '前往 Campus One 帳號')!.props
      .onPress;
    act(() => {
      if (first === 'school') {
        void school();
        void school();
        platform();
      } else {
        platform();
        platform();
        void school();
      }
    });
    expect(signInWithStudentId).toHaveBeenCalledTimes(first === 'school' ? 1 : 0);
    expect(mockNavigation.navigate).toHaveBeenCalledTimes(first === 'platform' ? 1 : 0);
    expect(signInWithCredential).not.toHaveBeenCalled();
  },
);

test('returning from the platform account page restores the school form', () => {
  const view = render(<SSOLoginScreen />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('前往 Campus One 帳號'));
  expect(view.getByTestId('student-id-input').props.editable).toBe(false);
  act(() => mockFocus?.());
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
  expect(view.getByRole('button', { name: '使用學號登入' })).not.toBeDisabled();
});

test('a failed school request unlocks the platform choice and supports a school retry', async () => {
  jest.mocked(signInWithStudentId).mockRejectedValueOnce(new Error('invalid credentials'));
  const view = render(<SSOLoginScreen />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('使用學號登入'));
  await view.findByText('學校帳號登入未完成，請確認帳號密碼與網路連線後重試。');
  expect(view.getByRole('button', { name: '前往 Campus One 帳號' })).not.toBeDisabled();
  fireEvent.press(view.getByText('重新嘗試'));
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
});

test('school success keeps both flows locked and clears the pending dialog after unmount', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(signInWithStudentId).mockResolvedValueOnce(schoolResult);
    const view = render(<SSOLoginScreen />);
    enterSchoolCredentials(view);
    await act(async () => fireEvent.press(view.getByText('使用學號登入')));
    expect(view.getByText('登入完成')).toBeTruthy();
    expect(view.getByRole('button', { name: '使用學號登入' })).toBeDisabled();
    expect(view.getByRole('button', { name: '前往 Campus One 帳號' })).toBeDisabled();
    view.unmount();
    act(() => jest.advanceTimersByTime(250));
    expect(Alert.alert).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('guest landing exposes stable native smoke targets and follows shared light/dark colors', () => {
  const view = render(<LoginLandingScreen />);
  expect(view.getByTestId('login-landing')).toHaveStyle({
    backgroundColor: createLightTheme().colors.bg,
  });
  expect(view.getByTestId('login-start')).toHaveStyle({
    backgroundColor: createLightTheme().colors.accent,
  });
  fireEvent.press(view.getByTestId('login-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
  fireEvent.press(view.getByTestId('school-login-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'SSOLogin');
  act(() => applyTheme('dark'));
  expect(view.getByTestId('login-landing')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.bg,
  });
  expect(view.getByTestId('login-start')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.accent,
  });
  expect(view.getByText('登入或建立帳號')).toHaveStyle({
    color: createDarkTheme().colors.onAccent,
  });
});

test('school credentials retain explicit accessible names and password autofill semantics', () => {
  const view = render(<SSOLoginScreen />);
  expect(view.getByLabelText('學號')).toBe(view.getByTestId('student-id-input'));
  expect(view.getByLabelText('密碼')).toBe(view.getByTestId('student-password-input'));
  expect(view.getByLabelText('學號').props.autoComplete).toBe('username');
  expect(view.getByLabelText('密碼').props.autoComplete).toBe('current-password');
  expect(view.getByLabelText('密碼').props.secureTextEntry).toBe(true);
});

test('school sign-in progress keeps the same stage and form locking without displaying service internals', async () => {
  jest.mocked(signInWithStudentId).mockImplementation(({ onProgress }) => {
    onProgress?.('syncingTronClass', 'TronClass Demo Firebase backend unavailable');
    return new Promise(() => undefined);
  });
  const view = render(<SSOLoginScreen />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('使用學號登入'));
  expect(signInWithStudentId).toHaveBeenCalledWith(
    expect.objectContaining({ studentId: 'S123456', password: 'test-password' }),
  );
  expect(view.getAllByText('同步課程資料').length).toBeGreaterThan(0);
  expect(view.queryByText(/TronClass|Demo|Firebase|內部登入/)).toBeNull();
  expect(view.getByTestId('student-id-input').props.editable).toBe(false);
  expect(view.getByTestId('student-password-input').props.secureTextEntry).toBe(true);
});

test('school login errors remain failures with a human-readable retry state', async () => {
  jest
    .mocked(signInWithStudentId)
    .mockRejectedValueOnce(new Error('Firebase Firestore Client ID internal error'));
  const view = render(<SSOLoginScreen />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('使用學號登入'));
  await view.findByText('學校帳號登入未完成，請確認帳號密碼與網路連線後重試。');
  expect(view.getByRole('alert')).toHaveTextContent(/學校帳號登入未完成/);
  expect(view.queryByText(/Firebase|Firestore|Client ID|登入成功/)).toBeNull();
  expect(view.getByText('重新嘗試')).toBeTruthy();
});

test('a school service completion after unmount cannot refresh the screen or show a dialog', async () => {
  let finish!: (result: typeof schoolResult) => void;
  jest.mocked(signInWithStudentId).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const goBack = jest.fn();
  const view = render(<SSOLoginScreen navigation={{ goBack }} />);
  enterSchoolCredentials(view);
  fireEvent.press(view.getByText('使用學號登入'));
  const progress = jest.mocked(signInWithStudentId).mock.calls[0][0].onProgress;
  view.unmount();
  await act(async () => {
    progress?.('linking');
    finish(schoolResult);
  });
  expect(mockRefreshProfile).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
});

test('an already displayed success dialog cannot navigate after its screen unmounts', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(signInWithStudentId).mockResolvedValueOnce(schoolResult);
    const goBack = jest.fn();
    const view = render(<SSOLoginScreen navigation={{ goBack }} />);
    enterSchoolCredentials(view);
    await act(async () => fireEvent.press(view.getByText('使用學號登入')));
    act(() => jest.advanceTimersByTime(250));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const confirm = jest.mocked(Alert.alert).mock.calls[0][2]?.[0].onPress;
    view.unmount();
    act(() => confirm?.());
    expect(goBack).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('a restored platform account has a return entry rather than another registration prompt', () => {
  mockPlatformAuth.session = { platformAccountId: 'pa-restored' };
  const view = render(<LoginLandingScreen />);
  expect(view.getByRole('button', { name: '回到我的 Campus One' })).toBeTruthy();
  expect(view.queryByText('登入或建立帳號')).toBeNull();
  fireEvent.press(view.getByTestId('login-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
});

test('an unknown platform account state remains an explicit recovery entry', () => {
  mockPlatformAuth.error = 'could not verify';
  const view = render(<LoginLandingScreen />);
  expect(view.getByRole('button', { name: '繼續確認帳號狀態' })).toBeTruthy();
  expect(view.queryByText('回到我的 Campus One')).toBeNull();
});
