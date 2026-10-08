import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';

jest.unmock('@react-navigation/native');
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ themeMode: 'light' }) }));
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
  fireEvent.press(await view.findByTestId('login-start'));
  await waitFor(() => expect(view.getByTestId('school-login-form')).toBeTruthy());
  expect(navigation.getRootState().index).toBe(1);
  expect(navigation.getCurrentRoute()?.name).toBe('SSOLogin');
  view.rerender(content());
  expect(navigation.getCurrentRoute()?.name).toBe('SSOLogin');
  expect(onUnhandledAction).not.toHaveBeenCalled();
});
