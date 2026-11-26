import Constants from 'expo-constants';
import * as ecampusPolicy from '@campus/shared/src/puEcampusDataPolicy';
import {
  isSchoolLoginEntryAvailable,
  isStudentIdLoginAvailable,
  loadSchoolLoginProviderKinds,
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';
import { signInWithStudentId } from '../services/studentIdAuth';
import { tcLogin } from '../services/tronClassClient';

jest.mock('../services/nuniClient', () => ({ nuniPlatformRequest: jest.fn() }));
jest.mock('../services/mockAuth', () => ({ saveMockAuthSession: jest.fn() }));
jest.mock('../services/puDirectScraper', () => ({
  puLogin: jest.fn(),
  puFetchStudentInfo: jest.fn(),
}));
jest.mock('../services/tronClassClient', () => ({
  setTCBackendSession: jest.fn(),
  tcLogin: jest.fn(),
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
jest.mock('../services/postLoginDataRouter', () => ({
  clearPostLoginCache: jest.fn(async () => undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetSchoolLoginProviderCache();
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: { releasedSchoolIds: ['pu'], features: { enabled: true, sso: true } },
    },
  });
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
    expect(tcLogin).not.toHaveBeenCalled();
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
  expect(isSchoolLoginEntryAvailable('pu')).toBe(false);
  const source = jest.spyOn(ecampusPolicy, 'isPuEcampusDataFetchEnabled').mockReturnValue(true);
  try {
    expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
  } finally {
    source.mockRestore();
  }
  expect(isStudentIdLoginAvailable('other-school')).toBe(false);
  await expect(
    signInWithStudentId({ schoolId: 'other-school', studentId: 's123', password: 'secret' }),
  ).rejects.toThrow('帳號連線尚未開放');
  expect(tcLogin).not.toHaveBeenCalled();
});

test('a temporary provider error can recover on the next lookup', async () => {
  const source = jest.spyOn(ecampusPolicy, 'isPuEcampusDataFetchEnabled').mockReturnValue(true);
  const priorFetch = globalThis.fetch;
  const request = jest.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ studentId: true }) });
  globalThis.fetch = request;
  try {
    await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual([]);
    await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual(['student-id']);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    globalThis.fetch = priorFetch;
    source.mockRestore();
  }
});

test('retry refreshes a cached unavailable provider and keeps a usable result', async () => {
  const source = jest.spyOn(ecampusPolicy, 'isPuEcampusDataFetchEnabled').mockReturnValue(true);
  const priorFetch = globalThis.fetch;
  const request = jest.fn().mockResolvedValueOnce({
    ok: true, text: async () => JSON.stringify({ studentId: true }),
  });
  globalThis.fetch = request;
  setSchoolLoginProviderKinds(['google-consumer']);
  try {
    await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual(['google-consumer']);
    await expect(loadSchoolLoginProviderKinds('pu', { recheckUnavailable: true })).resolves.toEqual(['student-id']);
    await expect(loadSchoolLoginProviderKinds('pu', { recheckUnavailable: true })).resolves.toEqual(['student-id']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      'https://nuni.tw/api/nuni/sign-in-options?scope=school&schoolId=pu',
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  } finally {
    globalThis.fetch = priorFetch;
    source.mockRestore();
  }
});
