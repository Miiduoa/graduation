import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../state/auth';
import { signOut } from 'firebase/auth';
import { clearAllCache } from '../data/cachedSource';
import { clearMockAuthSession } from '../services/mockAuth';

const mockFirebaseAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'u1' } };
const mockBeginReminderCleanup = jest.fn(async () => 0);
const mockEndReminderCleanup = jest.fn();
jest.mock('../firebase', () => ({
  getAuthInstance: () => mockFirebaseAuth,
  hasUsableFirebaseConfig: () => true,
  subscribeToTokenRefresh: () => () => undefined,
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => undefined,
  signOut: jest.fn(),
}));
jest.mock('../data/postLoginDataRouter', () => ({ buildPostLoginContext: jest.fn() }));
jest.mock('../services/campusAssignmentReminders', () => ({
  beginCampusAssignmentReminderSignOutCleanup: () => mockBeginReminderCleanup(),
  endCampusAssignmentReminderSignOutCleanup: () => mockEndReminderCleanup(),
}));
jest.mock('../data/cachedSource', () => ({ clearAllCache: jest.fn() }));
jest.mock('../services/offline', () => ({
  clearAllOfflineData: jest.fn(),
  getOfflineQueue: async () => [],
}));
jest.mock('../services/notifications', () => ({
  getCachedPushToken: async () => null,
  removePushTokenFromFirestore: jest.fn(),
}));
jest.mock('../services/mockAuth', () => ({
  clearMockAuthSession: jest.fn(),
  loadMockAuthSession: async () => null,
}));
jest.mock('../services/scopedStorage', () => ({ clearUserScopedStorage: jest.fn() }));
jest.mock('../data/puDataCache', () => ({ puCacheClearAll: jest.fn() }));
jest.mock('../services/puDataCache', () => ({
  clearPUCache: jest.fn(),
  getAnyCachedAnnouncements: jest.fn(),
  getAnyCachedCourses: jest.fn(),
  getAnyCachedTCCourses: jest.fn(),
}));
jest.mock('../services/postLoginContextHolder', () => ({ setInMemoryPostLoginContext: jest.fn() }));
jest.mock('../services/studentIdAuth', () => ({ clearPUSession: jest.fn() }));
jest.mock('../services/tronClassClient', () => ({
  clearTCSession: jest.fn(),
  purgeLegacyTCSensitiveStorage: async () => undefined,
}));
let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockBeginReminderCleanup.mockResolvedValue(0);
  mockFirebaseAuth.currentUser = { uid: 'u1' };
  for (const [module, names] of [
    ['../data/cachedSource', ['clearAllCache']],
    ['../services/offline', ['clearAllOfflineData']],
    ['../services/mockAuth', ['clearMockAuthSession']],
    ['../services/scopedStorage', ['clearUserScopedStorage']],
    ['../data/puDataCache', ['puCacheClearAll']],
    ['../services/puDataCache', ['clearPUCache']],
    ['../services/tronClassClient', ['clearTCSession']],
  ] as const) {
    const exports = require(module);
    names.forEach((name) => exports[name].mockResolvedValue(undefined));
  }
  jest.mocked(signOut).mockImplementation(async () => {
    mockFirebaseAuth.currentUser = null;
  });
});

test('a deletion logout for a former account performs no cache cleanup or SDK signout', async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  mockFirebaseAuth.currentUser = { uid: 'u2' };
  await expect(auth.signOut('u1')).rejects.toThrow('account changed');
  expect(clearAllCache).not.toHaveBeenCalled();
  expect(mockBeginReminderCleanup).not.toHaveBeenCalled();
  expect(clearMockAuthSession).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});
test('an account switch while cleanup waits cannot sign out the new account or restart cleanup', async () => {
  const pending = deferred();
  jest.mocked(clearAllCache).mockReturnValueOnce(pending.promise);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const outcome = auth.signOut('u1').catch((error: Error) => error);
  mockFirebaseAuth.currentUser = { uid: 'u2' };
  pending.resolve();
  expect(await outcome).toEqual(
    expect.objectContaining({ message: expect.stringContaining('account changed') }),
  );
  expect(signOut).not.toHaveBeenCalled();
  expect(clearMockAuthSession).toHaveBeenCalledTimes(1);
  quiet.mockRestore();
});
test('matching-account deletion logout completes actual SDK signout', async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  await act(async () => auth.signOut('u1'));
  expect(signOut).toHaveBeenCalledWith(mockFirebaseAuth);
  expect(mockBeginReminderCleanup).toHaveBeenCalledTimes(1);
  expect(mockEndReminderCleanup).toHaveBeenCalledTimes(1);
  expect(mockFirebaseAuth.currentUser).toBeNull();
});

test('a second bound logout reports the pending operation instead of false completion', async () => {
  const pending = deferred();
  jest.mocked(clearAllCache).mockReturnValueOnce(pending.promise);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  const first = auth.signOut('u1');
  await expect(auth.signOut('u1')).rejects.toThrow('already in progress');
  await act(async () => {
    pending.resolve();
    await first;
  });
  expect(signOut).toHaveBeenCalledTimes(1);
});


test('sign-out does not change identity before Agent notification cleanup finishes', async () => {
  let finish!: () => void;
  mockBeginReminderCleanup.mockImplementationOnce(() =>
    new Promise<number>((resolve) => { finish = () => resolve(1); }));
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => undefined);
  const pending = auth.signOut('u1');
  expect(mockBeginReminderCleanup).toHaveBeenCalledTimes(1);
  expect(signOut).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(mockEndReminderCleanup).toHaveBeenCalledTimes(1);
});

test('failed Agent reminder cleanup is surfaced yet releases the sign-out fence', async () => {
  mockBeginReminderCleanup.mockRejectedValueOnce(new Error('Local OS notification cleanup failed'));
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => undefined);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await act(async () => auth.signOut('u1'));
  expect(mockBeginReminderCleanup).toHaveBeenCalledTimes(1);
  expect(mockEndReminderCleanup).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});
