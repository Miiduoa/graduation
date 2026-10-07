import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { AccessTokenRequest, TokenResponse } from 'expo-auth-session/build/TokenRequest';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { SSOLoginScreen } from '../screens/SSOLoginScreen';
import { signInWithStudentId } from '../services/studentIdAuth';
import { safeNavigate } from '../utils/safeNavigate';
import { applyTheme, createLightTheme, createDarkTheme, clearSchoolTheme } from '../ui/theme';

const mockNavigation = { navigate: jest.fn() };
const mockGooglePrompt = jest.fn();
const mockLoadedRequest = {
  url: 'https://accounts.google.com/test',
  codeVerifier: 'test-verifier',
  clientId: 'configured-ios-client',
  redirectUri: 'com.campus.app:/oauthredirect',
};
const mockUseLoadedAuthRequest = jest.fn((): typeof mockLoadedRequest | null => mockLoadedRequest);
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
jest.mock('expo-auth-session/build/AuthRequestHooks', () => ({
  useLoadedAuthRequest: (...args: unknown[]) => mockUseLoadedAuthRequest(...args),
  useAuthRequestResult: () => {
    const React = jest.requireActual('react');
    const [response, setResponse] = React.useState(null);
    return [
      response,
      async () => {
        const result = await mockGooglePrompt();
        setResponse(result);
        return result;
      },
    ];
  },
}));
jest.mock('expo-auth-session/build/AuthSession', () => ({
  makeRedirectUri: () => 'com.campus.app:/oauthredirect',
}));
jest.mock('../services/companionEngine', () => ({ recordCompanionFeatureSignal: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 80,
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLoadedAuthRequest.mockReturnValue(mockLoadedRequest);
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(Platform, 'select').mockImplementation((specifics) => {
    if (Platform.OS === 'ios') return specifics.ios ?? specifics.default;
    if (Platform.OS === 'android') return specifics.android ?? specifics.default;
    return specifics.web ?? specifics.default;
  });
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
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  const view = render(<SSOLoginScreen />);
  expect(view.getByRole('button', { name: '使用 Google 繼續' })).not.toBeDisabled();
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(mockGooglePrompt).toHaveBeenCalledTimes(1);
  expect(mockUseLoadedAuthRequest).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: 'configured-ios-client', responseType: 'code' }),
    expect.anything(),
    expect.anything(),
  );
});

test.each(['ios', 'android'] as const)(
  '%s without its own client ID keeps school login usable even when Web Google is configured',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    Constants.expoConfig!.extra = { googleWebClientId: 'configured-web-client' };
    jest.mocked(signInWithStudentId).mockRejectedValueOnce(new Error('test rejection'));
    const view = render(<SSOLoginScreen />);
    expect(view.getByRole('button', { name: 'Google 登入暫時無法使用' })).toBeDisabled();
    expect(mockUseLoadedAuthRequest).not.toHaveBeenCalled();
    enterSchoolCredentials(view);
    fireEvent.press(view.getByText('使用學號登入'));
    await view.findByText('學校帳號登入未完成，請確認帳號密碼與網路連線後重試。');
    expect(signInWithStudentId).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'S123456', password: 'test-password' }),
    );
    expect(mockGooglePrompt).not.toHaveBeenCalled();
    expect(signInWithCredential).not.toHaveBeenCalled();
  },
);

test.each([
  ['ios', 'googleIosClientId'],
  ['android', 'googleAndroidClientId'],
  ['web', 'googleWebClientId'],
] as const)('%s initializes only its own configured client ID', (platform, key) => {
  jest.replaceProperty(Platform, 'OS', platform);
  Constants.expoConfig!.extra = { [key]: '  current-platform-client  ' };
  const view = render(<SSOLoginScreen />);
  expect(view.getByRole('button', { name: '使用 Google 繼續' })).not.toBeDisabled();
  expect(mockUseLoadedAuthRequest).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: 'current-platform-client' }),
    expect.anything(),
    expect.anything(),
  );
});

test('a whitespace-only native client ID stays unavailable without creating a request', () => {
  Constants.expoConfig!.extra = { googleIosClientId: '   ' };
  const view = render(<SSOLoginScreen />);
  expect(view.getByRole('button', { name: 'Google 登入暫時無法使用' })).toBeDisabled();
  expect(mockUseLoadedAuthRequest).not.toHaveBeenCalled();
});

test('configured Google login waits for request readiness and excludes concurrent school login', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  mockUseLoadedAuthRequest.mockReturnValue(null);
  const view = render(<SSOLoginScreen />);
  fireEvent.press(view.getByText('正在準備 Google 登入…'));
  expect(mockGooglePrompt).not.toHaveBeenCalled();
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
  mockUseLoadedAuthRequest.mockReturnValue(mockLoadedRequest);
  view.rerender(<SSOLoginScreen />);
  mockGooglePrompt.mockImplementationOnce(() => new Promise(() => undefined));
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(view.getByTestId('student-id-input').props.editable).toBe(false);
  expect(view.getByRole('button', { name: 'Google 登入處理中…' })).toBeDisabled();
});

test('native code-only prompt exchanges with PKCE and starts Firebase exactly once', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  jest.mocked(signInWithCredential).mockImplementationOnce(() => new Promise(() => undefined));
  let finishExchange!: (response: TokenResponse) => void;
  const exchange = jest.spyOn(AccessTokenRequest.prototype, 'performAsync').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishExchange = resolve;
      }),
  );
  mockGooglePrompt.mockResolvedValueOnce({ type: 'success', params: { code: 'native-code' } });
  const view = render(<SSOLoginScreen />);
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(exchange.mock.contexts[0]).toMatchObject({
    clientId: 'configured-ios-client',
    code: 'native-code',
    redirectUri: 'com.campus.app:/oauthredirect',
    extraParams: { code_verifier: 'test-verifier' },
  });
  expect(signInWithCredential).not.toHaveBeenCalled();
  expect(view.queryByText('Google 登入未完成，請稍後重試或改用學校帳號。')).toBeNull();
  await act(async () =>
    finishExchange(
      new TokenResponse({
        accessToken: 'test-access-token',
        idToken: 'test-id-token',
      }),
    ),
  );
  await waitFor(() => expect(signInWithCredential).toHaveBeenCalledTimes(1));
  expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('test-id-token');
  expect(view.getByTestId('student-id-input').props.editable).toBe(false);
  act(() => applyTheme('dark'));
  expect(signInWithCredential).toHaveBeenCalledTimes(1);
});

test('a failed native code exchange restores school login and allows a new Google attempt', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  const exchange = jest
    .spyOn(AccessTokenRequest.prototype, 'performAsync')
    .mockRejectedValueOnce(new Error('token endpoint unavailable'));
  mockGooglePrompt.mockResolvedValueOnce({ type: 'success', params: { code: 'native-code' } });
  const view = render(<SSOLoginScreen />);
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(view.getByText('Google 登入未完成，請稍後重試或改用學校帳號。')).toBeTruthy();
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
  expect(signInWithCredential).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(mockGooglePrompt).toHaveBeenCalledTimes(2);
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
});

test('cancelled Google login unlocks school login without creating a Firebase session', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  const view = render(<SSOLoginScreen />);
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  await waitFor(() => expect(view.getByTestId('student-id-input').props.editable).toBe(true));
  expect(signInWithCredential).not.toHaveBeenCalled();
});

test('a rejected Google prompt reports failure and restores the school form', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  mockGooglePrompt.mockRejectedValueOnce(new Error('browser unavailable'));
  const view = render(<SSOLoginScreen />);
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(view.getByText('Google 登入未完成，請稍後重試或改用學校帳號。')).toBeTruthy();
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
  expect(signInWithCredential).not.toHaveBeenCalled();
});

test('a Google success response without an ID token never becomes a Firebase login', async () => {
  Constants.expoConfig!.extra = { googleIosClientId: 'configured-ios-client' };
  mockGooglePrompt.mockResolvedValueOnce({ type: 'success', params: {} });
  const view = render(<SSOLoginScreen />);
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(view.getByText('Google 登入未完成，請稍後重試或改用學校帳號。')).toBeTruthy();
  expect(view.getByTestId('student-id-input').props.editable).toBe(true);
  expect(signInWithCredential).not.toHaveBeenCalled();
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
