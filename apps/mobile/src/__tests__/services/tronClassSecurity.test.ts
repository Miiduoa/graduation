import type AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecureValues = new Map<string, string>();
const mockSecureGet = jest.fn(async (key: string) => mockSecureValues.get(key) ?? null);
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: (key: string) => mockSecureGet(key),
  secureSetItem: async (key: string, value: string) => {
    if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid key provided to SecureStore.');
    mockSecureValues.set(key, value);
  },
  secureDeleteItem: async (key: string) => { mockSecureValues.delete(key); },
}));
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: async () => ({}),
}));

const sessionKey = 'campus.tronclass.backend-session.v1';
const legacySessionKey = '@pu_cache:tc_backend_session';
const passwordKey = '@pu_tc_cred';
const legacyPasswordKeys = ['@pu_tc_cred_fb', '@pu_cache:tc_credentials'];
const savedSession = JSON.stringify({ sessionId: 'current-session', userId: 7 });
let storage: typeof AsyncStorage;
let client: typeof import('../../services/tronClassClient');
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  jest.resetModules();
  storage = require('@react-native-async-storage/async-storage');
  client = require('../../services/tronClassClient');
  mockSecureGet.mockClear();
  mockSecureValues.clear();
  await storage.clear();
});
afterEach(() => { globalThis.fetch = originalFetch; });

test.each(['secure', 'legacy', 'legacy-secure'] as const)(
  'upgrade deletes old passwords without reading them and retains the %s authorized session',
  async (source) => {
    mockSecureValues.set(passwordKey, 'old-password');
    for (const key of legacyPasswordKeys) await storage.setItem(key, 'old-password');
    if (source === 'secure') mockSecureValues.set(sessionKey, savedSession);
    if (source === 'legacy-secure') mockSecureValues.set(legacySessionKey, savedSession);
    await storage.setItem(legacySessionKey, source === 'legacy' ? savedSession : 'obsolete-session');

    await client.purgeLegacyTCSensitiveStorage();

    expect(mockSecureGet).not.toHaveBeenCalledWith(passwordKey);
    expect(mockSecureValues.has(passwordKey)).toBe(false);
    for (const key of legacyPasswordKeys) expect(await storage.getItem(key)).toBeNull();
    expect(await storage.getItem(legacySessionKey)).toBeNull();
    expect(mockSecureValues.has(legacySessionKey)).toBe(false);
    expect(mockSecureValues.get(sessionKey)).toBe(savedSession);
    expect(await client.getTCBackendSessionId()).toBe('current-session');
  },
);

test('an expired session makes one owned request, clears the connection and never replays a legacy password', async () => {
  mockSecureValues.set(passwordKey, JSON.stringify({ studentId: 'previous', password: 'fixture' }));
  await client.setTCBackendSession('expired-session', 7);
  const network = jest.fn(async () => ({
    ok: false, status: 401, text: async () => JSON.stringify({ success: false }),
  }));
  globalThis.fetch = network as unknown as typeof fetch;

  await expect(client.tcFetchProfile()).rejects.toThrow('請重新登入');
  expect(await client.getTCBackendSessionId()).toBeNull();
  expect(network).toHaveBeenCalledTimes(1);
  expect(network).toHaveBeenCalledWith('https://functions.test/puFetchTronClassData', expect.anything());
  expect(mockSecureGet).not.toHaveBeenCalledWith(passwordKey);
});
