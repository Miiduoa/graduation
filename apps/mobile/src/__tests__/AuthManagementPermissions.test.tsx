import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { User } from 'firebase/auth';
import { getDoc, getDocs } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPostLoginContext } from '../data/postLoginDataRouter';
import { getInMemoryPostLoginContext, setInMemoryPostLoginContext } from '../services/postLoginContextHolder';
import { getAnyCachedAnnouncements, getAnyCachedCourses, getAnyCachedTCCourses } from '../services/puDataCache';
import type { PostLoginContext } from '../data/postLoginTypes';
import { AuthProvider, useAuth } from '../state/auth';
import { SchoolProvider, useSchool } from '../state/school';
import { executeSmartAction } from '../services/aiSmartActions';
import { loadMockAuthSession } from '../services/mockAuth';
import { getVerifiedSchoolAiScope, isVerifiedSchoolAiScopeCurrent, revokeVerifiedSchoolAiScope } from '../services/verifiedSchoolAiScope';

let mockAuthCallback: ((user: User | null) => Promise<void>) | null = null;
let mockHasFirebaseConfig = true;
let mockTokenCallback: (user: User | null, error: Error | null) => void;
const mockFirebaseAuth: { currentUser: User | null } = { currentUser: null };
jest.mock('../firebase', () => ({
  getAuthInstance: () => mockFirebaseAuth,
  getDb: () => ({}),
  hasUsableFirebaseConfig: () => mockHasFirebaseConfig,
  subscribeToTokenRefresh: (callback: typeof mockTokenCallback) => {
    mockTokenCallback = callback;
    return () => undefined;
  },
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: typeof mockAuthCallback) => {
    mockAuthCallback = callback;
    return () => undefined;
  },
  signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collectionGroup: jest.fn(),
  documentId: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('../data/postLoginDataRouter', () => ({
  getPostLoginContext: jest.fn(async () => null), buildPostLoginContext: jest.fn(async () => null),
}));
jest.mock('../data/cachedSource', () => ({
  clearAllCache: jest.fn(),
  clearCacheExceptSchool: jest.fn(async () => undefined),
}));
jest.mock('../data/hybridSource', () => ({ setHybridSourceSchoolContext: jest.fn() }));
jest.mock('../ui/theme', () => ({ registerSchoolTheme: jest.fn(), applySchoolTheme: jest.fn(), clearSchoolTheme: jest.fn() }));
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
  loadMockAuthSession: jest.fn(),
}));
jest.mock('../services/scopedStorage', () => ({ clearUserScopedStorage: jest.fn() }));
jest.mock('../data/puDataCache', () => ({ puCacheClearAll: jest.fn() }));
jest.mock('../services/puDataCache', () => ({
  clearPUCache: jest.fn(),
  getAnyCachedAnnouncements: jest.fn(async () => null),
  getAnyCachedCourses: jest.fn(async () => null),
  getAnyCachedTCCourses: jest.fn(async () => null),
}));
jest.mock('../services/postLoginContextHolder', () => ({ getInMemoryPostLoginContext: jest.fn(() => null), setInMemoryPostLoginContext: jest.fn() }));
jest.mock('../services/supabaseLmsCache', () => ({
  getAnyCachedTCActivities: jest.fn(async () => null),
  getAnyCachedTCTodos: jest.fn(async () => null),
  getAnyCachedTCCourses: jest.fn(async () => null),
}));
jest.mock('../services/studentIdAuth', () => ({
  clearPUSession: jest.fn(),
  captureSchoolSessionAssertion: () => () => undefined,
}));
jest.mock('../services/clearOwnedPuCampusSessions', () => ({
  clearOwnedPuCampusSessions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/tronClassClient', () => ({
  clearTCSession: jest.fn(),
  purgeLegacyTCSensitiveStorage: async () => undefined,
}));

let auth: ReturnType<typeof useAuth>;
let school: ReturnType<typeof useSchool>;
let records: Map<string, Record<string, unknown>>;
const membershipPath = 'schools/pu/members/u1';
const servicePath = 'schools/pu/serviceRoles/u1';
const firebaseUser = (uid = 'u1') => ({ uid, email: `${uid}@example.test` }) as User;

function Probe() {
  auth = useAuth();
  return null;
}

function SchoolProbe() {
  school = useSchool();
  return null;
}

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: () => data !== undefined, data: () => data };
}

function mountProvider(initialSchoolId: string | null = 'pu') {
  return render(
    <SchoolProvider initial={{ schoolId: initialSchoolId }}>
      <SchoolProbe />
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </SchoolProvider>,
  );
}

async function signIn(uid = 'u1') {
  const user = firebaseUser(uid);
  mockFirebaseAuth.currentUser = user;
  await act(async () => {
    await mockAuthCallback!(user);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  revokeVerifiedSchoolAiScope();
  let held: PostLoginContext | null = null;
  jest.mocked(getPostLoginContext).mockReset().mockResolvedValue(null);
  jest.mocked(getInMemoryPostLoginContext).mockImplementation(() => held);
  jest.mocked(setInMemoryPostLoginContext).mockImplementation((ctx) => { held = ctx; });
  await AsyncStorage.clear();
  mockAuthCallback = null;
  mockHasFirebaseConfig = true;
  mockFirebaseAuth.currentUser = null;
  records = new Map([
    ['users/u1', { role: 'student', primarySchoolId: 'pu', displayName: '同學' }],
  ]);
  jest.mocked(loadMockAuthSession).mockResolvedValue(null);
  jest.mocked(getDoc).mockImplementation(async (ref) => snapshot(records.get(ref.path)) as never);
  jest.mocked(getDocs).mockResolvedValue({ empty: true, docs: [] } as never);
});

test.each([
  ['admin', 'admin'],
  ['teacher', 'teacher'],
  ['professor', 'teacher'],
  ['principal', 'department_head'],
] as const)(
  'profile identity %s cannot grant school management without an assignment',
  async (role, roleGroup) => {
    records.set('users/u1', { role, primarySchoolId: 'pu' });
    mountProvider();
    await signIn();
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false, loading: false });
    expect(auth.profile).toMatchObject({ role, roleGroup, schoolMembershipRole: null });
  },
);

test.each(['admin', 'teacher', 'professor', 'principal'])(
  'a member assignment cannot be upgraded by a stale %s profile',
  async (role) => {
    records.set('users/u1', { role, primarySchoolId: 'pu' });
    records.set(membershipPath, { role: 'member', status: 'active' });
    mountProvider();
    await signIn();
    expect(auth.isAdmin).toBe(false);
    expect(auth.isEditor).toBe(false);
    expect(auth.profile?.schoolMembershipRole).toBe('member');
  },
);

test.each([
  ['admin', true, true],
  ['editor', false, true],
] as const)(
  'an active school %s assignment enables only its management scope',
  async (role, isAdmin, isEditor) => {
    records.set(membershipPath, { role, status: 'active' });
    mountProvider();
    await signIn();
    expect(auth).toMatchObject({ isAdmin, isEditor });
    expect(auth.profile).toMatchObject({
      role: 'student',
      roleGroup: 'student',
      schoolMembershipRole: role,
    });
  },
);

test.each(['inactive', 'pending', undefined])(
  'a membership with status %s cannot grant management',
  async (status) => {
    records.set('users/u1', { role: 'admin', primarySchoolId: 'pu' });
    records.set(membershipPath, { role: 'admin', status });
    records.set(servicePath, { status: 'active', health: true });
    mountProvider();
    await signIn();
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
    expect(auth.profile).toMatchObject({ schoolMembershipRole: null, serviceRoles: [] });
  },
);

test('an active assignment in another school does not grant management of the selected school', async () => {
  records.set('users/u1', { role: 'admin', primarySchoolId: 'pu', schoolId: 'other' });
  records.set('schools/other/members/u1', { role: 'admin', status: 'active' });
  mountProvider();
  await signIn();
  expect(auth.profile).toMatchObject({ schoolId: 'pu', schoolMembershipRole: null });
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
});

test('a membership with conflicting school provenance cannot grant management', async () => {
  records.set(membershipPath, { role: 'admin', status: 'active', schoolId: 'other' });
  mountProvider();
  await signIn();
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
});

test('unreadable membership data cannot fall back to a profile admin role', async () => {
  records.set('users/u1', { role: 'admin', primarySchoolId: 'pu' });
  jest.mocked(getDoc).mockImplementation(async (ref) => {
    if (ref.path === membershipPath) throw new Error('permission-denied');
    return snapshot(records.get(ref.path)) as never;
  });
  mountProvider();
  await signIn();
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
  expect(auth.profile?.schoolMembershipRole).toBeNull();
});

test('service assignments use the active boolean-domain schema without granting school management', async () => {
  records.set(membershipPath, { role: 'member', status: 'active' });
  records.set(servicePath, {
    status: 'active',
    packages: true,
    health: true,
    repairs: false,
    orders: 'true',
    roles: ['admin', 'merchant'],
  });
  mountProvider();
  await signIn();
  expect(auth.profile?.serviceRoles).toEqual(['packages', 'health']);
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
});

test.each([
  { status: 'inactive', health: true },
  { health: true },
  { status: 'active', schoolId: 'other', health: true },
  { status: 'active', roles: ['health', 'admin'] },
])(
  'inactive, unscoped, or legacy-array service records do not grant domain access: %j',
  async (assignment) => {
    records.set(membershipPath, { role: 'member', status: 'active' });
    records.set(servicePath, assignment);
    mountProvider();
    await signIn();
    expect(auth.profile?.serviceRoles).toEqual([]);
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
  },
);

test('refreshing a revoked assignment removes management while preserving teacher identity', async () => {
  records.set('users/u1', { role: 'teacher', primarySchoolId: 'pu' });
  records.set(membershipPath, { role: 'editor', status: 'active' });
  mountProvider();
  await signIn();
  expect(auth.isEditor).toBe(true);
  records.set(membershipPath, { role: 'editor', status: 'inactive' });
  await act(async () => auth.refreshProfile());
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
  expect(auth.profile).toMatchObject({
    role: 'teacher',
    roleGroup: 'teacher',
    schoolMembershipRole: null,
  });
});

test('a failed profile refresh clears previously verified management authority', async () => {
  records.set(membershipPath, { role: 'admin', status: 'active' });
  mountProvider();
  await signIn();
  expect(auth.isAdmin).toBe(true);
  jest.mocked(getDoc).mockRejectedValue(new Error('network unavailable'));
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await act(async () => auth.refreshProfile());
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
    expect(auth.profile).toMatchObject({
      uid: 'u1',
      role: 'student',
      schoolMembershipRole: null,
      serviceRoles: [],
    });
  } finally {
    quiet.mockRestore();
  }
});

test('an account switch cannot inherit the previous account management flags while its profile loads', async () => {
  records.set(membershipPath, { role: 'admin', status: 'active' });
  mountProvider();
  await signIn();
  expect(auth.isAdmin).toBe(true);
  let release!: (value: unknown) => void;
  const pendingProfile = new Promise((resolve) => {
    release = resolve;
  });
  jest.mocked(getDoc).mockImplementation(async (ref) => {
    if (ref.path === 'users/u2') return (await pendingProfile) as never;
    return snapshot(records.get(ref.path)) as never;
  });
  const nextUser = firebaseUser('u2');
  mockFirebaseAuth.currentUser = nextUser;
  let pendingSignIn!: Promise<void>;
  await act(async () => {
    pendingSignIn = mockAuthCallback!(nextUser);
    await Promise.resolve();
  });
  expect(auth.user?.uid).toBe('u2');
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false, profileLoading: true });
  await act(async () => {
    release(snapshot({ role: 'admin', primarySchoolId: 'pu' }));
    await pendingSignIn;
  });
  expect(auth.profile?.uid).toBe('u2');
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
});

test('the explicit development demo admin receives a mock school assignment without a production fallback', async () => {
  mockHasFirebaseConfig = false;
  jest.mocked(loadMockAuthSession).mockResolvedValue({
    uid: 'demo_admin',
    email: 'demo@example.test',
    schoolId: 'pu',
    displayName: '示範管理員',
    role: 'admin',
  });
  mountProvider();
  await act(async () => undefined);
  expect(auth).toMatchObject({ isAdmin: true, isEditor: true });
  expect(auth.profile?.schoolMembershipRole).toBe('admin');
  expect(getDoc).not.toHaveBeenCalled();
});

test.each(['admin', 'editor'])(
  'a verified school %s assignment follows the browsing scope without changing primary identity',
  async (role) => {
    records.set('users/u1', { role: 'teacher', primarySchoolId: 'pu' });
    records.set(membershipPath, { role, status: 'active' });
    records.set('schools/nthu/members/u1', { role: 'admin', status: 'active' });
    mountProvider();
    await signIn();
    expect(auth.isEditor).toBe(true);
    expect(auth.isAdmin).toBe(role === 'admin');
    expect(auth.profile?.schoolMembershipSchoolId).toBe('pu');

    await act(async () => school.setSelection({ code: 'NTHU', schoolId: 'nthu' }));
    expect(school.selection.schoolId).toBe('nthu');
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
    expect(auth.profile).toMatchObject({
      primarySchoolId: 'pu',
      schoolId: 'pu',
      role: 'teacher',
      roleGroup: 'teacher',
      schoolMembershipSchoolId: 'pu',
    });

    await act(async () => school.setSelection({ code: 'ALL', schoolId: null }));
    expect(school.selection.schoolId).toBeNull();
    expect(auth).toMatchObject({ isAdmin: false, isEditor: false });

    await act(async () => school.setSelection({ code: 'PU', schoolId: 'pu' }));
    expect(auth.isEditor).toBe(true);
    expect(auth.isAdmin).toBe(role === 'admin');
    expect(auth.profile?.primarySchoolId).toBe('pu');
  },
);

test('an assignment revoked while browsing another school is not restored when returning', async () => {
  records.set(membershipPath, { role: 'admin', status: 'active' });
  mountProvider();
  await signIn();
  expect(auth.isAdmin).toBe(true);
  await act(async () => school.setSelection({ code: 'NTHU', schoolId: 'nthu' }));
  records.set(membershipPath, { role: 'admin', status: 'inactive' });
  await act(async () => auth.refreshProfile());
  await act(async () => school.setSelection({ code: 'PU', schoolId: 'pu' }));
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
  expect(auth.profile?.schoolMembershipSchoolId).toBeNull();
});

test('a standalone AuthProvider has no implicit selected-school management scope', async () => {
  records.set(membershipPath, { role: 'admin', status: 'active' });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await signIn();
  expect(auth.profile).toMatchObject({
    schoolMembershipRole: 'admin',
    schoolMembershipSchoolId: 'pu',
  });
  expect(auth).toMatchObject({ isAdmin: false, isEditor: false });
});

const taggedContext = (uid: string, schoolId = 'pu') =>
  ({ uid, schoolId, origin: 'verified-school-login' } as PostLoginContext);

test.each([[null, 'pu'], ['nthu', 'pu'], ['nthu', 'nthu'], ['pu', 'nthu']])(
  'selection %s and account school %s cannot read or relabel the PU cache', async (selected, accountSchool) => {
    records.set('users/u1', { role: 'student', primarySchoolId: accountSchool });
    mountProvider(selected);
    await signIn();
    expect(getPostLoginContext).not.toHaveBeenCalled();
    expect(getAnyCachedCourses).not.toHaveBeenCalled();
    expect(getAnyCachedTCCourses).not.toHaveBeenCalled();
    expect(getAnyCachedAnnouncements).not.toHaveBeenCalled();
  },
);

test('only verified PU login contexts for the active Firebase owner are restored; leaving the scope clears memory', async () => {
  const ctx = taggedContext('u1');
  jest.mocked(getPostLoginContext).mockResolvedValue(ctx);
  const view = mountProvider();
  await signIn();
  expect(getInMemoryPostLoginContext()).toBe(ctx);
  const identity = { userId: 'u1', schoolId: 'pu' };
  const scope = getVerifiedSchoolAiScope(identity)!;
  expect(scope?.context).toBe(ctx);
  expect(await executeSmartAction('query_assignments', identity)).toMatchObject({ success: true });
  expect(getAnyCachedCourses).not.toHaveBeenCalled();
  await act(async () => school.setSelection({ schoolId: 'nthu' }));
  expect(getInMemoryPostLoginContext()).toBeNull();
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
  expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  expect(await executeSmartAction('query_assignments', identity)).toMatchObject({ success: false, title: '學校資料尚未就緒' });
  view.unmount();
});

test.each([taggedContext('old-account'), taggedContext('u1', 'nthu'), taggedContext('u1', 'tw-pu'), { uid: 'u1', schoolId: 'pu' }])(
  'unauthorized or pre-migration cached payloads do not become active context', async (ctx) => {
    jest.mocked(getPostLoginContext).mockResolvedValue(ctx as PostLoginContext);
    mountProvider();
    await signIn();
    expect(getPostLoginContext).toHaveBeenCalled();
    expect(getInMemoryPostLoginContext()).toBeNull();
    expect(getVerifiedSchoolAiScope({ userId: 'u1', schoolId: 'pu' })).toBeNull();
  },
);

test.each(['campus', 'account', 'unmount'])('a read completing after a change to %s never publishes', async (change) => {
  let resolve!: (ctx: PostLoginContext) => void;
  jest.mocked(getPostLoginContext).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = mountProvider();
  await signIn();
  if (change === 'campus') {
    await act(async () => school.setSelection({ schoolId: 'nthu' }));
    await act(async () => school.setSelection({ schoolId: 'pu' }));
  } else if (change === 'account') {
    await signIn('u2');
  } else {
    view.unmount();
  }
  await act(async () => resolve(taggedContext('u1')));
  expect(getInMemoryPostLoginContext()).toBeNull();
});

test('an expired restored login cannot bind AI scope', async () => {
  let resolve!: (ctx: PostLoginContext) => void;
  jest.mocked(getPostLoginContext).mockImplementation(() => new Promise((done) => { resolve = done; }));
  mountProvider();
  await signIn();
  await act(async () => mockTokenCallback(mockFirebaseAuth.currentUser, new Error('TOKEN_REFRESH_EXHAUSTED')));
  await act(async () => resolve(taggedContext('u1')));
  expect(auth.tokenExpired).toBe(true);
  expect(getInMemoryPostLoginContext()).toBeNull();
  expect(getVerifiedSchoolAiScope({ userId: 'u1', schoolId: 'pu' })).toBeNull();
});

test.each(['signout', 'account', 'expired'])(
  'a restored AI scope becomes unusable after %s', async (change) => {
    jest.mocked(getPostLoginContext).mockResolvedValue(taggedContext('u1'));
    mountProvider();
    await signIn();
    const identity = { userId: 'u1', schoolId: 'pu' };
    const scope = getVerifiedSchoolAiScope(identity)!;
    expect(scope).not.toBeNull();
    if (change === 'account') {
      await signIn('u2');
    } else if (change === 'expired') {
      await act(async () => mockTokenCallback(mockFirebaseAuth.currentUser, new Error('TOKEN_REFRESH_EXHAUSTED')));
    } else {
      mockFirebaseAuth.currentUser = null;
      await act(async () => mockAuthCallback!(null));
    }
    expect(getVerifiedSchoolAiScope(identity)).toBeNull();
    expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  },
);
