import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../state/auth';
import { signOut } from 'firebase/auth';
import { clearAllCache } from '../data/cachedSource';
import { clearAllOfflineData } from '../services/offline';
import { clearMockAuthSession } from '../services/mockAuth';
import { clearUserScopedStorage } from '../services/scopedStorage';
import { clearTCSession } from '../services/tronClassClient';
import { clearPUSession } from '../services/studentIdAuth';
import { clearPUCache } from '../services/puDataCache';
import { puCacheClearAll } from '../data/puDataCache';
import { clearOwnedPuCampusSessions } from '../services/clearOwnedPuCampusSessions';
import type { PostLoginContext } from '../data/postLoginTypes';
import { getInMemoryPostLoginContext, setInMemoryPostLoginContext } from '../services/postLoginContextHolder';
import { executeSmartAction } from '../services/aiSmartActions';
import { getAnyCachedTCTodos } from '../services/supabaseLmsCache';
import {
  bindVerifiedSchoolAiScope,
  getVerifiedSchoolAiScope,
  isVerifiedSchoolAiScopeCurrent,
  revokeVerifiedSchoolAiScope,
} from '../services/verifiedSchoolAiScope';

const mockFirebaseAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'u1' } };
const mockBeginReminderCleanup = jest.fn(async () => 0);
const mockEndReminderCleanup = jest.fn();
const mockBeginPlanCleanup = jest.fn(async () => undefined);
const mockEndPlanCleanup = jest.fn();
jest.mock('../firebase', () => ({
  getAuthInstance: () => mockFirebaseAuth,
  hasUsableFirebaseConfig: () => true,
  subscribeToTokenRefresh: () => () => undefined,
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => undefined,
  signOut: jest.fn(),
}));
jest.mock('../data/postLoginDataRouter', () => ({ getPostLoginContext: jest.fn(async () => null), buildPostLoginContext: jest.fn() }));
jest.mock('../services/campusAssignmentReminders', () => ({
  beginCampusAssignmentReminderSignOutCleanup: () => mockBeginReminderCleanup(),
  endCampusAssignmentReminderSignOutCleanup: () => mockEndReminderCleanup(),
}));
jest.mock('../services/savedCampusPlans', () => ({
  beginSavedCampusPlansSignOutCleanup: () => mockBeginPlanCleanup(),
  endSavedCampusPlansSignOutCleanup: () => mockEndPlanCleanup(),
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
jest.mock('../services/postLoginContextHolder', () => ({ getInMemoryPostLoginContext: jest.fn(() => null), setInMemoryPostLoginContext: jest.fn() }));
jest.mock('../services/studentIdAuth', () => ({ clearPUSession: jest.fn() }));
jest.mock('../services/supabaseLmsCache', () => ({
  getAnyCachedTCActivities: jest.fn(async () => null),
  getAnyCachedTCCourses: jest.fn(async () => null),
  getAnyCachedTCTodos: jest.fn(async () => null),
}));
jest.mock('../services/clearOwnedPuCampusSessions', () => ({
  clearOwnedPuCampusSessions: jest.fn().mockResolvedValue(undefined),
}));
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
  revokeVerifiedSchoolAiScope();
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  mockBeginReminderCleanup.mockResolvedValue(0);
  mockBeginPlanCleanup.mockResolvedValue(undefined);
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

test.each(['u2', null])('a deletion logout for a former account performs no cleanup with current UID %s', async (currentUid) => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  mockFirebaseAuth.currentUser = currentUid ? { uid: currentUid } : null;
  const revoke = jest.spyOn(require('../services/verifiedSchoolAiScope'), 'revokeVerifiedSchoolAiScope');
  jest.mocked(setInMemoryPostLoginContext).mockClear();
  await expect(auth.signOut('u1')).rejects.toThrow('account changed');
  expect(revoke).not.toHaveBeenCalled();
  expect(clearAllCache).not.toHaveBeenCalled();
  expect(clearAllOfflineData).not.toHaveBeenCalled();
  expect(clearUserScopedStorage).not.toHaveBeenCalled();
  expect(mockBeginReminderCleanup).not.toHaveBeenCalled();
  expect(mockBeginPlanCleanup).not.toHaveBeenCalled();
  expect(mockEndReminderCleanup).not.toHaveBeenCalled();
  expect(clearMockAuthSession).not.toHaveBeenCalled();
  expect(clearTCSession).not.toHaveBeenCalled();
  expect(clearOwnedPuCampusSessions).not.toHaveBeenCalled();
  expect(clearPUSession).not.toHaveBeenCalled();
  expect(clearPUCache).not.toHaveBeenCalled();
  expect(puCacheClearAll).not.toHaveBeenCalled();
  expect(setInMemoryPostLoginContext).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
  revoke.mockRestore();
});
test.each([
  { label: 'explicit UID', initialUid: 'u1', expectedUid: 'u1', nextUid: 'u2' },
  { label: 'omitted UID', initialUid: 'u1', expectedUid: undefined, nextUid: 'u2' },
  { label: 'initially signed out', initialUid: null, expectedUid: undefined, nextUid: 'u2' },
  { label: 'account disappears', initialUid: 'u1', expectedUid: undefined, nextUid: null },
])('an account change while cleanup waits stops further sign-out with $label', async ({ initialUid, expectedUid, nextUid }) => {
  const pending = deferred();
  jest.mocked(clearAllCache).mockReturnValueOnce(pending.promise);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  mockFirebaseAuth.currentUser = initialUid ? { uid: initialUid } : null;
  jest.mocked(setInMemoryPostLoginContext).mockClear();
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const signingOut = expectedUid === undefined ? auth.signOut() : auth.signOut(expectedUid);
  const outcome = signingOut.catch((error: Error) => error);
  const guards = [
    jest.mocked(clearAllCache).mock.calls[0][0],
    jest.mocked(clearAllOfflineData).mock.calls[0][0],
    jest.mocked(clearUserScopedStorage).mock.calls[0][1],
  ];
  for (const guard of guards) {
    expect(guard).toEqual(expect.any(Function));
    expect(guard).not.toThrow();
  }
  mockFirebaseAuth.currentUser = nextUid ? { uid: nextUid } : null;
  for (const guard of guards) {
    expect(guard).toThrow('account changed');
  }
  pending.resolve();
  expect(await outcome).toEqual(
    expect.objectContaining({ message: expect.stringContaining('account changed') }),
  );
  expect(signOut).not.toHaveBeenCalled();
  expect(mockFirebaseAuth.currentUser).toEqual(nextUid ? { uid: nextUid } : null);
  expect(clearUserScopedStorage).toHaveBeenCalledWith(
    { uid: initialUid, schoolId: null },
    expect.any(Function),
  );
  expect(clearMockAuthSession).toHaveBeenCalledTimes(1);
  expect(clearPUSession).not.toHaveBeenCalled();
  expect(clearPUCache).not.toHaveBeenCalled();
  expect(puCacheClearAll).not.toHaveBeenCalled();
  expect(setInMemoryPostLoginContext).not.toHaveBeenCalled();
  expect(mockEndReminderCleanup).toHaveBeenCalledTimes(1);
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
  expect(clearOwnedPuCampusSessions).toHaveBeenCalled();
  expect(mockBeginReminderCleanup).toHaveBeenCalledTimes(1);
  expect(mockEndReminderCleanup).toHaveBeenCalledTimes(1);
  expect(mockBeginPlanCleanup).toHaveBeenCalledTimes(1);
  expect(mockEndPlanCleanup).toHaveBeenCalledTimes(1);
  expect(mockFirebaseAuth.currentUser).toBeNull();
});

test('clears campus sessions before Firebase sign-out', async () => {
  const order: string[] = [];
  jest.mocked(clearOwnedPuCampusSessions).mockImplementation(async () => {
    order.push('clear');
  });
  jest.mocked(signOut).mockImplementation(async () => {
    order.push('signOut');
    mockFirebaseAuth.currentUser = null;
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => undefined);
  await act(async () => auth.signOut('u1'));
  expect(order).toEqual(['clear', 'signOut']);
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

test('sign-out waits for pending saved-plan writes to be fenced and removed', async () => {
  const pending = deferred();
  mockBeginPlanCleanup.mockReturnValueOnce(pending.promise);
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => undefined);
  const outcome = auth.signOut('u1');
  expect(mockBeginPlanCleanup).toHaveBeenCalledTimes(1);
  expect(signOut).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await outcome; });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(mockEndPlanCleanup).toHaveBeenCalledTimes(1);
});

test('saved-plan cleanup failure reports incomplete cleanup and releases its fence', async () => {
  mockBeginPlanCleanup.mockRejectedValueOnce(new Error('Unable to remove saved plans'));
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => undefined);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await act(async () => auth.signOut('u1'));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledWith('[auth] Some cleanup operations failed:',
    expect.arrayContaining([expect.objectContaining({ message: 'Unable to remove saved plans' })]));
  expect(mockEndPlanCleanup).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

test('sign-out immediately rejects an in-flight raw AI read while cleanup is still pending', async () => {
  const cleanup = deferred();
  jest.mocked(clearAllCache).mockReturnValueOnce(cleanup.promise);
  let finishRead!: (value: Awaited<ReturnType<typeof getAnyCachedTCTodos>>) => void;
  jest.mocked(getAnyCachedTCTodos).mockImplementationOnce(() => new Promise((resolve) => {
    finishRead = resolve;
  }));
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => undefined);
  const requester = mockFirebaseAuth.currentUser;
  const context: PostLoginContext = {
    uid: 'u1', schoolId: 'pu', origin: 'verified-school-login',
    roles: {
      primaryRole: 'student', subRoles: [], source: 'firestore',
      flags: { isStudent: true, isTeacher: false, isDeptAdmin: false, isAdmin: false },
    },
    latestAnnouncements: [], partialErrors: [], builtAt: new Date().toISOString(),
  };
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  bindVerifiedSchoolAiScope(context, () => {
    if (mockFirebaseAuth.currentUser !== requester) throw new Error('account changed');
  });
  const identity = { userId: 'u1', schoolId: 'pu' };
  const scope = getVerifiedSchoolAiScope(identity)!;
  const read = executeSmartAction('query_assignments', identity);
  const signingOut = auth.signOut('u1');

  expect(mockFirebaseAuth.currentUser).toBe(requester);
  expect(signOut).not.toHaveBeenCalled();
  expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
  finishRead([{
    id: 8, course_id: 3, title: '登出前的私人作業', type: 'homework', status: 'pending',
    description: null, start_time: null, end_time: null, score: null, total_score: null,
    weight: null, score_percentage: null, published: true,
  }]);
  const result = await read;
  expect(result).toMatchObject({ success: false, title: '學校資料尚未就緒' });
  expect(JSON.stringify(result)).not.toContain('登出前的私人作業');
  expect(signOut).not.toHaveBeenCalled();

  await act(async () => { cleanup.resolve(); await signingOut; });
  expect(signOut).toHaveBeenCalledTimes(1);
});
