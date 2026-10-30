import React from 'react';
import { fireEventAsync, renderAsync } from '@testing-library/react-native';
import type { useNuniSession } from '../state/nuniSession';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { safeNavigate } from '../utils/safeNavigate';

const mockNavigation = { navigate: jest.fn() };
let mockAuth: ReturnType<typeof useNuniSession>;
let mockProviderAvailable = false;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }),
}));
jest.mock('../ui/useThemeStyleSheet', () => ({
  useThemeStyleSheet: <T,>(create: () => T) => create(),
}));
jest.mock('../services/schoolLoginAvailability', () => ({
  isSchoolLoginEntryAvailable: () => mockProviderAvailable,
  loadSchoolLoginProviderKinds: jest.fn(async () => []),
}));
jest.mock('../components/SchoolBrowsingControl', () => ({
  SchoolBrowsingControl: () => null,
}));
jest.mock('../components/TodayTimetablePanel', () => ({
  TodayTimetablePanel: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProviderAvailable = false;
  mockAuth = {
    session: null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: jest.fn(),
    signIn: jest.fn(),
    logout: jest.fn(),
    request: jest.fn(),
  };
});

function landing() {
  return renderAsync(<LoginLandingScreen />);
}

it('places the import and account actions before the long public-service list', async () => {
  const view = await landing();
  const tree = JSON.stringify(view.toJSON());
  const importIndex = tree.indexOf('"testID":"school-import-start"');
  const accountIndex = tree.indexOf('"testID":"login-start"');
  const servicesIndex = tree.indexOf('"testID":"public-Map"');
  expect(importIndex).toBeGreaterThanOrEqual(0);
  expect(accountIndex).toBeGreaterThan(importIndex);
  expect(servicesIndex).toBeGreaterThan(accountIndex);
  expect(view.getAllByTestId(/^public-/)).toHaveLength(10);
  expect(safeNavigate).not.toHaveBeenCalled();
});

it('provides a named header shortcut to the platform workspace without starting sign-in', async () => {
  const view = await landing();
  const shortcut = view.getByTestId('platform-workspace-start');
  expect(shortcut.props.accessibilityRole).toBe('button');
  expect(shortcut.props.accessibilityLabel).toBe('開啟課程與作業');
  await fireEventAsync.press(shortcut);
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace', { tab: 'courses' });
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

it.each([false, true])('keeps manual import independent of provider availability (%s)', async (available) => {
  mockProviderAvailable = available;
  const view = await landing();
  expect(view.queryByTestId('school-login-start')).toBeNull();
  expect(view.getByText(/學校帳號連線已停止/)).toBeTruthy();
  expect(view.queryByText('使用學號連線')).toBeNull();
  await fireEventAsync.press(view.getByTestId('school-import-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'PersonalImport', {
    kind: 'timetable',
  });
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

it.each([
  { label: '登入或建立帳號', patch: {} },
  { label: '確認 Google 帳號', patch: { loading: true } },
  { label: '處理未完成的登出', patch: { pendingLogout: true } },
  { label: '查看登入問題', patch: { error: '目前無法連線' } },
])('preserves the account recovery state: $label', async ({ label, patch }) => {
  mockAuth = { ...mockAuth, ...patch };
  const view = await landing();
  expect(view.getByText(label)).toBeTruthy();
  await fireEventAsync.press(view.getByTestId('login-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

it('opens public information without starting an account or school login', async () => {
  const view = await landing();
  await fireEventAsync.press(view.getByTestId('public-Map'));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'Map');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});
