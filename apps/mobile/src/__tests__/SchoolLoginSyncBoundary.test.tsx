import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import Constants from 'expo-constants';
import { signInWithCustomToken, signOut, type User } from 'firebase/auth';
import { getDoc, getDocs } from 'firebase/firestore';
import { AuthProvider, useAuth } from '../state/auth';
import { SchoolSessionBoundary } from '../app/SchoolSessionBoundary';
import { rootNavigateNested } from '../app/rootNavigation';
import { SSOLoginScreen } from '../screens/SSOLoginScreen';
import { SchoolLoginSyncNotice } from '../components/SchoolLoginSyncNotice';
import { clearPUSession } from '../services/studentIdAuth';
import { clearPUCache, syncAllData, type SyncAllResult } from '../services/puDataCache';
import { buildSchoolSyncSummary } from '../services/schoolSyncSummary';
import {
  beginSchoolLoginSync,
  completeSchoolLoginSync,
  getSchoolLoginSyncSnapshot,
  interruptSchoolLoginSync,
  updateSchoolLoginSync,
} from '../services/schoolLoginSync';

let mockAuthCallback: ((user: User | null) => Promise<void>) | null = null;
let mockTokenCallback: ((user: User | null, error: Error | null) => void) | null = null;
const mockFirebaseAuth: { currentUser: User | null } = { currentUser: null };
let mockSchool = { id: 'pu', name: '靜宜大學' };
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;

jest.mock('../firebase', () => ({
  getAuthInstance: () => mockFirebaseAuth,
  getDb: () => ({}),
  hasUsableFirebaseConfig: () => true,
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
  signInWithCustomToken: jest.fn(),
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
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool }),
  useOptionalSchool: () => ({ selection: { schoolId: mockSchool.id } }),
}));
jest.mock('../services/schoolLoginAvailability', () => ({
  isStudentIdLoginAvailable: (schoolId: string) => schoolId === 'pu',
  isSchoolLoginEntryAvailable: (schoolId: string) => schoolId === 'pu',
  loadSchoolLoginProviderKinds: async () => ['school-issued'],
}));
jest.mock('../services/cloudFunctions', () => ({
  getCloudFunctionUrl: () => 'https://nuni.tw/api/fn/signInPuStudentId',
  canUseHostedSchoolFallback: () => true,
}));
jest.mock('../services/puDataCache', () => ({
  syncAllData: jest.fn(),
  clearPUCache: jest.fn(async () => undefined),
  seedCachedCourses: jest.fn(async () => undefined),
  seedCachedGrades: jest.fn(async () => undefined),
  seedCachedStudentInfo: jest.fn(async () => undefined),
  seedCachedAnnouncements: jest.fn(async () => undefined),
  getAnyCachedCourses: async () => null,
  getAnyCachedTCCourses: async () => null,
  getAnyCachedAnnouncements: async () => null,
}));
jest.mock('../services/puDirectScraper', () => ({ puLogin: jest.fn() }));
jest.mock('../services/tronClassClient', () => ({
  setTCSavedCredentials: async () => undefined,
  setTCBackendSession: async () => undefined,
  clearTCSavedCredentials: async () => undefined,
  clearTCSession: async () => undefined,
  purgeLegacyTCSensitiveStorage: async () => undefined,
}));
jest.mock('../data/apiAdapters', () => ({ getAdapter: async () => null }));
jest.mock('../data/apiAdapters/PUAdapter', () => ({ PUAdapter: class {} }));
jest.mock('../services/mockAuth', () => ({
  loadMockAuthSession: async () => null,
  clearMockAuthSession: async () => undefined,
  saveMockAuthSession: jest.fn(),
}));
jest.mock('../services/testSeedData', () => ({ seedTestData: jest.fn() }));
jest.mock('../services/postLoginContextFromCaches', () => ({
  syncPostLoginContextFromCaches: async () => undefined,
}));
jest.mock('../services/postLoginDataRouter', () => ({
  routePostLoginData: async () => ({ roleInference: { inferredRole: 'student' } }),
  routePostLoginDataWithContext: async () => undefined,
}));
jest.mock('../data/postLoginDataRouter', () => ({ buildPostLoginContext: async () => null }));
jest.mock('../services/postLoginContextHolder', () => ({ setInMemoryPostLoginContext: jest.fn() }));
jest.mock('../data/cachedSource', () => ({ clearAllCache: async () => undefined }));
jest.mock('../services/offline', () => ({
  clearAllOfflineData: async () => undefined,
  getOfflineQueue: async () => [],
}));
jest.mock('../services/notifications', () => ({
  getCachedPushToken: async () => null,
  removePushTokenFromFirestore: async () => undefined,
}));
jest.mock('../services/scopedStorage', () => ({ clearUserScopedStorage: async () => undefined }));
jest.mock('../data/puDataCache', () => ({ puCacheClearAll: async () => undefined }));
jest.mock('../services/campusAssignmentReminders', () => ({
  beginCampusAssignmentReminderSignOutCleanup: async () => 0,
  endCampusAssignmentReminderSignOutCleanup: () => undefined,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 80,
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
}));
jest.mock('../components/SchoolPortalImport', () => ({ SchoolPortalImportEntry: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let auth: ReturnType<typeof useAuth>;
const firebaseUser = (uid = 'school-a') => ({ uid, email: `${uid}@example.test` }) as User;
const loginPayload = {
  success: true,
  uid: 'school-a',
  customToken: 'verified-custom-token',
  studentId: '412345678',
  displayName: '同學',
  department: '資訊工程學系',
  puSessionId: 'portal-session',
  tronClassSessionId: null,
  studentInfo: null,
  courses: null,
  grades: null,
  announcements: null,
};

function syncedResult(): SyncAllResult {
  return {
    courses: { courses: Array.from({ length: 6 }, () => ({ name: 'private-course-name' })) },
    grades: { grades: Array.from({ length: 28 }, () => ({ courseName: 'private-grade-name' })) },
    creditAudit: null,
    tcCourses: null,
  } as SyncAllResult;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe() {
  auth = useAuth();
  return null;
}

function App() {
  return (
    <AuthProvider>
      <Probe />
      <SchoolSessionBoundary publicContent={<SSOLoginScreen />}>
        <Text testID="private-home">校園首頁</Text>
        <SchoolLoginSyncNotice />
      </SchoolSessionBoundary>
    </AuthProvider>
  );
}

async function emitAuth(user: User | null) {
  mockFirebaseAuth.currentUser = user;
  await act(async () => {
    await mockAuthCallback!(user);
  });
}

async function beginSlowLogin() {
  const pending = deferred<SyncAllResult>();
  jest.mocked(syncAllData).mockReturnValueOnce(pending.promise);
  const view = render(<App />);
  await emitAuth(null);
  fireEvent.changeText(view.getByTestId('student-id-input'), '412345678');
  fireEvent.changeText(view.getByTestId('student-password-input'), 'private-school-password');
  fireEvent.press(view.getByText('使用學號登入'));
  await view.findByTestId('private-home');
  await waitFor(() => expect(syncAllData).toHaveBeenCalledTimes(1));
  return { view, pending };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPUSession();
  mockAuthCallback = null;
  mockTokenCallback = null;
  mockFirebaseAuth.currentUser = null;
  mockSchool = { id: 'pu', name: '靜宜大學' };
  Object.assign(Constants.expoConfig!, {
    extra: { appEnv: 'production', allowLocalMockAuth: false, tronClassDataEnabled: true },
  });
  jest.mocked(syncAllData).mockReset();
  jest.mocked(clearPUCache).mockReset().mockResolvedValue(undefined);
  jest.mocked(signInWithCustomToken).mockImplementation(async () => {
    const user = firebaseUser();
    mockFirebaseAuth.currentUser = user;
    // Profile authentication completes while the school data request is still pending.
    await mockAuthCallback!(user);
    return { user } as never;
  });
  jest.mocked(signOut).mockImplementation(async () => {
    mockFirebaseAuth.currentUser = null;
    await mockAuthCallback!(null);
  });
  jest.mocked(getDoc).mockImplementation(async (ref) => {
    const data = ref.path.startsWith('users/')
      ? { role: 'student', primarySchoolId: 'pu', displayName: '同學' }
      : { status: 'active', role: 'member' };
    return { exists: () => true, data: () => data } as never;
  });
  jest.mocked(getDocs).mockResolvedValue({ empty: true, docs: [] } as never);
  mockFetch.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(loginPayload),
  });
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  act(() => clearPUSession());
  globalThis.fetch = originalFetch;
});

test('real auth switching unmounts login without losing pending progress or the final source receipt', async () => {
  const { view, pending } = await beginSlowLogin();
  expect(view.queryByTestId('student-id-input')).toBeNull();
  expect(view.getByText('本次登入同步中')).toBeTruthy();
  expect(view.queryByText('已讀取 6 筆上課紀錄')).toBeNull();

  fireEvent.press(view.getByLabelText('收起學校資料同步結果'));
  await act(async () => {
    pending.resolve(syncedResult());
  });
  await view.findByText('本次登入同步尚有缺項');
  expect(view.queryByText('已讀取 6 筆上課紀錄')).toBeNull();
  fireEvent.press(view.getByLabelText('展開學校資料同步結果'));
  expect(view.getByText('已讀取 6 筆上課紀錄')).toBeTruthy();
  expect(view.getByText('已讀取 28 筆成績')).toBeTruthy();
  expect(view.getByText('尚未取得，請重新連線後再試')).toBeTruthy();
  expect(view.getByText('可依修課紀錄試算，尚未取得校方完整畢業審核')).toBeTruthy();
  expect(view.getByText('校方學分累計請到學分頁讀取。')).toBeTruthy();
  expect(view.getByText(/這是本次登入同步的範圍；各頁另行更新的結果請到該頁查看/)).toBeTruthy();
  expect(view.getByTestId('private-home')).toBeTruthy();
  expect(signOut).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(1);

  for (const [label, route] of [
    ['查看課表', 'PersonalTimetable'],
    ['查看成績', 'Grades'],
    ['查看學分', 'CreditAuditStack'],
    ['查看課程', 'CoursesHome'],
  ]) {
    fireEvent.press(view.getByRole('button', { name: label }));
    expect(rootNavigateNested).toHaveBeenLastCalledWith(
      '學習', route, route === 'CreditAuditStack' ? { screen: 'CreditAudit' } : undefined,
    );
  }
  expect(JSON.stringify(getSchoolLoginSyncSnapshot())).not.toMatch(
    /private-school-password|verified-custom-token|portal-session|private-course-name|private-grade-name/,
  );
});

test('sign out clears the receipt and a late school response cannot restore it', async () => {
  const { view, pending } = await beginSlowLogin();
  await act(async () => {
    await auth.signOut('school-a');
  });
  expect(view.queryByTestId('private-home')).toBeNull();
  expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
  expect(getSchoolLoginSyncSnapshot()).toBeNull();
  await act(async () => {
    pending.resolve(syncedResult());
  });
  expect(getSchoolLoginSyncSnapshot()).toBeNull();
  expect(view.getByTestId('student-id-input')).toBeTruthy();
});

test.each(['school-b', 'school-a'])(
  'a new Firebase principal (%s) invalidates the previous receipt, including a same-UID re-login',
  async (uid) => {
    const { view, pending } = await beginSlowLogin();
    const nextUser = firebaseUser(uid);
    await emitAuth(nextUser);
    expect(view.getByTestId('private-home')).toBeTruthy();
    expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
    expect(getSchoolLoginSyncSnapshot()).toBeNull();

    let nextAttempt: ReturnType<typeof beginSchoolLoginSync>;
    act(() => {
      nextAttempt = beginSchoolLoginSync(nextUser, 'pu');
    });
    await act(async () => {
      pending.resolve(syncedResult());
    });
    expect(getSchoolLoginSyncSnapshot()).toMatchObject({
      attempt: nextAttempt!,
      status: 'syncing',
    });
    expect(view.getByText('本次登入同步中')).toBeTruthy();
    act(() => completeSchoolLoginSync(nextAttempt!, buildSchoolSyncSummary(null, true)));
    expect(view.queryByText('已讀取 6 筆上課紀錄')).toBeNull();
  },
);

test('leaving the school invalidates pending results even after returning to the same school', async () => {
  const { view, pending } = await beginSlowLogin();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<App />);
  expect(getSchoolLoginSyncSnapshot()).toBeNull();
  expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
  await act(async () => {
    pending.resolve(syncedResult());
  });
  mockSchool = { id: 'pu', name: '靜宜大學' };
  view.rerender(<App />);
  expect(view.getByTestId('private-home')).toBeTruthy();
  expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
});

test('expired authentication discards the pending receipt before an old request completes', async () => {
  const { view, pending } = await beginSlowLogin();
  act(() => mockTokenCallback!(mockFirebaseAuth.currentUser, new Error('TOKEN_REFRESH_EXHAUSTED')));
  expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
  expect(getSchoolLoginSyncSnapshot()).toBeNull();
  await act(async () => {
    pending.resolve(syncedResult());
  });
  act(() => mockTokenCallback!(mockFirebaseAuth.currentUser, null));
  expect(view.queryByTestId('school-login-sync-notice')).toBeNull();
});

test('a post-authentication interruption preserves access to the app and exposes recovery destinations', async () => {
  jest.mocked(clearPUCache).mockRejectedValueOnce(new Error('device cache unavailable'));
  const view = render(<App />);
  await emitAuth(null);
  fireEvent.changeText(view.getByTestId('student-id-input'), '412345678');
  fireEvent.changeText(view.getByTestId('student-password-input'), 'private-school-password');
  fireEvent.press(view.getByText('使用學號登入'));
  await view.findByText('這次同步未完成，可到各項課務頁重新讀取。');
  expect(view.getByTestId('private-home')).toBeTruthy();
  expect(getSchoolLoginSyncSnapshot()?.status).toBe('interrupted');
  fireEvent.press(view.getByText('查看成績'));
  expect(rootNavigateNested).toHaveBeenLastCalledWith('學習', 'Grades', undefined);
  fireEvent.press(view.getByText('查看學分'));
  expect(rootNavigateNested).toHaveBeenLastCalledWith('學習', 'CreditAuditStack', { screen: 'CreditAudit' });
  expect(signOut).not.toHaveBeenCalled();
});

test('a newer sync attempt owns progress, and disabled learning data does not promise a retry', async () => {
  const view = render(<App />);
  const user = firebaseUser();
  await emitAuth(user);
  let oldAttempt: ReturnType<typeof beginSchoolLoginSync>;
  let nextAttempt: ReturnType<typeof beginSchoolLoginSync>;
  act(() => {
    oldAttempt = beginSchoolLoginSync(user, 'pu');
    nextAttempt = beginSchoolLoginSync(user, 'pu');
    completeSchoolLoginSync(oldAttempt, buildSchoolSyncSummary(syncedResult(), true));
    interruptSchoolLoginSync(oldAttempt);
    updateSchoolLoginSync(oldAttempt, 'finishing');
  });
  expect(getSchoolLoginSyncSnapshot()).toMatchObject({
    attempt: nextAttempt!,
    status: 'syncing',
    phase: 'campus',
  });
  act(() => completeSchoolLoginSync(nextAttempt!, buildSchoolSyncSummary(syncedResult(), false)));
  expect(view.getByText('此版本尚未開啟課程平台連線')).toBeTruthy();
  expect(view.queryByRole('button', { name: '查看課程' })).toBeNull();
});
