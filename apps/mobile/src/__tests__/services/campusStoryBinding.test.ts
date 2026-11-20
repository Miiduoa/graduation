import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureCampusStoryBinding } from '../../services/campusStoryBinding';

const mockGetIdToken = jest.fn(async () => 'story-id-token');
let mockCurrentUser: { uid: string; getIdToken: typeof mockGetIdToken } | null = {
  uid: 'alice',
  getIdToken: mockGetIdToken,
};
let mockConfigured = true;
let mockMode = false;

jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
  hasUsableFirebaseConfig: () => mockConfigured,
  isFirebaseMockMode: () => mockMode,
}));

const originalFetch = globalThis.fetch;
const originalFunctionsBaseUrl = process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL;

beforeEach(() => {
  mockConfigured = true;
  mockMode = false;
  mockCurrentUser = { uid: 'alice', getIdToken: mockGetIdToken };
  mockGetIdToken.mockReset().mockResolvedValue('story-id-token');
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ result: { success: true, stamped: ['pu'] } }),
  }) as jest.Mock;
});

afterEach(() => {
  if (originalFunctionsBaseUrl === undefined) delete process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL;
  else process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL = originalFunctionsBaseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('production Firebase login posts to the nuni-web hosted route', async () => {
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL = 'https://nuni-functions.fly.dev';
  await ensureCampusStoryBinding();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    'https://nuni.tw/api/fn/ensureCampusStoryBinding',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer story-id-token' },
      body: JSON.stringify({ data: {} }),
    }),
  );
});

test('does not call the network without a Firebase user', async () => {
  mockCurrentUser = null;
  await ensureCampusStoryBinding();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('skips mock mode and unconfigured Firebase', async () => {
  mockMode = true;
  await ensureCampusStoryBinding();
  mockMode = false;
  mockConfigured = false;
  await ensureCampusStoryBinding();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('does not import httpsCallable or a Functions host', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../services/campusStoryBinding.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/httpsCallable/);
  expect(source).not.toMatch(/getCloudFunctionUrl/);
  expect(source).toMatch(/https:\/\/nuni\.tw\/api\/fn\/ensureCampusStoryBinding/);
});
