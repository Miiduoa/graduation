// Exercise the enabled parsing/ownership contract independently of the release pause.
jest.mock('@campus/shared/src/puEcampusDataPolicy', () => ({
  ...jest.requireActual('@campus/shared/src/puEcampusDataPolicy'),
  isPuEcampusDataFetchEnabled: () => true,
  assertPuEcampusDataFetchEnabled: () => {},
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPUCache,
  getAnyCachedCreditAudit,
  getAnyCachedGrades,
  getLastSyncTime,
  refreshCourses,
  refreshGrades,
  refreshCreditAudit,
  seedCachedCreditAudit,
  syncAllData,
} from '../../services/puDataCache';
import { puFetchCourses, puFetchGrades, puFetchCreditAudit } from '../../services/puDirectScraper';
import type { PuCreditAuditPayload } from '@campus/shared/src';

jest.mock('../../services/puDirectScraper', () => ({
  puFetchCourses: jest.fn(),
  puFetchGrades: jest.fn(),
  puFetchCreditAudit: jest.fn(),
  puFetchStudentInfo: jest.fn(async () => ({ success: false })),
  puFetchAnnouncements: jest.fn(async () => ({ success: false })),
}));
jest.mock('../../services/tronClassDataEnabled', () => ({
  isTronClassDataFetchEnabled: () => false,
}));
jest.mock('../../services/tronClassClient', () => ({}));
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));
const directSession = { loggedIn: true as const, studentName: '測試同學' };
const backendSession = { ...directSession, backendSessionId: 'owned-session' };
const audit = {
  version: 2,
  creditTotals: { subtotal: 30 },
  semesterGrades: [],
  fetchedAt: '2026-10-27T00:00:00Z',
} as unknown as PuCreditAuditPayload;
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(async () => {
  jest.clearAllMocks();
  globalThis.fetch = mockFetch;
  await clearPUCache();
  jest.mocked(puFetchCourses).mockResolvedValue({ success: false, data: null });
  jest.mocked(puFetchGrades).mockResolvedValue({ success: false, data: null });
  jest.mocked(puFetchCreditAudit).mockResolvedValue({ success: false, data: null });
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('credit audit writes a real cache key, can be read and is removed by logout', async () => {
  await seedCachedCreditAudit(audit);
  expect(await getAnyCachedCreditAudit()).toEqual(audit);
  expect(await AsyncStorage.getItem('puCache:v1:pu:creditAudit')).toContain('subtotal');
  await clearPUCache();
  expect(await getAnyCachedCreditAudit()).toBeNull();
});

test('successful direct grades and courses no longer throw undefined Firestore writers', async () => {
  const grades = { grades: [], allSemesters: [], summary: {} };
  const courses = { courses: [], studentInfo: {} as never, semester: '1151', totalCredits: 0 };
  jest.mocked(puFetchGrades).mockResolvedValue({ success: true, data: grades });
  jest.mocked(puFetchCourses).mockResolvedValue({ success: true, data: courses });
  await expect(refreshGrades(directSession)).resolves.toEqual(grades);
  await expect(refreshCourses(directSession)).resolves.toEqual(courses);
});

test('server-only cookies never trigger native requests for a nonexistent detailed audit endpoint', async () => {
  await expect(refreshCreditAudit(backendSession)).resolves.toBeNull();
  expect(puFetchCreditAudit).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('missing backend grades cannot overwrite cache with an invented empty list', async () => {
  const grades = { grades: [], allSemesters: ['1151'], summary: {} };
  jest.mocked(puFetchGrades).mockResolvedValue({ success: true, data: grades });
  await refreshGrades(directSession);
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, result: { success: true } }),
  });
  await expect(refreshGrades(backendSession)).resolves.toBeNull();
  expect(await getAnyCachedGrades()).toEqual(grades);
});

test('all failed sources do not publish a new successful sync time', async () => {
  const result = await syncAllData(directSession, { includeEssential: true });
  expect(result.creditAudit).toBeNull();
  expect(result.tcCourses).toBeNull();
  expect(await getLastSyncTime()).toBeNull();
});

test('sync completion waits for the credit result and includes it in the receipt', async () => {
  jest.mocked(puFetchCreditAudit).mockResolvedValue({ success: true, data: audit });
  const result = await syncAllData(directSession);
  expect(result.creditAudit).toEqual(audit);
  expect(await getAnyCachedCreditAudit()).toEqual(audit);
});

test('an old account grade request cannot repopulate the cache after logout', async () => {
  let complete!: (value: Awaited<ReturnType<typeof puFetchGrades>>) => void;
  jest.mocked(puFetchGrades).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pending = refreshGrades(directSession);
  const checked = expect(pending).rejects.toThrow('校務連線已變更');
  await clearPUCache();
  complete({ success: true, data: { grades: [], allSemesters: ['old-account'], summary: {} } });
  await checked;
  expect(await getAnyCachedGrades()).toBeNull();
});

test('an old detailed audit response cannot repopulate the cache after logout', async () => {
  let complete!: (value: Awaited<ReturnType<typeof puFetchCreditAudit>>) => void;
  jest.mocked(puFetchCreditAudit).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pending = refreshCreditAudit(directSession);
  const checked = expect(pending).rejects.toThrow('校務連線已變更');
  await clearPUCache();
  complete({ success: true, data: audit });
  await checked;
  expect(await getAnyCachedCreditAudit()).toBeNull();
});
