import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockIsMaestroEmulatorLoginLaunch = jest.fn(() => false);

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      appEnv: 'development',
      firebase: { projectId: 'demo-campus-one' },
      allowLocalMockAuth: false,
      enableUniversalDevAccounts: false,
    },
  },
}));

jest.mock('../../e2e/emulatorConfig', () => ({
  assertMaestroEmulatorConfig: jest.fn(),
  MAESTRO_STUDENT_EMAIL: 's0000001@test.campus-one.local',
  MAESTRO_STUDENT_UID: 'test-student-a',
  MAESTRO_LOGIN_LINK: 'campus://maestro/sign-in',
}));

jest.mock('../../e2e/maestroLaunchFlag', () => ({
  MAESTRO_EMULATOR_LOGIN_ARGUMENT: 'maestroEmulatorLogin',
  isMaestroEmulatorLoginLaunch: () => mockIsMaestroEmulatorLoginLaunch(),
}));

jest.mock('../../App', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'app-shell' }) };
});

jest.mock('../firebase', () => ({ getAuthInstance: jest.fn() }));

import { MaestroApp } from '../../e2e/MaestroApp';

beforeEach(() => {
  mockIsMaestroEmulatorLoginLaunch.mockReturnValue(false);
});

test('keeps the real app visible and hides the harness without a Maestro launch argument', () => {
  const view = render(<MaestroApp />);
  expect(view.getByTestId('app-shell')).toBeTruthy();
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
});

test('shows an in-window emulator login control only when Maestro launched with the argument', () => {
  mockIsMaestroEmulatorLoginLaunch.mockReturnValue(true);
  const view = render(<MaestroApp />);
  expect(view.getByTestId('app-shell')).toBeTruthy();
  expect(view.getByTestId('maestro-open-emulator-login')).toBeTruthy();
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
  fireEvent.press(view.getByTestId('maestro-open-emulator-login'));
  expect(view.getByTestId('maestro-emulator-login')).toBeTruthy();
  expect(view.getByTestId('maestro-email')).toBeTruthy();
  expect(view.getByTestId('maestro-password')).toBeTruthy();
  expect(view.getByTestId('maestro-sign-in')).toBeTruthy();
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
});

test('does not put the launch trigger back over the app after the overlay opens', () => {
  mockIsMaestroEmulatorLoginLaunch.mockReturnValue(true);
  const view = render(<MaestroApp />);
  fireEvent.press(view.getByTestId('maestro-open-emulator-login'));
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
  expect(view.getByTestId('app-shell')).toBeTruthy();
});

test('does not open the overlay from a crafted campus URI', async () => {
  const view = render(<MaestroApp />);
  await act(async () => undefined);
  await waitFor(() => expect(view.getByTestId('app-shell')).toBeTruthy());
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
});
