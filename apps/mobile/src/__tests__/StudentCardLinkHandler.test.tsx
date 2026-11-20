import React from 'react';
import { act, fireEventAsync, renderAsync } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import { STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { StudentCardLinkHandler } from '../app/StudentCardLinkHandler';
import { StudentCardReader } from '../components/StudentCardNfc';

let mockAuth: { user: { uid: string } | null; loading: boolean };
let mockPlatform: { session: { platformAccountId: string } | null; loading: boolean };
const mockLinks = new Set<(event: { url: string }) => void>();
const mockAppStates = new Set<(state: AppStateStatus) => void>();

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockPlatform }));
jest.mock('../components/StudentCardNfc', () => ({
  StudentCardReader: jest.fn(({ initialToken, onClose }) => {
    const { Pressable, Text, View } = require('react-native');
    return (
      <View testID="reader">
        <Text>{initialToken}</Text>
        <Pressable accessibilityRole="button" onPress={onClose}>
          <Text>關閉</Text>
        </Pressable>
      </View>
    );
  }),
}));

const token = 'a'.repeat(32);
const nextToken = 'b'.repeat(32);
const url = (value = token) => `https://nuni.tw/student-card/verify#${value}`;
const originalAppState = AppState.currentState;

beforeEach(() => {
  jest.clearAllMocks();
  mockLinks.clear();
  mockAppStates.clear();
  mockAuth = { user: null, loading: false };
  mockPlatform = { session: null, loading: false };
  AppState.currentState = 'active';
  jest.mocked(Linking.getInitialURL).mockResolvedValue(null);
  jest.mocked(Linking.addEventListener).mockImplementation((_event, listener) => {
    mockLinks.add(listener);
    return { remove: () => mockLinks.delete(listener) };
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    mockAppStates.add(listener);
    return { remove: () => mockAppStates.delete(listener) };
  });
});

afterEach(() => {
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function open(value = token) {
  await act(async () => mockLinks.forEach((listener) => listener({ url: url(value) })));
}

async function changeAppState(state: AppStateStatus) {
  await act(async () => {
    AppState.currentState = state;
    mockAppStates.forEach((listener) => listener(state));
  });
}

test('hands a cold-start QR token directly to the confirmation reader', async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValue(url());
  const view = await renderAsync(<StudentCardLinkHandler />);
  expect(view.getByText(token)).toBeTruthy();
  expect(Linking.getInitialURL).toHaveBeenCalledTimes(1);
});

test('ignores malformed links and clears an open card when another route arrives', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  await act(async () =>
    mockLinks.forEach((listener) => listener({ url: 'https://other.example/' })),
  );
  expect(view.queryByTestId('reader')).toBeNull();
  await open();
  await act(async () => mockLinks.forEach((listener) => listener({ url: 'campus://map' })));
  expect(view.queryByTestId('reader')).toBeNull();
  await act(async () => mockLinks.forEach((listener) => listener({ url: url('invalid') })));
  expect(view.queryByTestId('reader')).toBeNull();
});

test('keeps an open duplicate stable and permits an explicit rescan after closing', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  const onClose = jest.mocked(StudentCardReader).mock.lastCall![0].onClose;
  await open();
  expect(jest.mocked(StudentCardReader).mock.lastCall![0].onClose).toBe(onClose);
  await fireEventAsync.press(view.getByText('關閉'));
  expect(view.queryByTestId('reader')).toBeNull();
  await open();
  expect(view.getByText(token)).toBeTruthy();
  expect(jest.mocked(StudentCardReader).mock.lastCall![0].onClose).not.toBe(onClose);
});

test.each([false, true])(
  'an older initial URL cannot override a warm link (closed=%s)',
  async (closed) => {
    let resolve!: (value: string) => void;
    jest.mocked(Linking.getInitialURL).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = await renderAsync(<StudentCardLinkHandler />);
    await open(nextToken);
    if (closed) await fireEventAsync.press(view.getByText('關閉'));
    await act(async () => resolve(url()));
    expect(Boolean(view.queryByTestId('reader'))).toBe(!closed);
    expect(view.queryByText(token)).toBeNull();
  },
);

test('the latest link replaces an open reader and ignores the older close callback', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  const closePrevious = jest.mocked(StudentCardReader).mock.lastCall![0].onClose;
  await open(nextToken);
  await act(async () => closePrevious());
  expect(view.queryByText(token)).toBeNull();
  expect(view.getByText(nextToken)).toBeTruthy();
});

test('backgrounding releases the card and returning does not reopen it', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  await changeAppState('background');
  expect(view.queryByTestId('reader')).toBeNull();
  await changeAppState('active');
  expect(view.queryByTestId('reader')).toBeNull();
  await open();
  expect(view.getByText(token)).toBeTruthy();
});

test('a backgrounded initial request cannot open later when it resolves', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(Linking.getInitialURL).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await renderAsync(<StudentCardLinkHandler />);
  await changeAppState('background');
  await changeAppState('active');
  await act(async () => resolve(url()));
  expect(view.queryByTestId('reader')).toBeNull();
});

test('holds a new incoming link until the app enters the foreground', async () => {
  AppState.currentState = 'background';
  const receivedAt = Date.now();
  const now = jest.spyOn(Date, 'now').mockReturnValue(receivedAt);
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  expect(view.queryByTestId('reader')).toBeNull();
  now.mockReturnValue(receivedAt + 55_000);
  await changeAppState('active');
  expect(view.getByText(token)).toBeTruthy();
  expect(jest.mocked(StudentCardReader).mock.lastCall![0].initialExpiresAt).toBe(
    receivedAt + STUDENT_CARD_TTL_MS,
  );
});

test('expires a queued background link before it can open on return', async () => {
  AppState.currentState = 'background';
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + STUDENT_CARD_TTL_MS + 1);
  await changeAppState('active');
  expect(view.queryByTestId('reader')).toBeNull();
});

test('releases the original token at expiry while preserving the reader and its receipt', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  jest.useFakeTimers();
  try {
    await open();
    const onClose = jest.mocked(StudentCardReader).mock.lastCall![0].onClose;
    await act(async () => jest.advanceTimersByTime(STUDENT_CARD_TTL_MS + 1));
    expect(view.getByTestId('reader')).toBeTruthy();
    expect(jest.mocked(StudentCardReader).mock.lastCall![0].initialToken).toBeUndefined();
    expect(jest.mocked(StudentCardReader).mock.lastCall![0].onClose).toBe(onClose);
  } finally {
    jest.useRealTimers();
  }
});

test('returning from an inactive system overlay preserves an already displayed reader', async () => {
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  const onClose = jest.mocked(StudentCardReader).mock.lastCall![0].onClose;
  await changeAppState('inactive');
  // Simulate the clock advancing while JS timers are deferred by the system overlay.
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + STUDENT_CARD_TTL_MS + 1);
  await changeAppState('active');
  expect(view.getByTestId('reader')).toBeTruthy();
  expect(jest.mocked(StudentCardReader).mock.lastCall![0].onClose).toBe(onClose);
});

test('preserves a public link through initial account restoration', async () => {
  mockAuth.loading = true;
  mockPlatform.loading = true;
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  mockAuth = { user: { uid: 'school-a' }, loading: false };
  mockPlatform = { session: { platformAccountId: 'platform-a' }, loading: false };
  await view.rerenderAsync(<StudentCardLinkHandler />);
  expect(view.getByText(token)).toBeTruthy();
});

test('protects an observed account while its initial profile is still loading', async () => {
  mockAuth.loading = true;
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  mockAuth = { user: { uid: 'school-a' }, loading: true };
  await view.rerenderAsync(<StudentCardLinkHandler />);
  expect(view.getByText(token)).toBeTruthy();
  mockAuth = { user: { uid: 'school-b' }, loading: true };
  await view.rerenderAsync(<StudentCardLinkHandler />);
  expect(view.queryByTestId('reader')).toBeNull();
});

test('an account switch invalidates an initial URL that has not resolved yet', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(Linking.getInitialURL).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await renderAsync(<StudentCardLinkHandler />);
  mockAuth = { user: { uid: 'school-a' }, loading: true };
  await view.rerenderAsync(<StudentCardLinkHandler />);
  await act(async () => resolve(url()));
  expect(view.queryByTestId('reader')).toBeNull();
});

test.each(['school', 'platform'])(
  'closes on a %s account switch without rereading the initial URL',
  async (kind) => {
    mockAuth = { user: { uid: 'school-a' }, loading: false };
    mockPlatform = { session: { platformAccountId: 'platform-a' }, loading: false };
    const view = await renderAsync(<StudentCardLinkHandler />);
    await open();
    if (kind === 'school') mockAuth = { user: { uid: 'school-b' }, loading: true };
    else mockPlatform = { session: { platformAccountId: 'platform-b' }, loading: true };
    await view.rerenderAsync(<StudentCardLinkHandler />);
    expect(view.queryByTestId('reader')).toBeNull();
    expect(Linking.getInitialURL).toHaveBeenCalledTimes(1);
  },
);

test('cleans up listeners and discards a delayed initial URL after unmount', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(Linking.getInitialURL).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await renderAsync(<StudentCardLinkHandler />);
  await view.unmountAsync();
  await act(async () => resolve(url()));
  expect(mockLinks.size).toBe(0);
  expect(mockAppStates.size).toBe(0);
  expect(StudentCardReader).not.toHaveBeenCalled();
});

test('handles an unavailable initial URL without blocking future links', async () => {
  jest.mocked(Linking.getInitialURL).mockRejectedValue(new Error('unavailable'));
  const view = await renderAsync(<StudentCardLinkHandler />);
  await open();
  expect(view.getByText(token)).toBeTruthy();
});
