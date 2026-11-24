import { isPuEcampusDataFetchEnabled } from '@campus/shared/src/puEcampusDataPolicy';
import { getRawAppEnv, getReleaseConfig, getSchoolIntegrationStatus } from '../../services/release';
import {
  getSchoolLoginAvailabilityState,
  isSchoolLoginEntryAvailable,
  loadSchoolLoginProviderKinds,
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../../services/schoolLoginAvailability';

jest.mock('../../services/release', () => ({
  getRawAppEnv: jest.fn(),
  getReleaseConfig: jest.fn(),
  getSchoolIntegrationStatus: jest.fn(),
}));
jest.mock('@campus/shared/src/puEcampusDataPolicy', () => ({
  isPuEcampusDataFetchEnabled: jest.fn(),
}));

const originalFetch = global.fetch;
const request = jest.fn();
const release = getReleaseConfig as jest.Mock;
const integration = getSchoolIntegrationStatus as jest.Mock;
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) });

beforeEach(() => {
  request.mockReset();
  global.fetch = request as typeof fetch;
  jest.mocked(getRawAppEnv).mockReturnValue('production');
  jest.mocked(isPuEcampusDataFetchEnabled).mockReturnValue(true);
  release.mockReturnValue({ features: { enabled: true } });
  integration.mockReturnValue({ enabled: true, sso: true });
  resetSchoolLoginProviderCache();
});

afterEach(() => {
  global.fetch = originalFetch;
  resetSchoolLoginProviderCache();
});

test('reads the selected school capability from the Web contract without a platform session', async () => {
  request.mockResolvedValue(response({ google: false, studentId: true }));
  expect(getSchoolLoginAvailabilityState('pu')).toBe('unknown');
  await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual(['student-id']);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
  expect(request).toHaveBeenCalledWith(
    'https://nuni.tw/api/nuni/sign-in-options?schoolId=pu',
    expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }),
  );
});

test('transient and malformed responses fail closed without poisoning the next sign-in check', async () => {
  request.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ kinds: ['school-issued'] }))
    .mockResolvedValueOnce(response({ google: true, studentId: 'true' }))
    .mockResolvedValueOnce(response({ google: true, studentId: true }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = loadSchoolLoginProviderKinds();
    expect(getSchoolLoginAvailabilityState()).toBe('loading');
    await expect(pending).resolves.toEqual([]);
    expect(getSchoolLoginAvailabilityState()).toBe('error');
    expect(isSchoolLoginEntryAvailable()).toBe(false);
  }
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['student-id']);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['student-id']);
  expect(getSchoolLoginAvailabilityState()).toBe('available');
  expect(request).toHaveBeenCalledTimes(4);
});

test('a confirmed closed school remains closed even when Google is available', async () => {
  request.mockResolvedValue(response({ google: true, studentId: false }));
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  expect(getSchoolLoginAvailabilityState()).toBe('unavailable');
  expect(request).toHaveBeenCalledTimes(1);
});

test('a response started before reset cannot restore stale availability or erase a newer request', async () => {
  let finishOld!: (value: unknown) => void;
  let finishCurrent!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishCurrent = resolve; }));
  const old = loadSchoolLoginProviderKinds('pu');
  resetSchoolLoginProviderCache();
  const current = loadSchoolLoginProviderKinds('pu');
  finishOld(response({ google: true, studentId: true }));
  await expect(old).resolves.toEqual([]);
  expect(getSchoolLoginAvailabilityState('pu')).toBe('loading');
  finishCurrent(response({ google: true, studentId: false }));
  await expect(current).resolves.toEqual([]);
  expect(getSchoolLoginAvailabilityState('pu')).toBe('unavailable');
});

test('a stale response cannot replace availability explicitly set after reset', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = loadSchoolLoginProviderKinds();
  resetSchoolLoginProviderCache();
  setSchoolLoginProviderKinds(['google-consumer']);
  finish(response({ google: true, studentId: true }));
  await expect(pending).resolves.toEqual(['google-consumer']);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['google-consumer']);
  expect(isSchoolLoginEntryAvailable()).toBe(false);
});

test('concurrent reads share a request while returned arrays cannot mutate the cached capability', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = loadSchoolLoginProviderKinds('pu');
  const second = loadSchoolLoginProviderKinds('pu');
  expect(request).toHaveBeenCalledTimes(1);
  finish(response({ google: false, studentId: true }));
  const results = await Promise.all([first, second]);
  results[0].splice(0);
  expect(results[1]).toEqual(['student-id']);
  await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual(['student-id']);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
});

test('changing to another school never borrows Providence availability or sends a fallback request', async () => {
  request.mockResolvedValue(response({ google: false, studentId: true }));
  await loadSchoolLoginProviderKinds('pu');
  expect(isSchoolLoginEntryAvailable('other-school')).toBe(false);
  await expect(loadSchoolLoginProviderKinds('other-school')).resolves.toEqual([]);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  setSchoolLoginProviderKinds([], 'other-school');
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
});

test.each([
  ['feature', { features: { enabled: false } }, { enabled: true, sso: true }],
  ['school', { features: { enabled: true } }, { enabled: false, sso: true }],
  ['SSO', { features: { enabled: true } }, { enabled: true, sso: false }],
])('the %s release gate stays authoritative over a cached server capability', async (_gate, config, status) => {
  setSchoolLoginProviderKinds(['student-id']);
  release.mockReturnValue(config);
  integration.mockReturnValue(status);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(false);
  await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual([]);
  expect(request).not.toHaveBeenCalled();
});

test.each(['production', 'preview'])('the PU pause hides cached credentials and skips capability requests in %s', async (appEnv) => {
  jest.mocked(getRawAppEnv).mockReturnValue(appEnv);
  jest.mocked(isPuEcampusDataFetchEnabled).mockReturnValue(false);
  setSchoolLoginProviderKinds(['student-id']);
  expect(getSchoolLoginAvailabilityState('pu')).toBe('unavailable');
  expect(isSchoolLoginEntryAvailable('pu')).toBe(false);
  await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual([]);
  resetSchoolLoginProviderCache();
  await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual([]);
  expect(request).not.toHaveBeenCalled();
});

test('the existing development fixture entry stays behind the development build gate', async () => {
  jest.mocked(getRawAppEnv).mockReturnValue('development');
  jest.mocked(isPuEcampusDataFetchEnabled).mockReturnValue(false);
  setSchoolLoginProviderKinds(['student-id']);
  expect(isSchoolLoginEntryAvailable('pu')).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

test('updating another school does not discard the current school request', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = loadSchoolLoginProviderKinds('pu');
  setSchoolLoginProviderKinds([], 'other-school');
  finish(response({ google: false, studentId: true }));
  await expect(pending).resolves.toEqual(['student-id']);
  expect(getSchoolLoginAvailabilityState('pu')).toBe('available');
  expect(getSchoolLoginAvailabilityState('other-school')).toBe('unavailable');
});

test('a bounded timeout permits retry even when transport ignores abort, and a late response cannot replace it', async () => {
  jest.useFakeTimers();
  try {
    let finishOld!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(response({ google: false, studentId: true }));
    const old = loadSchoolLoginProviderKinds('pu');
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    await jest.advanceTimersByTimeAsync(12_000);
    await expect(old).resolves.toEqual([]);
    expect(signal.aborted).toBe(true);
    expect(getSchoolLoginAvailabilityState('pu')).toBe('error');
    await expect(loadSchoolLoginProviderKinds('pu')).resolves.toEqual(['student-id']);
    finishOld(response({ google: true, studentId: false }));
    await jest.advanceTimersByTimeAsync(0);
    expect(getSchoolLoginAvailabilityState('pu')).toBe('available');
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  { ok: false, text: async () => '{"google":true,"studentId":true}' },
  { ok: true, redirected: true, text: async () => '{"google":true,"studentId":true}' },
  { ok: true, text: async () => 'not json' },
  { ok: true, text: async () => JSON.stringify([{ google: true, studentId: true }]) },
  { ok: true, text: async () => ' '.repeat(8193) },
])('failed or invalid HTTP responses are unknown failures, not confirmation that a school is closed', async (failed) => {
  request.mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(response({ google: true, studentId: true }));
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  expect(getSchoolLoginAvailabilityState()).toBe('error');
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['student-id']);
});
