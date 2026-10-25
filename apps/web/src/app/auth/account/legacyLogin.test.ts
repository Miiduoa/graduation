import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ACCOUNT_API_ORIGIN,
  ACCOUNT_LOGIN_TRANSACTION_KEY,
  PLATFORM_LOGIN_TRANSACTION_KEY,
  campusOneLoginHref,
  discoverSchool,
  listPlatformProviderKinds,
  readExistingSession,
  readReturnPath,
  sanitizeReturnPath,
  searchSchoolsByName,
  startGoogleContinue,
  startSchoolProvider,
  usableSchoolProviders,
} from './legacyLogin';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ['/', '/'],
  ['/life', '/life'],
  ['/timetable', '/timetable'],
  ['/grades', '/grades'],
  ['/grades?tab=feedback&campus=nthu#recent', '/grades?tab=feedback&campus=nthu#recent'],
  ['/course/cs101?campus=pu#assignment-hw-1', '/course/cs101?campus=pu#assignment-hw-1'],
  ['/search?q=room%20A&campus=nthu#results', '/search?q=room%20A&campus=nthu#results'],
  ['/classroom', '/classroom'],
  ['/merchant', '/merchant'],
  ['/admin', '/admin'],
  ['/auth/platform/class-workspace/join', '/auth/platform/class-workspace/join'],
  ['/auth/platform/ops?tab=review', '/auth/platform/ops'],
  ['/auth/platform/ops#pending', '/'],
  ['/me', '/me'],
  ['https://evil.test', '/'],
  ['//evil.test', '/'],
  ['/\\evil.test', '/'],
  ['/login', '/'],
  ['/login?returnUrl=%2Fgrades', '/'],
  ['/auth/account?returnUrl=%2Fgrades', '/'],
  ['/classroom/login#feedback', '/'],
  ['/join?code=course-1', '/'],
  ['/staff', '/'],
  ['javascript:alert(1)', '/'],
  ['/life#services', '/life#services'],
  ['/leave?requestId=abc-1', '/'],
  ['/grades/../auth/account', '/'],
  ['/grades/%2e%2e/auth/account', '/'],
  ['/grades\n?tab=feedback', '/'],
  ['/grades?tab=feedback\t', '/'],
  ['/grades' + String.fromCharCode(127), '/'],
  ['/profile?' + 'a'.repeat(1300), '/'],
])('keeps only Campus One return paths and rejects %s', (input, expected) => {
  expect(sanitizeReturnPath(input)).toBe(expected);
  expect(readReturnPath(`returnUrl=${encodeURIComponent(input)}`)).toBe(expected);
});

it('reads next when returnUrl is absent', () => {
  expect(readReturnPath('next=%2Flife')).toBe('/life');
});

it('keeps returnUrl precedence without decoding the destination twice', () => {
  const destination = '/grades?tab=feedback&campus=nthu&label=a%26b%3Dc#recent';
  const params = new URLSearchParams({ returnUrl: destination, next: '/timetable' });
  expect(readReturnPath(params)).toBe(destination);
  expect(new URL(campusOneLoginHref(params)!, 'https://nuni.tw').searchParams.get('returnUrl')).toBe(destination);
  params.set('returnUrl', '');
  expect(readReturnPath(params)).toBe('/');
  expect(campusOneLoginHref(params)).toBeNull();
  params.set('returnUrl', 'https://evil.test');
  expect(campusOneLoginHref(params)).toBeNull();
});

it.each([
  '/grades?tab=feedback&campus=nthu#recent',
  '/grades?tab=semester&campus=pu',
  '/classroom/grades?schoolId=tw-pu#recent',
  '/course/cs101?campus=pu#assignment-hw-1',
  '/timetable?campus=nthu',
  '/life?campus=nthu#services',
  '/search?q=library%20hours&campus=nthu#results',
  '/admin',
])('hands the Campus One destination %s to its own login route', (destination) => {
  const href = campusOneLoginHref(new URLSearchParams({ next: destination }));
  expect(href).toBeTruthy();
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.origin).toBe('https://nuni.tw');
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
});

it('keeps an explicit school reconnect when handing off an academic task', () => {
  const destination = '/grades?tab=semester&campus=pu';
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: destination, reconnect: 'school' }));
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.searchParams.get('reconnect')).toBe('school');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
});

it.each([
  null,
  '',
  '/',
  '/life',
  '/search',
  '/auth/platform',
  '/auth/platform/class-workspace/join',
  '/auth/platform/ops?tab=review#pending',
  '/auth/platform/school-review/tenant-1',
  '/privacy/deletion-status',
  '/login?returnUrl=%2Fgrades',
  '/auth/account?next=%2Fgrades',
  '//evil.test/grades',
  '/\\evil.test',
  'https://evil.test',
  '%2F%2Fevil.test',
])('keeps the existing entry or rejects unsafe handoff input: %s', (destination) => {
  const params = new URLSearchParams();
  if (destination !== null) params.set('returnUrl', destination);
  expect(campusOneLoginHref(params)).toBeNull();
});

it('lists only the consumer Google and Apple kinds from the existing providers endpoint', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ kinds: ['google-consumer', 'school-issued', 'apple'] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  await expect(listPlatformProviderKinds()).resolves.toEqual(['google-consumer', 'apple']);
  expect(fetchMock).toHaveBeenCalledWith('/auth/platform/providers', { cache: 'no-store' });
});

it('starts Google continue through the existing platform token endpoint and PKCE transaction', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { assign, origin: 'https://nuni.tw' });
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        kind: 'google-consumer',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'web.apps.googleusercontent.com',
        redirectUri: 'https://nuni.tw/auth/platform/callback',
        scopes: ['openid', 'email'],
        nonce: 'nonce-value',
        expiresInSeconds: 300,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  await startGoogleContinue('/life');
  expect(fetchMock).toHaveBeenCalledWith('/auth/platform/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', kind: 'google-consumer' }),
  });
  const stored = JSON.parse(sessionStorage.getItem(PLATFORM_LOGIN_TRANSACTION_KEY)!);
  expect(stored.returnPath).toBe('/life');
  expect(stored.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  const destination = new URL(assign.mock.calls[0][0]);
  expect(destination.origin).toBe('https://accounts.google.com');
  expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
  expect(destination.searchParams.get('state')).toBe(stored.state);
  expect(destination.searchParams.get('prompt')).toBe('select_account');
});

it('looks up a school through the existing registration-start API', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        available: true,
        tenantId: 'tenant-1',
        displayName: '靜宜大學',
        providerKinds: ['google-workspace', 'campus-oidc'],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  await expect(discoverSchool('student@pu.edu.tw')).resolves.toMatchObject({
    available: true,
    tenantId: 'tenant-1',
  });
  expect(fetchMock).toHaveBeenCalledWith(`${ACCOUNT_API_ORIGIN}/v1/auth/account/registration-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@pu.edu.tw' }),
    cache: 'no-store',
  });
  expect(usableSchoolProviders(['google-workspace', 'campus-oidc'])).toEqual(['google-workspace']);
});

it('searches schools by name through the existing find-school search endpoint', async () => {
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === 'POST') {
      return new Response('', { status: 405, statusText: 'Method Not Allowed' });
    }
    return new Response(
      JSON.stringify({
        schools: [{ tenantId: 'pu', displayName: '靜宜大學', status: 'open' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  await expect(searchSchoolsByName('靜宜大學')).resolves.toEqual([
    { available: true, tenantId: 'pu', displayName: '靜宜大學' },
  ]);
  expect(fetchMock).toHaveBeenCalledWith('/auth/find-school/search?q=' + encodeURIComponent('靜宜大學'), {
    cache: 'no-store',
  });
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('treats Campus One session as signed in before falling back to /auth/session', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ authenticated: true, platformAccountId: 'pa_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  await expect(readExistingSession()).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('/api/nuni/session', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  expect(fetchMock).not.toHaveBeenCalledWith('/auth/session', expect.anything());
});

it('starts school login through the existing account token endpoint', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { assign, origin: 'https://nuni.tw' });
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        kind: 'google-workspace',
        issuer: 'https://accounts.google.com',
        clientId: 'school.apps.googleusercontent.com',
        scopes: ['openid', 'email'],
        nonce: 'school-nonce',
        expiresInSeconds: 300,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  await startSchoolProvider('tenant-1', 'google-workspace', '/life');
  expect(fetchMock).toHaveBeenCalledWith('/auth/account/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', tenantId: 'tenant-1', kind: 'google-workspace' }),
  });
  const stored = JSON.parse(sessionStorage.getItem(ACCOUNT_LOGIN_TRANSACTION_KEY)!);
  expect(stored.redirectUri).toBe('https://nuni.tw/auth/account/callback');
  expect(assign).toHaveBeenCalledOnce();
});
