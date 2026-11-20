import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: jest.fn((name: string) => `https://functions.test/${name}`),
  getFirebaseAuthHeaders: jest.fn(async () => ({})),
}));

import {
  clearTCSavedCredentials,
  purgeLegacyTCSensitiveStorage,
  setTCBackendSession,
  setTCSavedCredentials,
} from '../../services/tronClassClient';

const TC_CRED_ASYNC_KEY = '@pu_tc_cred_fb';
const TC_BACKEND_SESSION_KEY = '@pu_cache:tc_backend_session';

describe('TronClass sensitive storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await clearTCSavedCredentials();
  });

  test('keeps saved credentials memory-only and clears legacy AsyncStorage credentials', async () => {
    await AsyncStorage.setItem(TC_CRED_ASYNC_KEY, JSON.stringify({ studentId: 's1', password: 'p1' }));

    await setTCSavedCredentials('s1', 'p1');

    await expect(AsyncStorage.getItem(TC_CRED_ASYNC_KEY)).resolves.toBeNull();
  });

  test('does not persist backend session IDs in legacy AsyncStorage', async () => {
    await AsyncStorage.setItem(TC_BACKEND_SESSION_KEY, JSON.stringify({ sessionId: 'legacy' }));

    await setTCBackendSession('session-1', 123);

    await expect(AsyncStorage.getItem(TC_BACKEND_SESSION_KEY)).resolves.toBeNull();
  });

  test('purges old credential and backend session AsyncStorage keys', async () => {
    await AsyncStorage.setItem(TC_CRED_ASYNC_KEY, 'legacy-creds');
    await AsyncStorage.setItem(TC_BACKEND_SESSION_KEY, 'legacy-session');

    await purgeLegacyTCSensitiveStorage();

    await expect(AsyncStorage.getItem(TC_CRED_ASYNC_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(TC_BACKEND_SESSION_KEY)).resolves.toBeNull();
  });
});
