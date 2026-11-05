import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { PU_ECAMPUS_DATA_PAUSED_MESSAGE } from '@campus/shared/src/puEcampusDataPolicy';
import {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchCreditAudit,
  puFetchStudentInfo,
  puFetchAnnouncements,
  puFetchAbsence,
  puFetchCreditSummary,
  puFetchDetailedAnnouncements,
} from '../../services/puDirectScraper';
import {
  getAnyCachedGrades,
  getLastSyncTime,
  refreshCourses,
  refreshGrades,
  refreshAnnouncements,
  refreshStudentInfo,
  refreshCreditAudit,
  refreshTCCourses,
  seedCachedGrades,
  syncAllData,
} from '../../services/puDataCache';
import { loadOwnedSchoolCourses, loadOwnedSchoolGrades } from '../../services/ownedSchoolAcademicRecords';
import { queryCatalog, fetchOfferClass, fetchOfferUnit } from '../../services/courseCatalogClient';
import { CATALOG_DEFAULT_FILTER } from '../../data/courseCatalogConstants';
import { PUAdapter } from '../../data/apiAdapters/PUAdapter';
import { signInWithStudentId, getPUSession } from '../../services/studentIdAuth';
import { tryCallFinalizePostLogin } from '../../services/finalizePostLoginClient';
import { tcFetchCourses } from '../../services/tronClassClient';

const mockRequester = { uid: 'student-a', getIdToken: jest.fn(async () => 'fixture-token') };
const mockAuth = { currentUser: mockRequester };
const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;

jest.mock('../../firebase', () => ({
  getAuthInstance: () => mockAuth,
  hasUsableFirebaseConfig: () => true,
  isFirebaseMockMode: () => false,
  getFunctionsInstance: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: async () => ({ Authorization: 'Bearer fixture-token' }),
  canUseHostedSchoolFallback: () => true,
}));
jest.mock('../../services/tronClassClient', () => ({
  getTCBackendSessionId: jest.fn(async () => 'lms-session'),
  tcFetchCourses: jest.fn(async () => []),
}));
jest.mock('../../services/testSeedData', () => ({ isTestAccount: () => false, seedTestData: jest.fn() }));
jest.mock('../../services/postLoginContextFromCaches', () => ({}));
jest.mock('../../services/postLoginDataRouter', () => ({}));
jest.mock('../../data/apiAdapters', () => ({ getAdapter: jest.fn() }));

const directSession = { loggedIn: true as const, studentName: '測試同學' };
const backendSession = { ...directSession, backendSessionId: 'existing-session', backendOwnerUid: 'student-a' };

beforeEach(async () => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  await AsyncStorage.clear();
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: { releasedSchoolIds: ['pu'], features: { enabled: true, sso: true } },
    },
  });
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('native login and every personal-data scraper stop before the first network request', async () => {
  const results = await Promise.all([
    puLogin('412345678', 'fixture-password'),
    puFetchCourses(directSession),
    puFetchGrades(directSession),
    puFetchCreditAudit(directSession),
    puFetchStudentInfo(directSession),
    puFetchAnnouncements(directSession),
    puFetchAbsence(directSession),
    puFetchCreditSummary(directSession),
    puFetchDetailedAnnouncements(directSession),
  ]);
  for (const result of results) {
    expect(result).toMatchObject({ success: false, error: PU_ECAMPUS_DATA_PAUSED_MESSAGE });
  }
});

test('owner-selected data cannot delegate a refresh to an older backend', async () => {
  await expect(loadOwnedSchoolCourses('student-a')).rejects.toThrow(PU_ECAMPUS_DATA_PAUSED_MESSAGE);
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow(PU_ECAMPUS_DATA_PAUSED_MESSAGE);
  expect(mockRequester.getIdToken).not.toHaveBeenCalled();
});

test.each([directSession, backendSession])('all refresh paths preserve stored grades while paused: %j', async (session) => {
  const grades = { grades: [], allSemesters: ['1151'], summary: {} };
  await seedCachedGrades(grades);
  const before = await AsyncStorage.getItem('puCache:v1:pu:grades');
  const results = await Promise.all([
    refreshCourses(session), refreshGrades(session), refreshAnnouncements(session),
    refreshStudentInfo(session), refreshCreditAudit(session),
  ]);
  expect(results).toEqual([null, null, null, null, null]);
  await syncAllData(session, { includeEssential: true, fetchTronClass: false });
  expect(await getAnyCachedGrades()).toEqual(grades);
  expect(await AsyncStorage.getItem('puCache:v1:pu:grades')).toBe(before);
  expect(await getLastSyncTime()).toBeNull();
});

test('adapter authentication, legacy proxy and health checks also stop for restored sessions', async () => {
  for (const backend of [false, true]) {
    const adapter = new PUAdapter();
    if (backend) adapter.setBackendSession('existing-session', '412345678', '測試同學', 'student-a');
    await expect(adapter.authenticate('412345678', 'fixture-password')).rejects.toThrow(PU_ECAMPUS_DATA_PAUSED_MESSAGE);
    expect(await adapter.listAnnouncements()).toEqual([]);
    expect(await adapter.isHealthy()).toBe(false);
  }
});

test('forced catalog refresh keeps an old local snapshot and does not warm cookies or fetch tokens', async () => {
  const filter = { ...CATALOG_DEFAULT_FILTER, semester: '1151' };
  const snapshot = {
    filter,
    courses: [{ code: 'CS101', name: '資料庫' }],
    totalCount: 1,
    source: 'live',
    fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    showRemain: false,
  };
  const key = `@course_catalog:v3:pu:${JSON.stringify(filter)}`;
  await AsyncStorage.setItem(key, JSON.stringify(snapshot));
  expect(await queryCatalog(filter, { schoolId: 'pu', forceRefresh: true })).toMatchObject({
    courses: snapshot.courses,
    fetchedAt: snapshot.fetchedAt,
    source: 'cache',
    error: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
  });
  expect(await fetchOfferUnit('1151')).toEqual([]);
  expect(await fetchOfferClass('1151', 'CS')).toEqual([]);
  expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(snapshot));
});

test('campus sign-in and post-login bootstrap do not clear stored data or call older servers', async () => {
  await AsyncStorage.setItem('puCache:v1:pu:grades', 'existing-data');
  const sessionBefore = getPUSession();
  await expect(signInWithStudentId({
    schoolId: 'pu', studentId: '412345678', password: 'fixture-password',
  })).rejects.toThrow(PU_ECAMPUS_DATA_PAUSED_MESSAGE);
  expect(await tryCallFinalizePostLogin()).toMatchObject({
    success: false, errorMessage: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
  });
  expect(getPUSession()).toBe(sessionBefore);
  expect(await AsyncStorage.getItem('puCache:v1:pu:grades')).toBe('existing-data');
});

test('the independent TronClass course path remains available with its existing session', async () => {
  await expect(refreshTCCourses()).resolves.toEqual([]);
  expect(tcFetchCourses).toHaveBeenCalledWith('ongoing');
});
