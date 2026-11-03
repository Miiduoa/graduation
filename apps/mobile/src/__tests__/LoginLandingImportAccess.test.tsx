import React from 'react';
import { fireEventAsync, renderAsync } from '@testing-library/react-native';
import { ScrollView, Text, View } from 'react-native';
import type { useNuniSession } from '../state/nuniSession';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { safeNavigate } from '../utils/safeNavigate';

const mockNavigation = { navigate: jest.fn(), addListener: jest.fn() };
let mockAuth: ReturnType<typeof useNuniSession>;
let mockProviderAvailable = false;
let mockSchoolId = 'pu';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchoolId, name: '靜宜大學' } }),
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
  mockSchoolId = 'pu';
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
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

it.each([false, true])(
  'keeps manual import independent of provider availability (%s)',
  async (available) => {
    mockProviderAvailable = available;
    const view = await landing();
    expect(Boolean(view.queryByTestId('school-login-start'))).toBe(available);
    expect(Boolean(view.queryByTestId('school-login-hint'))).toBe(!available);
    await fireEventAsync.press(view.getByTestId('school-import-start'));
    expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'PersonalImport', {
      kind: 'timetable',
    });
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  },
);

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

describe('test-only scroll observations', () => {
  const scope = globalThis as typeof globalThis & { __e2eNavTrace?: unknown[]; __DEV__: boolean };
  const originalDev = scope.__DEV__;
  const originalFlag = process.env.EXPO_PUBLIC_E2E_NAV_TRACE;
  const scrollEvent = {
    nativeEvent: {
      contentOffset: { x: 0, y: 512 },
      contentSize: { width: 402, height: 2000 },
      layoutMeasurement: { width: 402, height: 874 },
      timestamp: 1234.5,
    },
    timeStamp: 9000,
  };
  type Measurement = (x: number, y: number, width: number, height: number) => void;
  let measures: jest.SpyInstance[];
  let callbacks: Record<string, Measurement[]>;
  let listeners: Record<string, () => void>;
  const measureView = () => renderAsync(<LoginLandingScreen />);

  beforeEach(() => {
    scope.__DEV__ = true;
    process.env.EXPO_PUBLIC_E2E_NAV_TRACE = '1';
    delete scope.__e2eNavTrace;
    callbacks = { 'google-heading': [], 'login-start': [] };
    function captureMeasurement(
      this: { props: { testID?: string; children?: unknown } },
      callback: Measurement,
    ) {
      const name = this.props.testID === 'login-start' ? 'login-start' : 'google-heading';
      callbacks[name].push(callback);
    }
    measures = [
      jest.spyOn(Text.prototype, 'measureInWindow').mockImplementation(captureMeasurement),
      jest.spyOn(View.prototype, 'measureInWindow').mockImplementation(captureMeasurement),
    ];
    listeners = {};
    mockNavigation.addListener.mockImplementation((name, listener) => {
      listeners[name] = listener;
      return jest.fn();
    });
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    scope.__DEV__ = originalDev;
    if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_NAV_TRACE;
    else process.env.EXPO_PUBLIC_E2E_NAV_TRACE = originalFlag;
    delete scope.__e2eNavTrace;
    mockNavigation.addListener.mockReset();
    jest.restoreAllMocks();
  });

  it.each(['disabled', 'release'])(
    '%s attaches no new scroll callbacks or native measurements',
    async (mode) => {
      if (mode === 'disabled') delete process.env.EXPO_PUBLIC_E2E_NAV_TRACE;
      else scope.__DEV__ = false;
      const view = await measureView();
      const scroll = view.UNSAFE_getByType(ScrollView);
      for (const key of [
        'onScroll',
        'onScrollBeginDrag',
        'onScrollEndDrag',
        'onMomentumScrollBegin',
        'onMomentumScrollEnd',
        'scrollEventThrottle',
      ])
        expect(scroll.props[key]).toBeUndefined();
      await fireEventAsync(view.getByTestId('login-start'), 'layout', {
        nativeEvent: { layout: { y: 167, height: 50 } },
      });
      expect(measures.every((measure) => measure.mock.calls.length === 0)).toBe(true);
      expect(mockNavigation.addListener).not.toHaveBeenCalled();
      expect(scope.__e2eNavTrace).toBeUndefined();
      await fireEventAsync.press(view.getByTestId('login-start'));
      expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
    },
  );

  it('records numeric scrolling and window measurements while keeping the original press action', async () => {
    const view = await measureView();
    const scroll = view.UNSAFE_getByType(ScrollView);
    expect(scroll.props.scrollEventThrottle).toBe(100);
    await fireEventAsync(scroll, 'scrollBeginDrag', scrollEvent);
    expect(callbacks['google-heading']).toHaveLength(1);
    expect(callbacks['login-start']).toHaveLength(1);
    callbacks['google-heading'][0](47, 347, 308, 26);
    callbacks['login-start'][0](47, 491, 308, 50);
    await fireEventAsync.scroll(scroll, scrollEvent);
    await fireEventAsync.scroll(scroll, {
      ...scrollEvent,
      nativeEvent: { ...scrollEvent.nativeEvent, timestamp: undefined },
    });
    expect(scope.__e2eNavTrace?.at(-1)).toEqual(
      expect.objectContaining({
        scroll: { offsetY: 512, contentHeight: 2000, viewportHeight: 874 },
      }),
    );
    await fireEventAsync(scroll, 'scrollEndDrag', scrollEvent);
    expect(scope.__e2eNavTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'scroll-begin',
          scroll: {
            offsetY: 512,
            contentHeight: 2000,
            viewportHeight: 874,
            nativeTimestamp: 1234.5,
          },
        }),
        expect.objectContaining({
          event: 'target-measure',
          target: expect.objectContaining({
            name: 'google-heading',
            trigger: 'scroll-begin',
            y: 347,
            requestedAt: expect.any(Number),
          }),
        }),
        expect.objectContaining({ event: 'scroll-offset' }),
        expect.objectContaining({ event: 'scroll-end' }),
      ]),
    );
    await fireEventAsync.press(view.getByTestId('login-start'));
    expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'NuniWorkspace');
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  });

  it.each([
    'superseded',
    'blur',
    'blur-focus',
    'auth',
    'account',
    'school',
    'school-aba',
    'unmount',
  ])('ignores late native measurement after %s', async (reason) => {
    const view = await measureView();
    const scroll = view.UNSAFE_getByType(ScrollView);
    await fireEventAsync(scroll, 'scrollBeginDrag', scrollEvent);
    const old = callbacks['google-heading'][0];
    expect(old).toBeDefined();
    if (reason === 'superseded') await fireEventAsync(scroll, 'scrollEndDrag', scrollEvent);
    if (reason === 'blur' || reason === 'blur-focus') listeners.blur();
    if (reason === 'blur-focus') listeners.focus();
    if (reason === 'auth') {
      mockAuth = { ...mockAuth, error: 'synthetic session error' };
      await view.rerenderAsync(<LoginLandingScreen />);
    }
    if (reason === 'account') {
      mockAuth = {
        ...mockAuth,
        session: {
          platformAccountId: 'private-account-fixture',
          isPlatformOperator: false,
          context: 'private-context-fixture',
        },
      };
      await view.rerenderAsync(<LoginLandingScreen />);
    }
    if (reason === 'school' || reason === 'school-aba') {
      mockSchoolId = 'test-campus';
      await view.rerenderAsync(<LoginLandingScreen />);
    }
    if (reason === 'school-aba') {
      mockSchoolId = 'pu';
      await view.rerenderAsync(<LoginLandingScreen />);
    }
    if (reason === 'unmount') await view.unmountAsync();
    old(47, 999, 308, 26);
    expect(scope.__e2eNavTrace).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'target-measure' })]),
    );
    expect(JSON.stringify(scope.__e2eNavTrace)).not.toContain('private-');
  });
});
