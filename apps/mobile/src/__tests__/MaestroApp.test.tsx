import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { MAESTRO_LOGIN_LINK } from '../app/maestroHarnessLink';

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

import { MaestroApp } from '../../e2e/MaestroApp';

beforeEach(() => {
  mockInitialUrl = null;
  mockLinkListener = undefined;
  mockRemoveLinkListener.mockClear();
});

test('keeps the real app visible until the emulator-login URI arrives', async () => {
  const view = render(<MaestroApp />);
  expect(view.getByTestId('app-shell')).toBeTruthy();
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
  await act(async () => undefined);
});

test('shows the emulator login overlay in the same window as the app', async () => {
  const view = render(<MaestroApp />);
  await waitFor(() => expect(mockLinkListener).toBeTruthy());
  act(() => mockLinkListener?.({ url: MAESTRO_LOGIN_LINK }));
  expect(view.getByTestId('app-shell')).toBeTruthy();
  expect(view.getByTestId('maestro-emulator-login')).toBeTruthy();
  expect(view.getByTestId('maestro-email')).toBeTruthy();
  expect(view.getByTestId('maestro-password')).toBeTruthy();
  expect(view.getByTestId('maestro-sign-in')).toBeTruthy();
});

test('opens the overlay from a trailing-slash or empty-host emulator-login URI', async () => {
  mockInitialUrl = 'campus:///maestro/sign-in/';
  const view = render(<MaestroApp />);
  await waitFor(() => expect(view.getByTestId('maestro-emulator-login')).toBeTruthy());
});

test('does not open the overlay for an unrelated campus link', async () => {
  const view = render(<MaestroApp />);
  await waitFor(() => expect(mockLinkListener).toBeTruthy());
  act(() => mockLinkListener?.({ url: 'campus://groups' }));
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
});
