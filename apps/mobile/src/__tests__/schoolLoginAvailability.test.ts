import Constants from 'expo-constants';
import {
  isSchoolLoginEntryAvailable,
  isStudentIdLoginAvailable,
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';
import { signInWithStudentId } from '../services/studentIdAuth';
import { setTCSavedCredentials } from '../services/tronClassClient';

jest.mock('../services/mockAuth', () => ({ saveMockAuthSession: jest.fn() }));
jest.mock('../services/puDirectScraper', () => ({
  puLogin: jest.fn(),
  puFetchStudentInfo: jest.fn(),
}));
jest.mock('../services/tronClassClient', () => ({
  setTCBackendSession: jest.fn(),
  setTCSavedCredentials: jest.fn(),
  clearTCSavedCredentials: jest.fn(),
  clearTCSession: jest.fn(),
}));
jest.mock('../services/puDataCache', () => ({}));
jest.mock('../data/apiAdapters', () => ({ getAdapter: jest.fn() }));
jest.mock('../data/apiAdapters/PUAdapter', () => ({ PUAdapter: class {} }));
jest.mock('../services/cloudFunctions', () => ({ getCloudFunctionUrl: jest.fn() }));
jest.mock('../firebase', () => ({
  getAuthInstance: jest.fn(),
  hasUsableFirebaseConfig: jest.fn(),
}));
jest.mock('../services/testSeedData', () => ({ seedTestData: jest.fn() }));
jest.mock('../services/postLoginContextFromCaches', () => ({}));
jest.mock('../services/postLoginDataRouter', () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
  resetSchoolLoginProviderCache();
});
test.each([
  { appEnv: 'production', release: { releasedSchoolIds: [], features: { sso: true } } },
  { appEnv: 'production', release: { releasedSchoolIds: ['pu'], features: { sso: false } } },
  {
    appEnv: 'production',
    release: { releasedSchoolIds: ['pu'], features: { enabled: false, sso: true } },
  },
])(
  'a closed school integration rejects direct credentials before storage or network: %j',
  async (extra) => {
    Object.assign(Constants.expoConfig!, { extra });
    const priorFetch = globalThis.fetch;
    const fetch = jest.fn();
    globalThis.fetch = fetch;
    expect(isStudentIdLoginAvailable('pu')).toBe(false);
    await expect(
      signInWithStudentId({ schoolId: 'pu', studentId: 's123', password: 'secret' }),
    ).rejects.toThrow('帳號連線尚未開放');
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    globalThis.fetch = priorFetch;
  },
);

test('accepted SSO still refuses to send a different school credentials to Providence', async () => {
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: {
        releasedSchoolIds: ['pu', 'other-school'],
        features: { enabled: true, sso: true },
      },
    },
  });
  expect(isStudentIdLoginAvailable('pu')).toBe(true);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(false);
  setSchoolLoginProviderKinds(['google-consumer']);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(false);
  setSchoolLoginProviderKinds(['school-issued']);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
  expect(isStudentIdLoginAvailable('other-school')).toBe(false);
  await expect(
    signInWithStudentId({ schoolId: 'other-school', studentId: 's123', password: 'secret' }),
  ).rejects.toThrow('帳號連線尚未開放');
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
});
