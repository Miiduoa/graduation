import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import Constants from 'expo-constants';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { SSOLoginScreen } from '../screens/SSOLoginScreen';
import { signInWithStudentId } from '../services/studentIdAuth';
import { safeNavigate } from '../utils/safeNavigate';
import { applyTheme, createLightTheme, createDarkTheme, clearSchoolTheme } from '../ui/theme';

const mockNavigation = { navigate: jest.fn() };
const mockGooglePrompt = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ refreshProfile: jest.fn() }) }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學', shortName: '靜宜' } }),
}));
jest.mock('../services/studentIdAuth', () => ({ signInWithStudentId: jest.fn() }));
jest.mock('../firebase', () => ({ getAuthInstance: jest.fn() }));
jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn() },
  signInWithCredential: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [null, null, mockGooglePrompt],
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 80,
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
}));

beforeEach(() => {
  jest.clearAllMocks();
  Constants.expoConfig!.extra = {};
  clearSchoolTheme();
  applyTheme('light');
  mockGooglePrompt.mockResolvedValue({ type: 'cancel' });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  act(() => applyTheme('light'));
});

function enterSchoolCredentials(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByTestId('student-id-input'), 'S123456');
  fireEvent.changeText(view.getByTestId('student-password-input'), 'test-password');
}

test('guest landing exposes stable native smoke targets and follows shared light/dark colors', () => {
  const view = render(<LoginLandingScreen />);
  expect(view.getByTestId('login-landing')).toHaveStyle({
    backgroundColor: createLightTheme().colors.bg,
  });
  expect(view.getByTestId('login-start')).toHaveStyle({
    backgroundColor: createLightTheme().colors.accent,
  });
  fireEvent.press(view.getByTestId('login-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'SSOLogin');
  act(() => applyTheme('dark'));
  expect(view.getByTestId('login-landing')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.bg,
  });
  expect(view.getByTestId('login-start')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.accent,
  });
  expect(view.getByText('前往登入 ↗')).toHaveStyle({ color: createDarkTheme().colors.onAccent });
});

test('an unconfigured Google provider is honestly unavailable without exposing implementation instructions', () => {
  const view = render(<SSOLoginScreen />);
  expect(view.getByRole('button', { name: 'Google 登入暫時無法使用' })).toBeDisabled();
  expect(
    view.queryByText(/Firebase|Firestore|Client ID|Demo|TronClass|OAuth|AsyncStorage|TTL|技術資訊/),
  ).toBeNull();
  expect(view.getByText('學校帳號登入')).toBeTruthy();
  act(() => applyTheme('dark'));
  expect(view.getByTestId('student-id-input')).toHaveStyle({
    color: createDarkTheme().colors.text,
  });
  expect(mockGooglePrompt).not.toHaveBeenCalled();
});

test('a configured Google provider still invokes the existing sign-in request', async () => {
  Constants.expoConfig!.extra = { googleWebClientId: 'configured-test-client' };
  const view = render(<SSOLoginScreen />);
  expect(view.getByRole('button', { name: '使用 Google 繼續' })).not.toBeDisabled();
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(mockGooglePrompt).toHaveBeenCalledTimes(1);
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
  expect(view.queryByText(/Firebase|Firestore|Client ID|登入成功/)).toBeNull();
  expect(view.getByText('重新嘗試')).toBeTruthy();
});
