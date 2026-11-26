import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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

jest.mock('../../App', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'app-shell' }) };
});

jest.mock('../firebase', () => ({ getAuthInstance: jest.fn() }));

import { MaestroApp } from '../../e2e/MaestroApp';

test('keeps the real app visible and offers an in-window emulator login control', () => {
  const view = render(<MaestroApp />);
  expect(view.getByTestId('app-shell')).toBeTruthy();
  expect(view.getByTestId('maestro-open-emulator-login')).toBeTruthy();
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
});

test('opens the emulator login overlay in the same window after tapping the control', () => {
  const view = render(<MaestroApp />);
  expect(view.getByTestId('app-shell')).toBeTruthy();
  fireEvent.press(view.getByTestId('maestro-open-emulator-login'));
  expect(view.getByTestId('maestro-emulator-login')).toBeTruthy();
  expect(view.getByTestId('maestro-email')).toBeTruthy();
  expect(view.getByTestId('maestro-password')).toBeTruthy();
  expect(view.getByTestId('maestro-sign-in')).toBeTruthy();
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
});

test('does not open the overlay from a crafted campus URI', async () => {
  const view = render(<MaestroApp />);
  await act(async () => undefined);
  await waitFor(() => expect(view.getByTestId('app-shell')).toBeTruthy());
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
});
