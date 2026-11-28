import React from 'react';
import { Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getAuthInstance } from '../firebase';

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

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

import { MaestroApp } from '../../e2e/MaestroApp';
import { publishSchoolSessionReady } from '../app/SchoolSessionBoundary';

const emulatorAuth = {
  app: { options: { projectId: 'demo-campus-one' } },
  emulatorConfig: { host: '127.0.0.1', port: 19291 },
};

function openLogin() {
  const view = render(<MaestroApp />);
  fireEvent.press(view.getByTestId('maestro-open-emulator-login'));
  return view;
}

beforeEach(() => {
  jest.mocked(getAuthInstance).mockReturnValue(emulatorAuth as ReturnType<typeof getAuthInstance>);
  jest.mocked(signInWithEmailAndPassword).mockReset();
  jest.mocked(signOut).mockReset();
  publishSchoolSessionReady(false);
});

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
  expect(view.getByTestId('maestro-password').props.secureTextEntry).toBe(false);
  expect(view.getByTestId('maestro-password').props.selectTextOnFocus).toBe(true);
  expect(view.getByTestId('maestro-password').props.autoComplete).toBe('off');
  expect(view.getByTestId('maestro-password').props.textContentType).toBe('none');
  expect(view.getByTestId('maestro-sign-in')).toBeTruthy();
  expect(view.queryByTestId('maestro-open-emulator-login')).toBeNull();
});

test('does not open the overlay from a crafted campus URI', async () => {
  const view = render(<MaestroApp />);
  await act(async () => undefined);
  await waitFor(() => expect(view.getByTestId('app-shell')).toBeTruthy());
  expect(view.queryByTestId('maestro-emulator-login')).toBeNull();
});

test('password return key dismisses the keyboard and signs in the seeded fixture', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const getIdToken = jest.fn().mockResolvedValue('token');
  jest.mocked(signInWithEmailAndPassword).mockImplementation(async () => {
    queueMicrotask(() => publishSchoolSessionReady(true));
    return { user: { uid: 'test-student-a', getIdToken } } as never;
  });

  const view = openLogin();
  fireEvent.changeText(view.getByTestId('maestro-email'), 's0000001@test.campus-one.local');
  fireEvent.changeText(view.getByTestId('maestro-password'), 'campus-test-1234');
  fireEvent(view.getByTestId('maestro-password'), 'submitEditing');

  await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
  expect(dismiss).toHaveBeenCalled();
  expect(getIdToken).toHaveBeenCalledWith(true);
  await waitFor(() => expect(view.queryByTestId('maestro-emulator-login')).toBeNull());
  dismiss.mockRestore();
});

test('iOS native typing updates the password used for emulator sign-in', async () => {
  const getIdToken = jest.fn().mockResolvedValue('token');
  jest.mocked(signInWithEmailAndPassword).mockImplementation(async () => {
    queueMicrotask(() => publishSchoolSessionReady(true));
    return { user: { uid: 'test-student-a', getIdToken } } as never;
  });

  const view = openLogin();
  fireEvent.changeText(view.getByTestId('maestro-email'), 's0000001@test.campus-one.local');
  fireEvent(view.getByTestId('maestro-password'), 'change', {
    nativeEvent: { text: 'campus-test-1234' },
  });
  fireEvent.press(view.getByTestId('maestro-sign-in'));

  await waitFor(() =>
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      emulatorAuth,
      's0000001@test.campus-one.local',
      'campus-test-1234',
    ),
  );
  await waitFor(() => expect(view.queryByTestId('maestro-emulator-login')).toBeNull());
});

test('keeps the overlay until the school session is ready after Firebase Auth succeeds', async () => {
  const getIdToken = jest.fn().mockResolvedValue('token');
  jest.mocked(signInWithEmailAndPassword).mockResolvedValue({
    user: { uid: 'test-student-a', getIdToken },
  } as never);

  const view = openLogin();
  fireEvent.changeText(view.getByTestId('maestro-email'), 's0000001@test.campus-one.local');
  fireEvent.changeText(view.getByTestId('maestro-password'), 'campus-test-1234');
  fireEvent.press(view.getByTestId('maestro-sign-in'));

  await waitFor(() => expect(getIdToken).toHaveBeenCalledWith(true));
  expect(view.getByTestId('maestro-emulator-login')).toBeTruthy();
  await act(async () => {
    publishSchoolSessionReady(true);
  });
  await waitFor(() => expect(view.queryByTestId('maestro-emulator-login')).toBeNull());
});

test('tapping sign-in while the password field is focused still submits', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  jest.mocked(signInWithEmailAndPassword).mockRejectedValue(new Error('wrong password'));

  const view = openLogin();
  fireEvent.changeText(view.getByTestId('maestro-email'), 's0000001@test.campus-one.local');
  fireEvent.changeText(view.getByTestId('maestro-password'), 'incorrect-emulator-fixture-password');
  fireEvent.press(view.getByTestId('maestro-sign-in'));

  await waitFor(() => expect(view.getByTestId('maestro-login-error')).toBeTruthy());
  expect(dismiss).toHaveBeenCalled();
  expect(view.getByTestId('maestro-sign-in')).toBeTruthy();
  expect(view.getByTestId('maestro-password').props.value).toBe('');
  dismiss.mockRestore();
});

test('retry after a rejected password submits only the replacement fixture', async () => {
  const getIdToken = jest.fn().mockResolvedValue('token');
  jest.mocked(signInWithEmailAndPassword)
    .mockRejectedValueOnce(new Error('wrong password'))
    .mockImplementation(async () => {
      queueMicrotask(() => publishSchoolSessionReady(true));
      return { user: { uid: 'test-student-a', getIdToken } } as never;
    });

  const view = openLogin();
  fireEvent.changeText(view.getByTestId('maestro-email'), 's0000001@test.campus-one.local');
  fireEvent.changeText(view.getByTestId('maestro-password'), 'incorrect-emulator-fixture-password');
  fireEvent.press(view.getByTestId('maestro-sign-in'));
  await waitFor(() => expect(view.getByTestId('maestro-login-error')).toBeTruthy());
  expect(view.getByTestId('maestro-password').props.value).toBe('');

  fireEvent.changeText(view.getByTestId('maestro-password'), 'campus-test-1234');
  fireEvent.press(view.getByTestId('maestro-sign-in'));

  await waitFor(() =>
    expect(signInWithEmailAndPassword).toHaveBeenLastCalledWith(
      emulatorAuth,
      's0000001@test.campus-one.local',
      'campus-test-1234',
    ),
  );
  await waitFor(() => expect(view.queryByTestId('maestro-emulator-login')).toBeNull());
});
