import React from 'react';
import { Button, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootTabParamList } from '../../app/rootNavigation';
import {
  mobileAssistantServiceDestination,
  navigateMobileAssistantService,
} from '../../services/assistantServiceNavigation';

jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

function navigator(routes: string[]) {
  return { navigate: jest.fn(), getState: () => ({ routeNames: routes }) };
}

test('platform assistant selects the actual public map and bus routes, not school-only aliases', () => {
  const nav = navigator(['Map', 'BusSchedule', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('map', 'platform', nav)).toEqual({
    kind: 'native',
    route: 'Map',
  });
  expect(mobileAssistantServiceDestination('bus', 'platform', nav)).toEqual({
    kind: 'native',
    route: 'BusSchedule',
  });
  expect(navigateMobileAssistantService('map', 'platform', nav)).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('Map', undefined);
});

test.each([
  ['classroom', 'courses'],
  ['attendance', 'courses'],
  ['cafeteria', 'food'],
  ['orders', 'food'],
  ['merchant', 'merchant'],
  ['account', 'account'],
])('platform %s keeps the existing nuni workspace %s tab and its authorization', (id, tab) => {
  const nav = navigator(['NuniWorkspace']);
  expect(navigateMobileAssistantService(id, 'platform', nav)).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('NuniWorkspace', { tab });
});

test.each([
  ['community', '訊息', 'CampusSocialScreen'],
  ['career', '校園', 'Career'],
])(
  'the %s service reaches its registered parent tab with a return anchor',
  (service, tab, screen) => {
    const root = navigator(['Today', '學習', '校園', '訊息', '我的']);
    const child = { ...navigator(['AIChat']), getParent: () => root };
    expect(navigateMobileAssistantService(service, 'campus', child)).toBe(true);
    expect(child.navigate).toHaveBeenCalledWith(tab, {
      initial: false,
      screen,
      params: undefined,
    });
  },
);

test.each(['campus', 'platform', 'guest'] as const)(
  'the public career service opens its mounted native page for %s',
  (audience) => {
    const nav = navigator(['Career', 'NuniWorkspace']);
    expect(mobileAssistantServiceDestination('career', audience, nav)).toEqual({
      kind: 'native',
      route: 'Career',
    });
    expect(navigateMobileAssistantService('career', audience, nav)).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('Career', undefined);
  },
);

test('opening career from the assistant initializes the actual life tab with a home to return to', async () => {
  const Tabs = createBottomTabNavigator<RootTabParamList, undefined>();
  const Home = createNativeStackNavigator<{ AIChat: undefined }, undefined>();
  const Life = createNativeStackNavigator<
    { CampusHome: undefined; Career: undefined },
    undefined
  >();
  const navigation = createNavigationContainerRef<RootTabParamList>();
  const onUnhandledAction = jest.fn();
  const Screen = ({ route }: { route: { name: string } }) =>
    React.createElement(Text, null, route.name);
  const Assistant = () => {
    const screenNavigation = useNavigation();
    return React.createElement(Button, {
      title: '開啟職涯',
      onPress: () => navigateMobileAssistantService('career', 'campus', screenNavigation),
    });
  };
  const HomeStack = () =>
    React.createElement(Home.Navigator, {
      id: undefined,
      screenOptions: { headerShown: false },
      children: React.createElement(Home.Screen, { name: 'AIChat', component: Assistant }),
    });
  const LifeStack = () =>
    React.createElement(Life.Navigator, {
      id: undefined,
      initialRouteName: 'CampusHome',
      screenOptions: { headerShown: false },
      children: [
        React.createElement(Life.Screen, {
          key: 'CampusHome',
          name: 'CampusHome',
          component: Screen,
        }),
        React.createElement(Life.Screen, { key: 'Career', name: 'Career', component: Screen }),
      ],
    });
  const view = render(
    React.createElement(NavigationContainer, {
      ref: navigation,
      onUnhandledAction,
      children: React.createElement(Tabs.Navigator, {
        id: undefined,
        screenOptions: { headerShown: false },
        children: (['Today', '學習', '校園', '訊息', '我的'] as const).map((name) =>
          React.createElement(Tabs.Screen, {
            key: name,
            name,
            component: name === '校園' ? LifeStack : name === 'Today' ? HomeStack : Screen,
          }),
        ),
      }),
    }),
  );
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  expect(
    navigation.getRootState().routes.find((route) => route.name === '校園')?.state,
  ).toBeUndefined();
  fireEvent.press(view.getByRole('button', { name: '開啟職涯' }));
  const state = navigation.getRootState();
  expect(state.routes[state.index]).toMatchObject({
    name: '校園',
    state: { index: 1, routes: [{ name: 'CampusHome' }, { name: 'Career' }] },
  });
  expect(navigation.getCurrentRoute()?.name).toBe('Career');
  act(() => navigation.goBack());
  expect(navigation.getCurrentRoute()?.name).toBe('CampusHome');
  expect(navigation.getRootState().routes[navigation.getRootState().index].name).toBe('校園');
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test.each(['campus', 'platform', 'guest'] as const)(
  'career rechecks the mounted page for %s and keeps its exact public fallback',
  (audience) => {
    const routes = ['Career', 'NuniWorkspace'];
    const nav = navigator(routes);
    expect(mobileAssistantServiceDestination('career', audience, nav)?.kind).toBe('native');
    routes.splice(0, 1);
    expect(mobileAssistantServiceDestination('career', audience, nav)).toEqual({
      kind: 'web',
      url: 'https://nuni.tw/career',
    });
    expect(navigateMobileAssistantService('career', audience, nav)).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
  },
);

test('platform private services never borrow Firebase tabs even if both navigators are present', () => {
  const nav = navigator(['Today', '學習', '校園', '訊息', '我的', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('community', 'platform', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/community' });
  expect(mobileAssistantServiceDestination('grades', 'platform', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/grades?tab=semester' });
  expect(navigateMobileAssistantService('admin', 'platform', nav)).toBe(false);
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('school administration and generic groups are not substituted for platform management or TronClass', () => {
  const nav = navigator(['Today', '學習', '校園', '訊息', '我的', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('admin', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/admin' });
  expect(mobileAssistantServiceDestination('school-courses', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/school-courses' });
  expect(mobileAssistantServiceDestination('merchant', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/merchant' });
});

test.each([
  ['grade-feedback', '/grades?tab=feedback'],
  ['leave-review', '/leave/review'],
  ['appeals', '/appeals'],
  ['teacher', '/teacher'],
  ['school-lms', '/school-lms'],
  ['assistant', '/ai-assistant'],
  ['account-deletion', '/account-deletion'],
  ['school-account', '/classroom/account'],
])('the %s service keeps its verified web destination %s when no native mapping exists', (id, href) => {
  const nav = navigator(['Today', '學習', '校園', '訊息', '我的', 'NuniWorkspace', 'Grades', 'AccountDeletion']);
  for (const audience of ['campus', 'platform'] as const) {
    expect(mobileAssistantServiceDestination(id, audience, nav)).toEqual({ kind: 'web', url: `https://nuni.tw${href}` });
    expect(navigateMobileAssistantService(id, audience, nav)).toBe(false);
  }
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('food uses the verified platform workspace only while mounted, and keeps campus users on the web service', () => {
  const routes = ['NuniWorkspace'];
  const nav = navigator(routes);
  expect(navigateMobileAssistantService('food', 'platform', nav)).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('NuniWorkspace', { tab: 'food' });
  expect(mobileAssistantServiceDestination('food', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/food' });
  routes.length = 0;
  expect(mobileAssistantServiceDestination('food', 'platform', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/food' });
  expect(navigateMobileAssistantService('food', 'platform', nav)).toBe(false);
  expect(nav.navigate).toHaveBeenCalledTimes(1);
});

test('an unmounted route gets an explicit fixed website destination instead of a silent tab dispatch', () => {
  const nav = navigator(['NuniTimetableAssistant', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('map', 'platform', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/map' });
  expect(mobileAssistantServiceDestination('clubs', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/clubs' });
  expect(navigateMobileAssistantService('map', 'platform', nav)).toBe(false);
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('web order fallback preserves the platform or school account boundary', () => {
  const nav = navigator(['NuniTimetableAssistant']);
  expect(mobileAssistantServiceDestination('orders', 'platform', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/food' });
  expect(mobileAssistantServiceDestination('orders', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/orders' });
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('explicit App orders opens StudentOrders for a school audience and falls back to its exact page when unmounted', () => {
  const routes = ['StudentOrders'];
  const nav = navigator(routes);
  expect(navigateMobileAssistantService('app-orders', 'campus', nav)).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('StudentOrders', undefined);
  routes.length = 0;
  expect(mobileAssistantServiceDestination('app-orders', 'campus', nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/orders' });
  expect(navigateMobileAssistantService('app-orders', 'campus', nav)).toBe(false);
  expect(nav.navigate).toHaveBeenCalledTimes(1);
});

test.each(['platform', 'guest'] as const)('explicit App orders preserves the school service for %s without borrowing a mounted school navigator', (audience) => {
  const nav = navigator(['StudentOrders', '學習', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('app-orders', audience, nav)).toEqual({ kind: 'web', url: 'https://nuni.tw/orders' });
  expect(navigateMobileAssistantService('app-orders', audience, nav)).toBe(false);
  expect(nav.navigate).not.toHaveBeenCalled();
  if (audience === 'platform') {
    expect(mobileAssistantServiceDestination('orders', audience, nav)).toEqual({ kind: 'native', route: 'NuniWorkspace', params: { tab: 'food' } });
  }
});

test.each(['campus', 'platform', 'guest'] as const)('material bookmarks uses its real web page for %s instead of pretending the generic courses tab opens bookmarks', (audience) => {
  const nav = navigator(['NuniWorkspace', 'CoursesHome', '學習']);
  expect(mobileAssistantServiceDestination('material-bookmarks', audience, nav)).toEqual({
    kind: 'web', url: 'https://nuni.tw/classroom/material-bookmarks',
  });
  expect(navigateMobileAssistantService('material-bookmarks', audience, nav)).toBe(false);
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('rechecking the navigator at click time prevents dispatch after its route disappears', () => {
  const routes = ['PersonalTimetable'];
  const nav = navigator(routes);
  expect(mobileAssistantServiceDestination('timetable', 'platform', nav)?.kind).toBe('native');
  routes.length = 0;
  expect(navigateMobileAssistantService('timetable', 'platform', nav)).toBe(false);
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('guest personal data uses the web sign-in boundary and can open a local account entry', () => {
  const nav = navigator(['PersonalTimetable', 'NuniWorkspace']);
  expect(mobileAssistantServiceDestination('timetable', 'guest', nav)?.kind).toBe('web');
  expect(navigateMobileAssistantService('account', 'guest', nav)).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('NuniWorkspace', { tab: 'account' });
});

test('a saved academic result returns to grade import and review in the same platform account', () => {
  const nav = navigator(['PersonalImport']);
  expect(navigateMobileAssistantService('import', 'platform', nav, 'grades')).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('PersonalImport', { kind: 'grades' });
});

test.each(['__proto__', 'constructor', 'https://evil.example/', '/admin', { id: 'map', href: '//evil.example' }])(
  'prompt-supplied destinations are rejected: %p', (id) => {
    const nav = navigator(['Map']);
    expect(mobileAssistantServiceDestination(id, 'campus', nav)).toBeNull();
    expect(navigateMobileAssistantService(id, 'campus', nav)).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
  },
);
