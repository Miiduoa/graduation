import Constants from 'expo-constants';
import { loadOwnedSchoolCreditOverview } from '../../services/ownedSchoolCreditOverview';

const mockRequester = { uid: 'a', getIdToken: jest.fn(async () => 'token') };
let mockCurrentUser: typeof mockRequester | null = mockRequester;
const mockFetch = jest.fn();
jest.mock('../../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockCurrentUser }) }));
const HOSTED_URL = 'https://nuni.tw/api/fn/getMyAcademicRecords';
const overview = () => ({ version: 1, source: 'pu-credit-review',
  totals: { required: 40.5, elective: 20, externalElective: 3, generalOld: 0, generalNew: 8, subtotal: 71.5, totalRequired: 128, minorDouble: null },
  coverage: { status: 'partial', missingFields: ['minorDouble'] } });
const reply = (status = 200, change: Record<string, unknown> = {}) => ({ ok: status === 200, status, json: async () => ({ result: {
  success: true, ownerUid: 'a', schoolId: 'pu', source: 'pu-campus', dataType: 'creditOverview',
  fetchedAt: '2026-10-28T00:00:00Z', result: { success: true, creditOverview: overview() }, ...change,
} }) });
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalExtra = Constants.expoConfig?.extra;
const configurationEnvKeys = [
  'EXPO_PUBLIC_FUNCTIONS_BASE_URL', 'EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_CLOUD_FUNCTION_REGION',
  'EXPO_PUBLIC_USE_FIREBASE_EMULATOR', 'EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR',
];
beforeEach(() => {
  for (const key of configurationEnvKeys) delete process.env[key];
  Object.assign(Constants.expoConfig!, { extra: { appEnv: 'production', firebase: { projectId: 'campus-one-tw' } } });
  mockCurrentUser = mockRequester;
  mockRequester.getIdToken.mockReset().mockResolvedValue('token');
  mockFetch.mockReset().mockResolvedValue(reply());
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  jest.useRealTimers();
  // Expo's virtual env module retains this object, so restore values in place.
  for (const key of configurationEnvKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  Object.assign(Constants.expoConfig!, { extra: originalExtra });
});

test('reads credit totals from the hosted route on the first request using only the owner token', async () => {
  expect((await loadOwnedSchoolCreditOverview('a')).overview).toEqual(overview());
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, options] = mockFetch.mock.calls[0];
  expect(url).toBe(HOSTED_URL);
  expect(JSON.parse(options.body)).toEqual({ data: { dataType: 'creditOverview' } });
  expect(options.headers.Authorization).toBe('Bearer token');
});
test.each(['functionsBaseUrl', 'cloudFunctionBaseUrl'])('selects the hosted capability before a custom %s can reject the data type', async (setting) => {
  Constants.expoConfig!.extra![setting] = 'https://nuni-functions.fly.dev';
  await loadOwnedSchoolCreditOverview('a');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith(HOSTED_URL, expect.objectContaining({
    body: JSON.stringify({ data: { dataType: 'creditOverview' } }),
  }));
});
test.each<[number, string]>([
  [400, 'unavailable'], [401, 'reconnect'], [403, 'permission'],
  [404, 'unavailable'], [429, 'unavailable'], [503, 'unavailable'],
])('does not retry authoritative HTTP %s against another endpoint', async (status, reason) => {
  mockFetch.mockResolvedValue(reply(status));
  await expect(loadOwnedSchoolCreditOverview('a')).rejects.toMatchObject({ reason });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][0]).toBe(HOSTED_URL);
});

test.each<{
  name: string; extra?: Record<string, unknown>; env?: Record<string, string>; expected: string;
}>([
  { name: 'another Firebase project', extra: { firebase: { projectId: 'different-project' } },
    expected: 'https://asia-east1-different-project.cloudfunctions.net/getMyAcademicRecords' },
  { name: 'another project with a custom host',
    extra: { firebase: { projectId: 'different-project' }, functionsBaseUrl: 'https://custom.example/api' },
    expected: 'https://custom.example/api/getMyAcademicRecords' },
  { name: 'HTTPS localhost', extra: { functionsBaseUrl: 'https://localhost:5001' },
    expected: 'https://localhost:5001/getMyAcademicRecords' },
  { name: 'HTTP localhost', extra: { functionsBaseUrl: 'http://localhost:5001' },
    expected: 'http://localhost:5001/getMyAcademicRecords' },
  { name: 'a localhost subdomain', extra: { functionsBaseUrl: 'https://api.localhost' },
    expected: 'https://api.localhost/getMyAcademicRecords' },
  { name: 'IPv4 loopback', extra: { functionsBaseUrl: 'https://127.0.0.1:5001' },
    expected: 'https://127.0.0.1:5001/getMyAcademicRecords' },
  { name: 'IPv6 loopback', extra: { functionsBaseUrl: 'https://[::1]:5001' },
    expected: 'https://[::1]:5001/getMyAcademicRecords' },
  { name: 'the Android host alias', extra: { functionsBaseUrl: 'https://10.0.2.2:5001' },
    expected: 'https://10.0.2.2:5001/getMyAcademicRecords' },
  { name: 'a non-HTTPS configured host', extra: { functionsBaseUrl: 'http://custom.example' },
    expected: 'http://custom.example/getMyAcademicRecords' },
  { name: 'local mock authentication',
    extra: { appEnv: 'development', allowLocalMockAuth: true, functionsBaseUrl: 'https://functions.example' },
    expected: 'https://functions.example/getMyAcademicRecords' },
  { name: 'the Expo emulator setting', extra: { useCloudFunctionEmulator: true, functionsBaseUrl: 'https://functions.example' },
    expected: 'http://127.0.0.1:5001/campus-one-tw/asia-east1/getMyAcademicRecords' },
  { name: 'the Functions emulator environment flag', env: { EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR: 'true' },
    expected: 'http://127.0.0.1:5001/campus-one-tw/asia-east1/getMyAcademicRecords' },
  { name: 'the Firebase emulator environment flag', env: { EXPO_PUBLIC_USE_FIREBASE_EMULATOR: '1' },
    expected: 'http://127.0.0.1:5001/campus-one-tw/asia-east1/getMyAcademicRecords' },
])('keeps $name on its configured endpoint even after a 404', async ({ extra, env, expected }) => {
  Object.assign(Constants.expoConfig!.extra!, extra);
  Object.assign(process.env, env);
  mockFetch.mockResolvedValue(reply(404));
  await expect(loadOwnedSchoolCreditOverview('a')).rejects.toMatchObject({ reason: 'unavailable' });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][0]).toBe(expected);
});
test.each([{ ownerUid: 'b' }, { schoolId: 'other' }, { source: 'cache' }, { dataType: 'grades' }, { fetchedAt: 'bad' },
  { result: { success: true, creditOverview: { ...overview(), source: 'derived-from-grade-rows' } } }])('rejects data without the expected provenance %j', async (change) => {
  mockFetch.mockResolvedValue(reply(200, change));
  await expect(loadOwnedSchoolCreditOverview('a')).rejects.toThrow();
});
test('rejects late data after a same-UID re-login', async () => {
  mockFetch.mockImplementationOnce(async () => {
    mockCurrentUser = { ...mockRequester };
    return reply();
  });
  await expect(loadOwnedSchoolCreditOverview('a')).rejects.toMatchObject({ reason: 'reconnect' });
});
test('times out pending tokens and never starts a late request', async () => {
  jest.useFakeTimers();
  let resolve!: (token: string) => void;
  mockRequester.getIdToken.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const task = loadOwnedSchoolCreditOverview('a');
  const rejection = expect(task).rejects.toMatchObject({ reason: 'unavailable' });
  await jest.advanceTimersByTimeAsync(45_000);
  await rejection;
  resolve('late-token');
  await Promise.resolve();
  expect(mockFetch).not.toHaveBeenCalled();
});
