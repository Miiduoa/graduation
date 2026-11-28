import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';
import { Text } from 'react-native';
import Constants from 'expo-constants';
import {
  SchoolSessionBoundary,
  hasReadySchoolSession,
  isSchoolSessionReady,
  publishSchoolSessionReady,
  waitForSchoolSessionReady,
} from '../app/SchoolSessionBoundary';
import { preAuthLinking } from '../app/preAuthLinking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dormStorageKey } from '@campus/shared/src/dormitory';
import { loadCampusEvent, loadCampusEventPage, type CampusEvent } from '../services/publicCampusContent';
import {
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';

const originalExtra = Constants.expoConfig?.extra;
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
jest.mock('../state/notifications', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
  useOptionalNotifications: () => ({ unreadCount: 0 }),
}));
jest.mock('../components/HeaderDrawer', () => ({ headerDrawer: { open: jest.fn() } }));
// Navigation tests render the signed-out stack without mounting the app shell.
// Supply the same selected-campus context that production SchoolProvider supplies.
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: {
      id: mockBrowsingSchoolId,
      name: mockBrowsingSchoolId === 'pu' ? '靜宜大學' : '國立清華大學',
    },
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
  Object.assign(Constants.expoConfig!, { extra: { ...originalExtra, appEnv: 'development' } });
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
  publishSchoolSessionReady(false);
});
afterEach(() => {
  Object.assign(Constants.expoConfig!, { extra: originalExtra });
  resetSchoolLoginProviderCache();
});

jest.unmock('@react-navigation/native');
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({
    themeMode: 'light',
    mode: 'light',
    theme: require('../ui/theme').getCurrentTheme(),
  }),
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: mockPlatformSession,
    loading: false,
    error: '',
    pendingLogout: false,
  }),
  useOptionalNuniSession: () => ({
    session: mockPlatformSession,
    loading: false,
    error: '',
    pendingLogout: false,
  }),
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
  return {
    __esModule: true,
    default: () => <Text testID="personal-import-screen">匯入課表紀錄</Text>,
  };
});
jest.mock('../screens/PersonalTimetableScreen', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PublicPersonalTimetable: () => <Text testID="personal-timetable-screen">整週個人課表</Text>,
  };
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
  return {
    __esModule: true,
    default: () => <Text testID="public-school-info-screen">學校資訊</Text>,
  };
});
jest.mock('../screens/StudentCardScreen', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => <Text testID="public-student-card-screen">數位學生證</Text>,
  };
});
jest.mock('../services/publicCampusContent', () => ({
  ...jest.requireActual('../services/publicCampusContent'),
  loadCampusEvent: jest.fn(),
  loadCampusEventPage: jest.fn(),
}));
jest.mock('../screens/CampusContentScreens', () => {
  const { Text } = require('react-native');
  return {
    ...jest.requireActual('../screens/CampusContentScreens'),
    CampusAnnouncementsScreen: () => <Text testID="public-announcements-screen">公开公告</Text>,
    CampusAnnouncementDetailScreen: () => <Text testID="public-announcement-screen">公告詳情</Text>,
  };
});

const publicEvent: CampusEvent = {
  id: 'open-day', schoolId: 'pu', source: 'school-club-events', title: '天文觀測夜',
  description: '活動當晚請到科學館集合。', startsAt: '2027-01-02T10:00:00Z', appRegistrationConfigured: true,
};

test.each([null, { platformAccountId: 'google-only' }])(
  'opens, saves, and revisits an event through public navigation with account %j',
  async (session) => {
    mockPlatformSession = session;
    jest.mocked(loadCampusEventPage).mockResolvedValue({ items: [publicEvent], nextCursor: null, source: publicEvent.source });
    jest.mocked(loadCampusEvent).mockResolvedValue(publicEvent);
    const navigation = createNavigationContainerRef();
    const unhandled = jest.fn();
    const view = render(
      <NavigationContainer ref={navigation} onUnhandledAction={unhandled}>
        <PreAuthStack />
      </NavigationContainer>,
    );
    fireEvent.press(await view.findByRole('button', { name: '校園活動' }));
    fireEvent.press(await view.findByRole('button', { name: /^天文觀測夜/ }));
    expect(await view.findByText('活動介紹')).toBeTruthy();
    expect(navigation.getCurrentRoute()).toMatchObject({
      name: '活動詳情', params: { id: publicEvent.id, schoolId: 'pu', source: publicEvent.source },
    });
    expect(await view.findByText('請登入目前學校的帳號，再確認報名資格與狀態。')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: '收藏活動：天文觀測夜' }));
    await view.findByRole('button', { name: '取消收藏：天文觀測夜' });
    act(() => navigation.goBack());
    fireEvent.press(await view.findByRole('tab', { name: '已收藏' }));
    fireEvent.press(await view.findByRole('button', { name: '查看活動：天文觀測夜' }));
    expect(await view.findByText('活動介紹')).toBeTruthy();
    expect(loadCampusEvent).toHaveBeenCalledWith('pu', publicEvent.id, publicEvent.source);
    fireEvent.press(view.getByRole('button', { name: '取消收藏：天文觀測夜' }));
    await view.findByRole('button', { name: '收藏活動：天文觀測夜' });
    expect(unhandled).not.toHaveBeenCalled();
  },
);

test.each([
  ['pu', 'pu', 'school-club-events', true],
  ['pu', 'tw-pu', 'school-club-events', true],
  ['pu', 'tw-pu', undefined, true],
  ['nthu', 'pu', 'school-club-events', false],
  ['nthu', 'tw-pu', undefined, false],
] as const)(
  'a public event link with selected campus %s, school hint %s and source %s respects campus identity',
  async (school, hint, source, matches) => {
    mockBrowsingSchoolId = school;
    mockInitialUrl = `campus://event/open-day?schoolId=${hint}${source ? `&source=${source}` : ''}`;
    jest.mocked(loadCampusEvent).mockClear().mockResolvedValue(publicEvent);
    const navigation = createNavigationContainerRef();
    const view = render(
      <NavigationContainer ref={navigation} linking={preAuthLinking}>
        <PreAuthStack />
      </NavigationContainer>,
    );
    if (matches) {
      await view.findByText('活動介紹');
      expect(loadCampusEvent).toHaveBeenCalledWith(school, publicEvent.id, source);
    } else {
      await view.findByText('找不到這場活動，可能已移除或不屬於目前學校。');
      expect(loadCampusEvent).not.toHaveBeenCalled();
    }
    expect(navigation.canGoBack()).toBe(true);
    act(() => navigation.goBack());
    await view.findByTestId('login-landing');
  },
);

test('the signed-out development stack opens school login through the real navigation helper', async () => {
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

test('a signed-out production user can reach the platform while PU student login is paused', async () => {
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: { releasedSchoolIds: ['pu'], features: { enabled: true, sso: true } },
    },
  });
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  const platformLogin = await view.findByTestId('login-start');
  expect(view.queryByTestId('school-login-start')).toBeNull();
  fireEvent.press(platformLogin);
  await view.findByTestId('platform-workspace');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
});

test.each([null, { platformAccountId: 'google-only' }])(
  'platform lost-found has a reachable entry before school authentication (%j)',
  async (session) => {
    mockPlatformSession = session;
    mockSchoolAuth.loading = true;
    mockSchoolAuth.profileLoading = true;
    const navigation = createNavigationContainerRef();
    const view = render(
      <SchoolSessionBoundary
        publicContent={
          <NavigationContainer ref={navigation}>
            <PreAuthStack />
          </NavigationContainer>
        }
      >
        <Text>Private school navigation</Text>
      </SchoolSessionBoundary>,
    );
    fireEvent.press(await view.findByTestId('platform-lost-found-start'));
    await view.findByTestId('platform-lost-found-screen');
    expect(navigation.getCurrentRoute()?.name).toBe('PlatformLostFound');
    expect(view.queryByTestId('school-login-form')).toBeNull();
  },
);

test.each(['cold', 'warm'])(
  'a %s platform lost-found detail link opens without registering legacy Firebase routes',
  async (start) => {
    const id = 'plf_11111111-1111-4111-8111-111111111111';
    const url = `campus://platform-lost-found/${id}?schoolId=pu`;
    mockPlatformSession = { platformAccountId: 'google-only' };
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
    await view.findByTestId('platform-lost-found-screen');
    expect(navigation.getCurrentRoute()?.name).toBe('PlatformLostFound');
    expect(navigation.getCurrentRoute()?.params).toEqual({ id, schoolId: 'pu' });
    expect(navigation.getRootState().routeNames).not.toContain('LostFound');
    expect(view.queryByTestId('school-login-form')).toBeNull();
  },
);

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

test.each(['cold', 'warm'])(
  'a %s legacy food link opens for a Google-only account without changing school identity',
  async (start) => {
    mockPlatformSession = { platformAccountId: 'google-only' };
    mockBrowsingSchoolId = 'nthu';
    const url =
      'campus://shops?schoolId=pu&campus=pu&tab=merchant&role=admin' +
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
    expect(navigation.getCurrentRoute()?.params).toEqual({
      tab: 'food',
      schoolId: 'pu',
      campus: 'pu',
    });
    expect(view.queryByTestId('school-login-form')).toBeNull();
    expect(mockBrowsingSchoolId).toBe('nthu');
    expect(mockSchoolAuth).toMatchObject({ user: null, profile: null });
    expect(mockPlatformSession).toEqual({ platformAccountId: 'google-only' });
  },
);

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

test.each(['cold', 'warm'])(
  'a %s career link keeps the selected campus, opens public announcements, and returns to the guest entry',
  async (start) => {
    mockBrowsingSchoolId = 'nthu';
    const url = 'campus://career?schoolId=pu&role=admin';
    if (start === 'cold') mockInitialUrl = url;
    const navigation = createNavigationContainerRef();
    const onUnhandledAction = jest.fn();
    const view = render(
      <NavigationContainer
        ref={navigation}
        linking={preAuthLinking}
        onUnhandledAction={onUnhandledAction}
      >
        <PreAuthStack />
      </NavigationContainer>,
    );
    if (start === 'warm') {
      await view.findByTestId('login-landing');
      await waitFor(() => expect(mockLinkListener).toBeDefined());
      act(() => mockLinkListener?.({ url }));
    }
    expect(
      await view.findByRole('link', { name: '登入後可申請校內工讀與查看實習學分' }),
    ).toBeTruthy();
    expect(navigation.getCurrentRoute()?.name).toBe('Career');
    expect(view.getByText('生活 › 職涯 · 國立清華大學')).toBeTruthy();
    expect(view.queryByTestId('school-login-form')).toBeNull();
    expect(mockBrowsingSchoolId).toBe('nthu');
    expect(mockSchoolAuth).toMatchObject({ user: null, profile: null });
    fireEvent.press(view.getByRole('button', { name: '查看校方公告' }));
    expect(await view.findByTestId('public-announcements-screen')).toBeTruthy();
    act(() => navigation.goBack());
    expect(navigation.getCurrentRoute()?.name).toBe('Career');
    act(() => navigation.goBack());
    expect(navigation.getCurrentRoute()?.name).toBe('LoginLanding');
    expect(onUnhandledAction).not.toHaveBeenCalled();
  },
);

test.each([
  ['Map', 'public-map-screen'],
  ['Library', 'public-library-screen'],
  ['SchoolInfo', 'public-school-info-screen'],
  ['StudentCard', 'public-student-card-screen'],
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
  ['campus://student-card', 'public-student-card-screen'],
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

test('school session ready wait resolves only after a ready school session is published', async () => {
  publishSchoolSessionReady(false);
  expect(isSchoolSessionReady()).toBe(false);
  const pending = waitForSchoolSessionReady(1000);
  expect(isSchoolSessionReady()).toBe(false);
  publishSchoolSessionReady(true);
  await expect(pending).resolves.toBe(true);
  expect(isSchoolSessionReady()).toBe(true);
  publishSchoolSessionReady(false);
});

test('school session ready wait times out when a ready session is never published', async () => {
  publishSchoolSessionReady(false);
  await expect(waitForSchoolSessionReady(50)).resolves.toBe(false);
  expect(isSchoolSessionReady()).toBe(false);
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
      publicContent={
        <NavigationContainer>
          <PreAuthStack />
        </NavigationContainer>
      }
    >
      <Text testID="private-school">靜宜私人課務</Text>
    </SchoolSessionBoundary>,
  );
  expect(view.queryByTestId('private-school')).toBeNull();
  fireEvent.press(await view.findByTestId('public-Library'));
  expect(await view.findByTestId('public-library-screen')).toBeTruthy();
});

test('a restored account cannot mount private navigation before school choice is resolved', () => {
  mockSchoolAuth = {
    user: { uid: 'u1' },
    profile: { uid: 'u1', schoolId: 'pu' },
    loading: false,
    profileLoading: false,
  };
  const content = () => (
    <SchoolSessionBoundary publicContent={<Text>公開入口</Text>}>
      <Text>私人課務</Text>
    </SchoolSessionBoundary>
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

test('a guest opens exploration before selecting a school and can return to the same entry', async () => {
  mockBrowsingSchoolId = '';
  const onUnhandledAction = jest.fn();
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation} onUnhandledAction={onUnhandledAction}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  fireEvent.press(await view.findByLabelText('探索更多 nuni 用法'));
  await view.findByTestId('explore-screen');
  expect(navigation.getCurrentRoute()?.name).toBe('Explore');
  expect(view.getByText('從想完成的事，找到 nuni 的用法。')).toBeTruthy();
  expect(onUnhandledAction).not.toHaveBeenCalled();
  await act(async () => navigation.goBack());
  expect(navigation.getCurrentRoute()?.name).toBe('LoginLanding');
  await view.findByTestId('login-landing');
});
