import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';
import { preAuthLinking } from '../app/preAuthLinking';

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
  mockInitialUrl = null;
  mockLinkListener = undefined;
  mockRemoveLinkListener.mockClear();
});

jest.unmock('@react-navigation/native');
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ themeMode: 'light' }) }));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({ session: null, loading: false, error: '', pendingLogout: false }),
}));
jest.mock('../screens/NuniWorkspaceScreen', () => ({
  NuniWorkspaceScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="platform-workspace">Campus One 帳號</Text>;
  },
}));
jest.mock('../screens/SSOLoginScreen', () => ({
  SSOLoginScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="school-login-form">登入學校帳號</Text>;
  },
}));

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

test.each([
  ['campus://campus-one', 'NuniWorkspace', 'platform-workspace'],
  ['campus://sso-login', 'SSOLogin', 'school-login-form'],
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
  expect(navigation.canGoBack()).toBe(true);
  act(() => navigation.goBack());
  await view.findByTestId('login-landing');
  fireEvent.press(view.getByTestId('school-login-start'));
  await view.findByTestId('school-login-form');
});

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
