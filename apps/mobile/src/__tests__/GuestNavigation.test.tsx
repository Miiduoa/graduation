import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';
import { Text } from 'react-native';
import { SchoolSessionBoundary, hasReadySchoolSession } from '../app/SchoolSessionBoundary';
import { preAuthLinking } from '../app/preAuthLinking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dormStorageKey } from '@campus/shared/src/dormitory';
import {
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';

let mockBrowsingSchoolId = 'pu';
let mockSelectionReady = true;
let mockPlatformSession: { platformAccountId: string } | null = null;
let mockSchoolAuth: {
  user: { uid: string } | null;
  profile: { uid: string; schoolId: string } | null;
  loading: boolean;
  profileLoading: boolean;
  tokenExpired?: boolean;
} = {
  user: null,
  profile: null,
  loading: false,
  profileLoading: false,
  tokenExpired: false,
};
jest.mock('../state/auth', () => ({ useAuth: () => mockSchoolAuth }));
// Navigation tests render the signed-out stack without mounting the app shell.
// Supply the same selected-campus context that production SchoolProvider supplies.
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: { id: mockBrowsingSchoolId, name: mockBrowsingSchoolId === 'pu' ? '靜宜大學' : '國立清華大學' },
    schoolId: mockBrowsingSchoolId || null,
    selection: { schoolId: mockBrowsingSchoolId || null },
    selectionReady: mockSelectionReady,
    setSelection: jest.fn(),
  }),
}));
let mockInitialUrl: string | null = null;
let mockLinkListener: ((event: { url: string }) => void) | undefined;
const mockRemoveLinkListener = jest.fn();
jest.mock('expo-linking', () => ({
  createURL: () => 'campus://',
  getInitialURL: async () => mockInitialUrl,
  addEventListener: (_type: string, listener: (event: { url: string }) => void) => {
    mockLinkListener = listener;
    return { remove: mockRemoveLinkListener };
  },
}));
beforeEach(() => {
  mockSelectionReady = true;
  mockBrowsingSchoolId = 'pu';
  mockPlatformSession = null;
  mockSchoolAuth = {
    user: null,
    profile: null,
    loading: false,
    profileLoading: false,
    tokenExpired: false,
  };
  mockInitialUrl = null;
  mockLinkListener = undefined;
  mockRemoveLinkListener.mockClear();
  setSchoolLoginProviderKinds(['school-issued']);
});
afterEach(() => {
  resetSchoolLoginProviderCache();
});

jest.unmock('@react-navigation/native');
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({ themeMode: 'light', mode: 'light', theme: require('../ui/theme').getCurrentTheme() }),
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({ session: mockPlatformSession, loading: false, error: '', pendingLogout: false }),
  useOptionalNuniSession: () => ({ session: mockPlatformSession, loading: false, error: '', pendingLogout: false }),
}));
jest.mock('../state/schedule', () => ({
  useSchedule: () => ({
    courses: [],
    addCourse: jest.fn(),
    removeCourse: jest.fn(),
    updateCourse: jest.fn(),
  }),
}));
jest.mock('../ui/navigationTheme', () => {
  const actual = jest.requireActual('../ui/navigationTheme');
  return {
    ...actual,
    useTabBarContentBottomPadding: () => 80,
    TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../screens/NuniWorkspaceScreen', () => ({
  NuniWorkspaceScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="platform-workspace">nuni 帳號</Text>;
  },
}));
jest.mock('../screens/PlatformLostFoundScreen', () => ({
  PlatformLostFoundScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="platform-lost-found-screen">平台失物招領</Text>;
  },
}));
jest.mock('../screens/SSOLoginScreen', () => ({
  SSOLoginScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="school-login-form">登入學校帳號</Text>;
  },
}));
jest.mock('../screens/PersonalImportScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-import-screen">匯入課表紀錄</Text> };
});
jest.mock('../screens/PersonalTimetableScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-timetable-screen">整週個人課表</Text> };
});

jest.mock('../screens/GoogleMapsLikeScreen', () => {
  const { Text } = require('react-native');
  return { GoogleMapsLikeScreen: () => <Text testID="public-map-screen">校園地圖</Text> };
});
jest.mock('../screens/BusAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-bus-screen">公車查詢</Text> };
});
jest.mock('../screens/LibraryAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-screen">圖書館</Text> };
});
jest.mock('../screens/LibraryCatalogScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-catalog">館藏查詢</Text> };
});
jest.mock('../screens/SchoolInfoScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-school-info-screen">學校資訊</Text> };
});
jest.mock('../screens/CampusContentScreens', () => {
  const { Text } = require('react-native');
  return {
    CampusAnnouncementsScreen: () => <Text testID="public-announcements-screen">公开公告</Text>,
    CampusAnnouncementDetailScreen: () => <Text testID="public-announcement-screen">公告詳情</Text>,
  };
});

test('the signed-out stack opens school login through the real navigation helper', async () => {
  const onUnhandledAction = jest.fn();
  const navigation = createNavigationContainerRef();
  const content = () => (
    <NavigationContainer ref={navigation} onUnhandledAction={onUnhandledAction}>
      <PreAuthStack />
    </NavigationContainer>
  );
  const view = render(content());
  fireEvent.press(await view.findByTestId('school-login-start'));
  await waitFor(() => expect(view.getByTestId('school-login-form')).toBeTruthy());
  expect(navigation.getRootState().index).toBe(1);
  expect(navigation.getCurrentRoute()?.name).toBe('SSOLogin');
  view.rerender(content());
  expect(navigation.getCurrentRoute()?.name).toBe('SSOLogin');
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('the primary signed-out entry opens the independent platform workspace', async () => {
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  fireEvent.press(await view.findByTestId('login-start'));
  await view.findByTestId('platform-workspace');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
});

test.each([null, { platformAccountId: 'google-only' }])('platform lost-found has a reachable entry before school authentication (%j)', async (session) => {
  mockPlatformSession = session;
  mockSchoolAuth.loading = true;
  mockSchoolAuth.profileLoading = true;
  const navigation = createNavigationContainerRef();
  const view = render(
    <SchoolSessionBoundary publicContent={<NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer>}>
      <Text>Private school navigation</Text>
    </SchoolSessionBoundary>,
  );
  fireEvent.press(await view.findByTestId('platform-lost-found-start'));
  await view.findByTestId('platform-lost-found-screen');
  expect(navigation.getCurrentRoute()?.name).toBe('PlatformLostFound');
  expect(view.queryByTestId('school-login-form')).toBeNull();
});

test.each(['cold', 'warm'])('a %s platform lost-found detail link opens without registering legacy Firebase routes', async (start) => {
  const id = 'plf_11111111-1111-4111-8111-111111111111';
  const url = `campus://platform-lost-found/${id}?schoolId=pu`;
  mockPlatformSession = { platformAccountId: 'google-only' };
  if (start === 'cold') mockInitialUrl = url;
  const navigation = createNavigationContainerRef();
  const view = render(<NavigationContainer ref={navigation} linking={preAuthLinking}><PreAuthStack /></NavigationContainer>);
  if (start === 'warm') {
    await view.findByTestId('login-landing');
    await waitFor(() => expect(mockLinkListener).toBeDefined());
    act(() => mockLinkListener?.({ url }));
  }
  await view.findByTestId('platform-lost-found-screen');
  expect(navigation.getCurrentRoute()?.name).toBe('PlatformLostFound');
  expect(navigation.getCurrentRoute()?.params).toEqual({ id, schoolId: 'pu' });
  expect(navigation.getRootState().routeNames).not.toContain('LostFound');
  expect(view.queryByTestId('school-login-form')).toBeNull();
});

test('a guest can open the real import route without a school or platform account', async () => {
  const navigation = createNavigationContainerRef();
  const onUnhandledAction = jest.fn();
  const view = render(
    <NavigationContainer ref={navigation} onUnhandledAction={onUnhandledAction}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  fireEvent.press(await view.findByRole('button', { name: '匯入我的課表' }));
  await view.findByTestId('personal-import-screen');
  expect(navigation.getCurrentRoute()?.name).toBe('PersonalImport');
  expect(navigation.getCurrentRoute()?.params).toEqual({ kind: 'timetable' });
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test.each([
  ['campus://campus-one', 'NuniWorkspace', 'platform-workspace'],
  ['campus://sso-login', 'SSOLogin', 'school-login-form'],
  ['campus://shops', 'NuniWorkspace', 'platform-workspace'],
])('a cold %s opens before any school authentication', async (url, route, target) => {
  mockInitialUrl = url;
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation} linking={preAuthLinking}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  await view.findByTestId(target);
  expect(navigation.getCurrentRoute()?.name).toBe(route);
  if (url === 'campus://shops') {
    expect(navigation.getCurrentRoute()?.params).toEqual({ tab: 'food' });
    expect(view.queryByTestId('school-login-form')).toBeNull();
  }
  expect(navigation.canGoBack()).toBe(true);
  act(() => navigation.goBack());
  await view.findByTestId('login-landing');
  fireEvent.press(view.getByTestId('school-login-start'));
  await view.findByTestId('school-login-form');
});

test.each(['cold', 'warm'])('a %s legacy food link opens for a Google-only account without changing school identity', async (start) => {
  mockPlatformSession = { platformAccountId: 'google-only' };
  mockBrowsingSchoolId = 'nthu';
  const url = 'campus://shops?schoolId=pu&campus=pu&tab=merchant&role=admin' +
    '&assistantAccountId=other&platformAccountId=other&context=secret&token=secret';
  if (start === 'cold') mockInitialUrl = url;
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation} linking={preAuthLinking}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  if (start === 'warm') {
    await view.findByTestId('login-landing');
    await waitFor(() => expect(mockLinkListener).toBeDefined());
    act(() => mockLinkListener?.({ url }));
  }
  await view.findByTestId('platform-workspace');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
  expect(navigation.getCurrentRoute()?.params).toEqual({ tab: 'food', schoolId: 'pu', campus: 'pu' });
  expect(view.queryByTestId('school-login-form')).toBeNull();
  expect(mockBrowsingSchoolId).toBe('nthu');
  expect(mockSchoolAuth).toMatchObject({ user: null, profile: null });
  expect(mockPlatformSession).toEqual({ platformAccountId: 'google-only' });
});

test.each(['shops/vendor-one', '/shops/vendor/vendor-one', 'shops/detail/order-one?schoolId=pu'])(
  'an unsupported legacy detail %s does not resolve to a food success route',
  (path) => {
    expect(preAuthLinking.getStateFromPath?.(path, preAuthLinking.config)).toBeUndefined();
  },
);

test('a warm platform link works in the school-signed-out stack and cleans up its subscription', async () => {
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation} linking={preAuthLinking}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  await view.findByTestId('login-landing');
  await waitFor(() => expect(mockLinkListener).toBeDefined());
  act(() => mockLinkListener?.({ url: 'campus://campus-one' }));
  await view.findByTestId('platform-workspace');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
  view.unmount();
  expect(mockRemoveLinkListener).toHaveBeenCalledTimes(1);
});

test('a dormitory link opens the selected campus workspace for a signed-in platform student', async () => {
  mockBrowsingSchoolId = 'nthu';
  mockPlatformSession = { platformAccountId: 'resident' };
  mockInitialUrl = 'campus://dormitory?schoolId=pu&repairId=external';
  const key = dormStorageKey('platform:resident', 'nthu');
  await AsyncStorage.setItem(key, JSON.stringify({ building: '清大宿舍備忘' }));
  try {
    const navigation = createNavigationContainerRef();
    const view = render(
      <NavigationContainer ref={navigation} linking={preAuthLinking}>
        <PreAuthStack />
      </NavigationContainer>,
    );
    expect((await view.findAllByText('清大宿舍備忘')).length).toBeGreaterThan(0);
    expect(navigation.getCurrentRoute()?.name).toBe('Dormitory');
    expect(view.queryByText('external')).toBeNull();
  } finally {
    await AsyncStorage.removeItem(key);
  }
});

test.each([
  ['Map', 'public-map-screen'],
  ['Library', 'public-library-screen'],
  ['SchoolInfo', 'public-school-info-screen'],
  ['BusSchedule', 'public-bus-screen'],
  ['公告總覽', 'public-announcements-screen'],
])('signed-out users can open %s without either account', async (route, target) => {
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  fireEvent.press(await view.findByTestId(`public-${route}`));
  await view.findByTestId(target);
  expect(navigation.getCurrentRoute()?.name).toBe(route);
  act(() => navigation.goBack());
  fireEvent.press(await view.findByTestId('login-start'));
  await view.findByTestId('platform-workspace');
});

test.each([
  ['campus://map', 'public-map-screen'],
  ['campus://library', 'public-library-screen'],
  ['campus://library/catalog', 'public-library-catalog'],
  ['campus://school-info', 'public-school-info-screen'],
  ['campus://bus', 'public-bus-screen'],
  ['campus://announcements', 'public-announcements-screen'],
  ['campus://announcement/public-1', 'public-announcement-screen'],
])('a public cold link %s opens without school authentication', async (url, target) => {
  mockInitialUrl = url;
  const view = render(
    <NavigationContainer linking={preAuthLinking}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  await view.findByTestId(target);
});

test.each([
  { loading: true, profileLoading: true, user: null, profile: null },
  { loading: false, profileLoading: true, user: { uid: 'u1' }, profile: null },
  {
    loading: false,
    profileLoading: false,
    user: { uid: 'u2' },
    profile: { uid: 'u1', schoolId: 'pu' },
  },
  { loading: false, profileLoading: false, user: null, profile: { uid: 'u1', schoolId: 'pu' } },
  {
    loading: false,
    profileLoading: false,
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'pu' },
    tokenExpired: true,
  },
])('public navigation remains usable with unresolved or stale school session %j', async (state) => {
  mockSchoolAuth = { ...mockSchoolAuth, ...state };
  const mountPrivate = jest.fn(() => <Text testID="private-school">Private</Text>);
  const Private = mountPrivate;
  const view = render(
    <SchoolSessionBoundary
      publicContent={
        <NavigationContainer>
          <PreAuthStack />
        </NavigationContainer>
      }
    >
      <Private />
    </SchoolSessionBoundary>,
  );
  fireEvent.press(await view.findByTestId('public-Map'));
  await view.findByTestId('public-map-screen');
  expect(mountPrivate).not.toHaveBeenCalled();
});

test('school changes unmount private listeners before exposing the next school', () => {
  mockSchoolAuth = {
    ...mockSchoolAuth,
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'pu' },
  };
  const cleanup = jest.fn();
  function Private() {
    React.useEffect(() => cleanup, []);
    return <Text testID="private-school">Private</Text>;
  }
  const content = () => (
    <SchoolSessionBoundary publicContent={<Text>Public</Text>}>
      <Private />
    </SchoolSessionBoundary>
  );
  const view = render(content());
  expect(view.getByTestId('private-school')).toBeTruthy();
  mockSchoolAuth = {
    ...mockSchoolAuth,
    profile: { uid: 'u1', schoolId: 'nthu' },
  };
  view.rerender(content());
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('account changes unmount private content before exposing the next account', () => {
  mockSchoolAuth = {
    ...mockSchoolAuth,
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'pu' },
  };
  const cleanup = jest.fn();
  function Private() {
    React.useEffect(() => cleanup, []);
    return <Text testID="private-school">Private</Text>;
  }
  const content = () => (
    <SchoolSessionBoundary publicContent={<Text>Public</Text>}>
      <Private />
    </SchoolSessionBoundary>
  );
  const view = render(content());
  expect(view.getByTestId('private-school')).toBeTruthy();
  mockSchoolAuth = { ...mockSchoolAuth, user: { uid: 'u2' } };
  view.rerender(content());
  expect(view.queryByTestId('private-school')).toBeNull();
  expect(cleanup).toHaveBeenCalledTimes(1);
});


test('browsing another school unmounts private school screens and restores them only after returning', () => {
  mockSchoolAuth = {
    user: { uid: 'pu-student' },
    profile: { uid: 'pu-student', schoolId: 'pu' },
    loading: false,
    profileLoading: false,
    tokenExpired: false,
  };
  const cleanup = jest.fn();
  const mounts = jest.fn();
  function Private() {
    React.useEffect(() => {
      mounts();
      return cleanup;
    }, []);
    return <Text testID="private-school">靜宜私人課務</Text>;
  }
  const content = () => (
    <SchoolSessionBoundary publicContent={<Text testID="public-campus">公開校園</Text>}>
      <Private />
    </SchoolSessionBoundary>
  );
  const view = render(content());
  expect(view.getByTestId('private-school')).toBeTruthy();
  mockBrowsingSchoolId = 'nthu';
  view.rerender(content());
  expect(view.queryByTestId('private-school')).toBeNull();
  expect(view.getByTestId('public-campus')).toBeTruthy();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(hasReadySchoolSession(mockSchoolAuth, 'nthu')).toBe(false);
  mockBrowsingSchoolId = 'pu';
  view.rerender(content());
  expect(view.getByTestId('private-school')).toBeTruthy();
  expect(mounts).toHaveBeenCalledTimes(2);
});

test('school aliases do not bypass cross-campus isolation', () => {
  mockSchoolAuth = {
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'tw-pu' },
    loading: false,
    profileLoading: false,
  };
  expect(hasReadySchoolSession(mockSchoolAuth, 'pu')).toBe(true);
  expect(hasReadySchoolSession(mockSchoolAuth, 'tw-pu')).toBe(true);
  expect(hasReadySchoolSession(mockSchoolAuth, 'nthu')).toBe(false);
  expect(hasReadySchoolSession(mockSchoolAuth, null)).toBe(false);
});


test('the public library remains reachable after browsing away from the logged-in school', async () => {
  mockSchoolAuth = {
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'pu' },
    loading: false,
    profileLoading: false,
  };
  mockBrowsingSchoolId = 'nthu';
  const view = render(
    <SchoolSessionBoundary
      publicContent={<NavigationContainer><PreAuthStack /></NavigationContainer>}
    >
      <Text testID="private-school">靜宜私人課務</Text>
    </SchoolSessionBoundary>,
  );
  expect(view.queryByTestId('private-school')).toBeNull();
  fireEvent.press(await view.findByTestId('public-Library'));
  expect(await view.findByTestId('public-library-screen')).toBeTruthy();
});


test('a restored account cannot mount private navigation before school choice is resolved', () => {
  mockSchoolAuth = { user: { uid: 'u1' }, profile: { uid: 'u1', schoolId: 'pu' }, loading: false, profileLoading: false };
  const content = () => (
    <SchoolSessionBoundary publicContent={<Text>公開入口</Text>}><Text>私人課務</Text></SchoolSessionBoundary>
  );
  mockSelectionReady = false;
  const view = render(content());
  expect(view.queryByText('私人課務')).toBeNull();
  mockSelectionReady = true;
  mockBrowsingSchoolId = '';
  view.rerender(content());
  expect(view.getByText('公開入口')).toBeTruthy();
  mockBrowsingSchoolId = 'pu';
  view.rerender(content());
  expect(view.getByText('私人課務')).toBeTruthy();
});
