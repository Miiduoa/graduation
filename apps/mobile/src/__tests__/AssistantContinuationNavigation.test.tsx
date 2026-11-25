import React, { createContext, useContext } from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { resolveAssistantServiceIntent } from '@campus/shared/src/assistantServices';
import { QuickCampusEntry } from '../components/QuickCampusEntry';
import { AssistantContinuationHost } from '../components/AssistantContinuationHost';
import { askCampusAssistant } from '../features/campusAssistant';
import { serviceDirectoryReply } from '../features/nuniWorkContextReply';
import { dismissAssistantContinuation, getAssistantContinuation } from '../services/assistantContinuation';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from '../screens/UnavailableFeatureScreen';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import type { RootTabParamList } from '../app/rootNavigation';

jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/campusAssistant', () => ({
  ...jest.requireActual('../features/campusAssistant'), askCampusAssistant: jest.fn(),
}));
jest.mock('../services/campusIntentClient', () => ({ interpretMobileCampusRequest: jest.fn() }));

const Scope = createContext({ uid: 'alice', schoolId: 'pu' });
function Source({ navigation }: ServiceScreenProps) {
  const scope = useContext(Scope);
  return <QuickCampusEntry {...scope} navigation={navigation} presentation="workspace"
    onOpen={(action) => safeNavigate(navigation, action.route)} />;
}
function Destination({ route }: { route: { name: string } }) { return <Text>{route.name}</Text>; }

type HomeParamList = Pick<PreAuthStackParamList, 'AIChat'> & { MapV2: undefined };
type LifeParamList = Pick<PreAuthStackParamList, 'Explore'> & { Earlier: undefined; MapV2: undefined };

function fixture(withTabs = true) {
  const Home = createNativeStackNavigator<HomeParamList, undefined>();
  const Life = createNativeStackNavigator<LifeParamList, undefined>();
  const Tabs = createBottomTabNavigator<RootTabParamList, undefined>();
  const navigation = createNavigationContainerRef<RootTabParamList & HomeParamList>();
  const unhandled = jest.fn();
  // Only the host's view of navigation readiness is overridden. The underlying
  // navigation container still performs the actual service and return actions.
  let snapshot: 'normal' | 'no-route' | 'new-root' = 'normal';
  const hostListeners = new Set<() => void>();
  const hostNavigation = {
    isReady: () => navigation.isReady(),
    getRootState: () => ({ key: snapshot === 'new-root' ? 'replacement-root' : navigation.getRootState().key }),
    getCurrentRoute: () => snapshot === 'no-route' ? undefined : navigation.getCurrentRoute(),
    addListener: (_event: 'state', listener: () => void) => {
      hostListeners.add(listener);
      const unsubscribe = navigation.addListener('state', listener);
      return () => { hostListeners.delete(listener); unsubscribe(); };
    },
  };
  function setHostSnapshot(next: typeof snapshot) {
    snapshot = next;
    hostListeners.forEach(listener => listener());
  }
  function HomeStack() {
    return <Home.Navigator id={undefined} screenOptions={{ headerShown: false }}>
      <Home.Screen name="AIChat" component={Source} />
      {!withTabs ? <Home.Screen name="MapV2" component={Destination} /> : null}
    </Home.Navigator>;
  }
  function LifeStack() {
    return <Life.Navigator id={undefined} screenOptions={{ headerShown: false }}>
      <Life.Screen name="Explore" component={Destination} />
      <Life.Screen name="Earlier" component={Destination} />
      <Life.Screen name="MapV2" component={Destination} />
    </Life.Navigator>;
  }
  function App({ uid = 'alice', schoolId = 'pu' }: { uid?: string; schoolId?: string }) {
    return <Scope.Provider value={{ uid, schoolId }}>
      <NavigationContainer ref={navigation} onUnhandledAction={unhandled}>
        <View style={{ flex: 1 }}>
          {withTabs ? <Tabs.Navigator id={undefined} screenOptions={{ headerShown: false }}>
            <Tabs.Screen name="Today" component={HomeStack} />
            <Tabs.Screen name="校園" component={LifeStack} />
          </Tabs.Navigator> : <HomeStack />}
          <AssistantContinuationHost navigationRef={hostNavigation} hasTabBar={withTabs} />
        </View>
      </NavigationContainer>
    </Scope.Provider>;
  }
  return { App, navigation, unhandled, setHostSnapshot };
}

beforeEach(() => {
  jest.clearAllMocks();
  dismissAssistantContinuation();
  const intent = resolveAssistantServiceIntent('開啟校園地圖');
  if (!intent) throw Error('The production service parser must recognize the journey');
  jest.mocked(askCampusAssistant).mockResolvedValue(serviceDirectoryReply(intent));
});
afterEach(() => dismissAssistantContinuation());

test.each([false, true])('an inline reply opens a real service and resumes the same conversation with an already visited destination tab: %s', async (visited) => {
  const { App, navigation, unhandled } = fixture();
  const view = render(<App />);
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  if (visited) {
    act(() => navigation.navigate('校園', { screen: 'Earlier', initial: false }));
    act(() => navigation.navigate('Today'));
  }
  const sourceKey = navigation.getCurrentRoute()?.key;
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '開啟校園地圖');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '詢問手機助理' })));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '接著想問的問題');
  fireEvent.press(view.getByRole('button', { name: '開啟校園地圖' }));
  expect(navigation.getCurrentRoute()?.name).toBe('MapV2');
  const destinationKeys = navigation.getRootState().routes.find((route) => route.name === '校園')?.state?.routes.map((route) => route.key);
  fireEvent.press(await view.findByRole('button', { name: '接著問 nuni' }));
  expect(navigation.getCurrentRoute()).toMatchObject({ key: sourceKey, name: 'AIChat' });
  expect(view.getByDisplayValue('接著想問的問題')).toBeTruthy();
  expect(view.getByText('可以從下方開啟校園地圖，再接續處理。')).toBeTruthy();
  expect(askCampusAssistant).toHaveBeenCalledTimes(1);
  expect(navigation.getRootState().routes.find((route) => route.name === '校園')?.state?.routes.map((route) => route.key)).toEqual(destinationKeys);
  expect(view.queryByRole('button', { name: '接著問 nuni' })).toBeNull();
  expect(unhandled).not.toHaveBeenCalled();
});

test('a single public stack returns to the exact existing source instead of starting another conversation', async () => {
  const { App, navigation, unhandled } = fixture(false);
  const view = render(<App />);
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  const sourceKey = navigation.getCurrentRoute()?.key;
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '開啟校園地圖');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '詢問手機助理' })));
  fireEvent.press(view.getByRole('button', { name: '開啟校園地圖' }));
  expect(navigation.getCurrentRoute()?.name).toBe('MapV2');
  const ticket = getAssistantContinuation();
  fireEvent.press(await view.findByRole('button', { name: '接著問 nuni' }));
  expect(navigation.getCurrentRoute()).toMatchObject({ key: sourceKey, name: 'AIChat' });
  expect(view.getByText('可以從下方開啟校園地圖，再接續處理。')).toBeTruthy();
  expect(navigation.getRootState().routes).toHaveLength(1);
  act(() => expect(ticket?.resume()).toBe(false));
  expect(askCampusAssistant).toHaveBeenCalledTimes(1);
  expect(unhandled).not.toHaveBeenCalled();
});

test.each(['account', 'school'] as const)('changing the %s revokes the old return address even after switching back', async (change) => {
  const { App, navigation, unhandled } = fixture();
  const view = render(<App />);
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '開啟校園地圖');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '詢問手機助理' })));
  fireEvent.press(view.getByRole('button', { name: '開啟校園地圖' }));
  const ticket = getAssistantContinuation();
  expect(ticket).not.toBeNull();
  view.rerender(<App uid={change === 'account' ? 'bob' : 'alice'} schoolId={change === 'school' ? 'nthu' : 'pu'} />);
  expect(view.queryByRole('button', { name: '接著問 nuni' })).toBeNull();
  act(() => expect(ticket?.resume()).toBe(false));
  view.rerender(<App />);
  act(() => expect(ticket?.resume()).toBe(false));
  expect(navigation.getCurrentRoute()?.name).toBe('MapV2');
  expect(askCampusAssistant).toHaveBeenCalledTimes(1);
  expect(unhandled).not.toHaveBeenCalled();
});

test.each([false, true])('a manual return consumes the handoff without reopening it on a later unrelated visit: tabs=%s', async (withTabs) => {
  const { App, navigation, unhandled } = fixture(withTabs);
  const view = render(<App />);
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  const sourceKey = navigation.getCurrentRoute()?.key;
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '開啟校園地圖');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '詢問手機助理' })));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '保留這份草稿');
  fireEvent.press(view.getByRole('button', { name: '開啟校園地圖' }));
  expect(navigation.getCurrentRoute()?.name).toBe('MapV2');
  expect(await view.findByRole('button', { name: '接著問 nuni' })).toBeTruthy();
  const ticket = getAssistantContinuation();
  expect(ticket).not.toBeNull();
  act(() => {
    if (withTabs) navigation.navigate('Today');
    else navigation.goBack();
  });
  await waitFor(() => expect(navigation.getCurrentRoute()?.key).toBe(sourceKey));
  expect(getAssistantContinuation()).toBeNull();
  expect(view.getByDisplayValue('保留這份草稿')).toBeTruthy();
  act(() => {
    if (withTabs) navigation.navigate('校園', { screen: 'Earlier', initial: false });
    else navigation.navigate('MapV2');
  });
  expect(navigation.getCurrentRoute()?.key).not.toBe(sourceKey);
  expect(view.queryByRole('button', { name: '接著問 nuni' })).toBeNull();
  act(() => expect(ticket?.resume()).toBe(false));
  expect(askCampusAssistant).toHaveBeenCalledTimes(1);
  expect(unhandled).not.toHaveBeenCalled();
});

test('a temporarily unknown route hides the return action; a replacement root permanently revokes it', async () => {
  const { App, navigation, unhandled, setHostSnapshot } = fixture();
  const view = render(<App />);
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '開啟校園地圖');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '詢問手機助理' })));
  fireEvent.press(view.getByRole('button', { name: '開啟校園地圖' }));
  expect(await view.findByRole('button', { name: '接著問 nuni' })).toBeTruthy();
  const ticket = getAssistantContinuation();
  expect(ticket).not.toBeNull();
  act(() => setHostSnapshot('no-route'));
  expect(view.queryByRole('button', { name: '接著問 nuni' })).toBeNull();
  expect(getAssistantContinuation()).toBe(ticket);
  act(() => setHostSnapshot('normal'));
  expect(view.getByRole('button', { name: '接著問 nuni' })).toBeTruthy();
  act(() => setHostSnapshot('new-root'));
  expect(getAssistantContinuation()).toBeNull();
  act(() => setHostSnapshot('normal'));
  expect(view.queryByRole('button', { name: '接著問 nuni' })).toBeNull();
  act(() => expect(ticket?.resume()).toBe(false));
  expect(navigation.getCurrentRoute()?.name).toBe('MapV2');
  expect(askCampusAssistant).toHaveBeenCalledTimes(1);
  expect(unhandled).not.toHaveBeenCalled();
});
