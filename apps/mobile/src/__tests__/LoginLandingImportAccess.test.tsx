import React from 'react';
import { Linking, ScrollView } from 'react-native';
import { fireEventAsync, renderAsync } from '@testing-library/react-native';
import type { useNuniSession } from '../state/nuniSession';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { safeNavigate } from '../utils/safeNavigate';

const mockNavigation = { navigate: jest.fn() };
let mockAuth: ReturnType<typeof useNuniSession>;
let mockProviderAvailable = false;
let mockSchool = { id: 'pu', name: '靜宜大學' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool }),
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
let mockPanelProps: Record<string, unknown> | undefined;
jest.mock('../components/TodayTimetablePanel', () => ({
  TodayTimetablePanel: (props: Record<string, unknown>) => {
    mockPanelProps = props;
    return require('react').createElement(
      require('react-native').Text, { testID: 'today-timetable-panel' }, '今天的課表',
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPanelProps = undefined;
  mockProviderAvailable = false;
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockAuth = {
    session: null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: jest.fn(),
    signIn: jest.fn(),
    logout: jest.fn(),
    request: jest.fn(),
    upload: jest.fn(),
    bffRequest: jest.fn(),
    isSessionCurrent: jest.fn(),
  };
});

function landing() {
  return renderAsync(<LoginLandingScreen />);
}

it('lets the school picker handle the first result tap while its keyboard is open', async () => {
  const view = await landing();
  // Modal touches still pass through the landing ScrollView's responder capture.
  expect(view.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});

it('offers guest shortcuts before account setup and keeps school imports after the account entry', async () => {
  const view = await landing();
  const tree = JSON.stringify(view.toJSON());
  const importIndex = tree.indexOf('"testID":"school-import-start"');
  const accountIndex = tree.indexOf('"testID":"login-start"');
  const servicesIndex = tree.indexOf('"testID":"public-Map"');
  expect(importIndex).toBeGreaterThanOrEqual(0);
  expect(accountIndex).toBeGreaterThanOrEqual(0);
  expect(importIndex).toBeGreaterThan(accountIndex);
  expect(servicesIndex).toBeGreaterThanOrEqual(0);
  expect(servicesIndex).toBeLessThan(accountIndex);
  expect(view.getAllByTestId(/^public-/)).toHaveLength(11);
  expect(view.getByTestId('public-StudentCard').props.accessibilityLabel).toBe('數位學生證');
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
  expect(Boolean(view.queryByTestId('school-login-start'))).toBe(available);
  expect(Boolean(view.queryByTestId('school-login-hint'))).toBe(!available);
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

it.each(['Map', 'StudentCard'])(
  'opens public %s without starting an account or school login',
  async (route) => {
    const view = await landing();
    await fireEventAsync.press(view.getByTestId(`public-${route}`));
    expect(safeNavigate).toHaveBeenCalledTimes(1);
    expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, route);
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  },
);

it('offers student card verification when the selected school has no official card service', async () => {
  mockSchool = { id: 'ntu', name: '國立臺灣大學' };
  const view = await landing();
  expect(view.getByText('出示學生證，或核對對方的校園身分')).toBeTruthy();
  await fireEventAsync.press(view.getByTestId('public-StudentCard'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'StudentCard');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

it('opens a task-specific login without asking for school credentials or granting a role', async () => {
  const web = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try {
    const view = await landing();
    const work = view.getByRole('button', { name: '店家與教職員入口' });
    expect(work.props.accessibilityState.expanded).toBe(false);
    await fireEventAsync.press(work);
    await fireEventAsync.press(view.getByRole('button', { name: '店家進駐與門市管理' }));
    expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'NuniWorkspace', { tab: 'merchant' });
    await fireEventAsync.press(view.getByRole('button', { name: '教師課程' }));
    expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'NuniWorkspace', { tab: 'courses' });
    await fireEventAsync.press(view.getByRole('link', { name: '校方人員登入（網頁）' }));
    expect(web).toHaveBeenLastCalledWith('https://nuni.tw/auth/account?method=school');
    await fireEventAsync.press(view.getByRole('link', { name: '平台管理員登入（網頁）' }));
    expect(web).toHaveBeenLastCalledWith('https://nuni.tw/admin/login');
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  } finally {
    web.mockRestore();
  }
});

it.each([false, true])('opens the platform without selecting or verifying a school (Google session: %s)', async (signedIn) => {
  mockSchool = { id: '', name: '選擇學校' };
  if (signedIn) {
    mockAuth.session = {
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      isPlatformOperator: false,
      context: 'google-platform-context',
      expiresAt: Date.now() + 60_000,
    };
  }
  const sessionBeforeNavigation = mockAuth.session;
  const view = await landing();
  expect(view.getByText(signedIn ? '回到我的課程' : '登入或建立帳號')).toBeTruthy();
  if (!signedIn) expect(view.getByText('用 Google 帳號修課、交作業及查看訂單。網頁與 App 使用同一個帳號。')).toBeTruthy();
  await fireEventAsync.press(view.getByTestId('login-start'));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  if (signedIn) expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace', { tab: 'courses' });
  else expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
  expect(mockAuth.request).not.toHaveBeenCalled();
  expect(mockAuth.bffRequest).not.toHaveBeenCalled();
  expect(mockAuth.session).toBe(sessionBeforeNavigation);
  expect(view.queryByTestId('school-login-start')).toBeNull();
});

it('a verified Google account resumes named tasks before setup without querying or assuming a school role', async () => {
  mockAuth.session = {
    platformAccountId: 'pa_student', context: 'account-a', isPlatformOperator: false,
    expiresAt: Date.now() + 60_000,
  };
  const view = await landing();
  expect(view.getByRole('header', { name: '我的校園' })).toBeTruthy();
  expect(view.queryByText('Google 帳號')).toBeNull();
  expect(view.getAllByTestId('today-timetable-panel')).toHaveLength(1);
  expect(view.getAllByTestId('public-PersonalCalendar')).toHaveLength(1);
  const tree = JSON.stringify(view.toJSON());
  expect(tree.indexOf('today-timetable-panel')).toBeLessThan(tree.indexOf('school-import-start'));
  for (const [label, tab] of [['回到我的課程', 'courses'], ['點餐與訂單', 'food'], ['帳號與資格', 'account']]) {
    await fireEventAsync.press(view.getByText(label));
    expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'NuniWorkspace', { tab });
  }
  expect(mockAuth.signIn).not.toHaveBeenCalled();
  expect(mockAuth.request).not.toHaveBeenCalled();
  expect(mockAuth.bffRequest).not.toHaveBeenCalled();
});

it('hands only a generic prompt to the existing assistant route for the verified account, without sending or reading', async () => {
  mockAuth.session = {
    platformAccountId: 'pa_student', context: 'account-a', isPlatformOperator: false,
    expiresAt: Date.now() + 60_000,
  };
  const view = await landing();
  expect(mockPanelProps).toMatchObject({ assistantAccountId: 'pa_student' });
  const ask = mockPanelProps!.onAskCoursework as (prompt: string) => void;
  for (const prompt of ['現在這堂課有什麼作業？', '查下一堂課的作業']) {
    ask(prompt);
    expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'NuniTimetableAssistant', { prompt });
  }
  expect(safeNavigate).toHaveBeenCalledTimes(2);
  // The general assistant entry is unchanged.
  await fireEventAsync.press(view.getByRole('button', { name: '開啟課表助理' }));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'NuniTimetableAssistant');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
  expect(mockAuth.request).not.toHaveBeenCalled();
  expect(mockAuth.bffRequest).not.toHaveBeenCalled();
});

it.each([
  { name: 'signed out', patch: {} },
  { name: 'account check running', patch: { loading: true } },
  { name: 'pending logout', patch: { pendingLogout: true } },
  { name: 'account error', patch: { error: '無法確認登入' } },
])('does not wire the assistant handoff when %s', async ({ patch }) => {
  Object.assign(mockAuth, patch);
  if (patch.loading || patch.pendingLogout || patch.error) {
    mockAuth.session = {
      platformAccountId: 'pa_student', context: 'account-a', isPlatformOperator: false,
      expiresAt: Date.now() + 60_000,
    };
  }
  await landing();
  expect(mockPanelProps).toBeDefined();
  expect(mockPanelProps).not.toHaveProperty('onAskCoursework');
  expect(mockPanelProps!.assistantAccountId).toBeUndefined();
  expect(safeNavigate).not.toHaveBeenCalled();
});

it.each([
  { operator: true, patch: {}, visible: true },
  { operator: false, patch: {}, visible: false },
  { operator: true, patch: { loading: true }, visible: false },
  { operator: true, patch: { pendingLogout: true }, visible: false },
  { operator: true, patch: { error: '無法確認登入' }, visible: false },
])('only a verified operator session gets the direct platform work entry: %p', async ({ operator, patch, visible }) => {
  mockAuth.session = {
    platformAccountId: 'pa_operator', context: 'account-a', isPlatformOperator: operator,
    expiresAt: Date.now() + 60_000,
  };
  Object.assign(mockAuth, patch);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try {
    const view = await landing();
    const entry = view.queryByRole('link', { name: /平台管理（網頁）/ });
    expect(Boolean(entry)).toBe(visible);
    if (entry) {
      await fireEventAsync.press(entry);
      expect(open).toHaveBeenCalledWith('https://nuni.tw/admin');
    }
    expect(mockAuth.request).not.toHaveBeenCalled();
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
  }
});
