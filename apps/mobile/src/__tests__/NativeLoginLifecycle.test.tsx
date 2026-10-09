import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniSessionProvider } from '../state/nuniSession';
import { NuniWorkspaceScreen } from '../screens/NuniWorkspaceScreen';

const account = 'pa_11111111-1111-4111-8111-111111111111';
const handle = 'ps_' + 'a'.repeat(43);
let mockStored: string | null = null;
let mockAvailable = true;
let mockAppActive: ((state: string) => void) | undefined;
const mockRequest = jest.fn();
const mockCapability = jest.fn();
const mockCredential = jest.fn();
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => mockAvailable,
  getItemAsync: async () => mockStored,
  setItemAsync: async (_key: string, value: string) => {
    mockStored = value;
  },
  deleteItemAsync: async () => {
    mockStored = null;
  },
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
}));
jest.mock('../services/nuniClient', () => ({
  ...jest.requireActual('../services/nuniClient'),
  nuniPlatformRequest: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock('../services/nuniGoogle', () => ({
  getGoogleCredentialCapability: () => mockCapability(),
  requestGoogleCredential: (...args: unknown[]) => mockCredential(...args),
  clearGoogleCredentialState: jest.fn(),
}));
jest.mock('../screens/nuni/NuniCourses', () => ({
  NuniCourses: () => {
    const { TextInput } = require('react-native');
    const { useNuniDraftState } = jest.requireActual('../state/nuniDrafts');
    const [draft, setDraft] = useNuniDraftState('test:lifecycle-draft', '');
    return <TextInput testID="review-course-draft" value={draft} onChangeText={setDraft} />;
  },
}));
jest.mock('../screens/nuni/NuniMerchant', () => ({
  NuniMerchant: () => null,
}));
beforeEach(() => {
  mockRequest.mockClear();
  mockCredential.mockReset();
  mockStored = JSON.stringify({
    sessionHandle: handle,
    platformAccountId: account,
    expiresAt: Date.now() + 3600000,
    pendingLogout: false,
  });
  mockAvailable = true;
  mockCapability.mockReturnValue({ available: true });
  mockRequest.mockImplementation(async (path: string) => {
    if (path === 'sessions/current')
      return { authenticated: true, platformAccountId: account, isPlatformOperator: false };
    if (path === 'memberships') return { memberships: [] };
    return {};
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    mockAppActive = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());
const ui = () => (
  <NuniSessionProvider>
    <NuniWorkspaceScreen />
  </NuniSessionProvider>
);

it('same verified account retains its draft after going to another app and back', async () => {
  const view = render(ui());
  fireEvent.changeText(await view.findByTestId('review-course-draft'), '訪談作業尚未送出');
  await act(async () => {
    mockAppActive?.('background');
  });
  let accept!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  await act(async () => {
    mockAppActive?.('active');
  });
  expect(view.queryByTestId('review-course-draft')).toBeNull();
  expect(view.getByLabelText('正在確認 Campus One 帳號')).toBeTruthy();
  await act(async () =>
    accept({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
  );
  await waitFor(() => expect(view.getByTestId('review-course-draft')).toBeTruthy());
  expect(mockRequest.mock.calls.filter(([path]) => path === 'sessions/current')).toHaveLength(2);
  expect(view.getByTestId('review-course-draft').props.value).toBe('訪談作業尚未送出');
});
it('unavailable secure storage still permits the promised Web fallback', async () => {
  mockAvailable = false;
  mockStored = null;
  mockCapability.mockReturnValue({ available: false, reason: 'unsupported-platform' });
  const view = render(ui());
  await view.findByText('目前無法確認登入狀態');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新確認登入狀態' })));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新確認登入狀態' })));
  expect(view.getByRole('button', { name: '開啟網頁版登入' })).toBeTruthy();
});

it('a cancelled Google chooser returns to a usable native sign-in action', async () => {
  mockStored = null;
  mockCredential.mockRejectedValueOnce({ code: 'CANCELLED' });
  mockRequest.mockImplementation(async (path) =>
    path === 'login-transactions'
      ? {
          kind: 'google-consumer',
          transactionId: `pt_${'b'.repeat(43)}`,
          nonce: 'c'.repeat(43),
          clientId: '123-test.apps.googleusercontent.com',
          issuer: 'https://accounts.google.com',
          authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          expiresInSeconds: 600,
        }
      : {},
  );
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '使用 Google 繼續' }));
  await waitFor(() => expect(mockCredential).toHaveBeenCalledTimes(1));
  await view.findByRole('button', { name: '使用 Google 繼續' });
  expect(view.queryByText('目前無法確認登入狀態')).toBeNull();
  expect(mockRequest.mock.calls.some(([path]) => path === 'sessions')).toBe(false);
});
