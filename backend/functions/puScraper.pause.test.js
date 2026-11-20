const https = require('https');
const scraper = require('./puScraper');
const {
  isPuEcampusDataFetchEnabled,
  PU_ECAMPUS_DATA_PAUSED_CODE,
  PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} = require('./generated/shared/puEcampusDataPolicy');

const RELAY_ENV_KEYS = [
  'PU_EDGE_RELAY_URL',
  'PU_EDGE_RELAY_SECRET',
  'PU_EDGE_RELAY_ALT_URL',
  'PU_EDGE_RELAY_ALT_SECRET',
  'PU_EDGE_RELAY_ALT_HOSTS',
];
const cookies = Object.freeze({ SID: 'fixture-campus-session' });
const mypuCookies = Object.freeze({ PHPSESSID: 'fixture-mypu-session' });
const reads = [
  ['login', () => scraper.puLogin('412345678', 'fixture-password')],
  ['courses', () => scraper.puFetchCourses(cookies)],
  ['grades through the SSO bridge', () => scraper.puFetchGrades(cookies)],
  ['grades using an existing myPU session', () => scraper.puFetchGrades(cookies, '', { mypuCookies })],
  ['announcements', () => scraper.puFetchAnnouncements(cookies)],
  ['student profile', () => scraper.puFetchStudentInfo(cookies)],
  ['absence records', () => scraper.puFetchAbsence(cookies)],
  ['credit summary', () => scraper.puFetchCreditSummary(cookies)],
];

describe.each(['direct', 'injected relay', 'environment relay'])('E校園 pause: %s', (transport) => {
  let previousEnv;
  let directRequest;
  let runtimeFetch;
  let injectedFetch;

  beforeEach(() => {
    previousEnv = Object.fromEntries(RELAY_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of RELAY_ENV_KEYS) delete process.env[key];
    scraper.setCampusHttpFetch(null);

    directRequest = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('Unexpected direct campus request');
    });
    runtimeFetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected relay request'));
    injectedFetch = jest.fn().mockRejectedValue(new Error('Unexpected injected campus request'));
    if (transport === 'injected relay') scraper.setCampusHttpFetch(injectedFetch);
    if (transport === 'environment relay') {
      process.env.PU_EDGE_RELAY_URL = 'https://relay.example.invalid';
      process.env.PU_EDGE_RELAY_SECRET = 'fixture-relay-secret';
    }
  });

  afterEach(() => {
    scraper.setCampusHttpFetch(null);
    for (const key of RELAY_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    jest.restoreAllMocks();
  });

  test.each(reads)('%s returns a pause without contacting the school or relay', async (_label, read) => {
    // The actual shipped policy is intentionally not mocked in this suite.
    expect(isPuEcampusDataFetchEnabled()).toBe(false);
    await expect(read()).resolves.toMatchObject({
      success: false,
      code: PU_ECAMPUS_DATA_PAUSED_CODE,
      error: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
    });
    expect(directRequest).not.toHaveBeenCalled();
    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(injectedFetch).not.toHaveBeenCalled();
    expect(cookies).toEqual({ SID: 'fixture-campus-session' });
    expect(mypuCookies).toEqual({ PHPSESSID: 'fixture-mypu-session' });
  });
});
