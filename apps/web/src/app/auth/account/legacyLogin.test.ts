import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { platformDestination } from '@/lib/accountDestination';
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
  ['/grades?tab=feedback&campus=pu', '/grades?tab=feedback&campus=pu'],
  ['/course/cs101?schoolId=pu#assignment-hw-3', '/course/cs101?schoolId=pu#assignment-hw-3'],
  ['/events/open-day?schoolId=nchu&source=campus', '/events/open-day?schoolId=nchu&source=campus'],
  ['/grades?tab=feedback&campus=nthu#recent', '/grades?tab=feedback&campus=nthu#recent'],
  ['/course/cs101?campus=pu#assignment-hw-1', '/course/cs101?campus=pu#assignment-hw-1'],
  ['/search?q=room%20A&campus=nthu#results', '/search?q=room+A&campus=nthu#results'],
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
  ['/login?returnUrl=%2Flife#sign-in', '/'],
  ['/auth/account?next=%2Flife', '/'],
  ['/staff', '/'],
  ['javascript:alert(1)', '/'],
  ['/life#services', '/life#services'],
  ['/life?campus=pu\n', '/'],
  ['/li\nfe?campus=pu', '/'],
  ['/life?campus=pu\u007f', '/'],
  ['/course/../login?campus=pu', '/'],
  ['/login?returnUrl=%2Fgrades', '/'],
  ['/auth/account?returnUrl=%2Fgrades', '/'],
  ['/classroom/login#feedback', '/'],
  ['/join?code=course-1', '/'],
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
  const destination = '/grades?tab=feedback&campus=nthu&q=a%26b%3Dc#recent';
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
  '/search?q=library+hours&campus=nthu#results',
  '/events/evt-1?schoolId=pu&source=school-club-events#registration',
  '/school-info?campus=ncku#contact',
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
  ['/grades?tab=semester&tab=feedback&campus=pu', '/grades?tab=semester&campus=pu'],
  ['/timetable?campus=nthu#personal-timetable', '/timetable?campus=nthu#personal-timetable'],
  ['/course/cs101?campus=pu#assignment-hw-1', '/course/cs101?campus=pu#assignment-hw-1'],
])('keeps %s in the school account flow after filtering page state', (requested, destination) => {
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: requested }));
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
  expect(platformDestination(login.searchParams.get('returnUrl'))).toBe('/classroom');
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

it.each([
  '/grades?tab=feedback&schoolId=nthu&campus=nthu#feedback',
  '/settings?section=appearance&campus=nthu',
  '/events',
  '/import?kind=grades&campus=pu',
  '/events/evt-1?school=PU&schoolId=pu&campus=pu&source=school-club-events#registration',
  '/events/evt-2?schoolId=nthu&campus=nthu&source=school-events',
  '/events/evt-3?schoolId=pu&campus=pu&source=legacy-events',
  '/school-info?schoolId=ncku&campus=ncku#contact',
  '/search?q=coffee+shop&category=campus',
  '/timetable?schoolId=pu&campus=pu&view=week&week=2026-10-26&semester=1151#personal-timetable',
  '/community/post/new?boardId=board-1',
  '/community/story/new?poiId=library',
  '/ai-assistant?courseId=course-1&groupId=group-1',
])('preserves usable page state when returning to %s', (path) => {
  expect(sanitizeReturnPath(path)).toBe(path);
  expect(readReturnPath(new URLSearchParams({ returnUrl: path }))).toBe(path);
  expect(readReturnPath(new URLSearchParams({ next: path }))).toBe(path);
});

it.each([
  '/login?returnUrl=%2Fgrades',
  '/join?next=%2Fgrades',
  '/admin/login?campus=pu',
  '/classroom/login#continue',
  '/auth/account?next=%2Fgrades',
  '/auth/account/callback?code=private&state=private',
  '/auth/platform/callback?code=private',
  '/auth/platform/token',
  '/auth/session',
  '/staff?campus=pu',
  '/academics',
  '/learning',
  '/school-info/unknown',
  '/events/evt-1/unavailable',
  '/events/../grades',
  '/events/%2e%2e/login',
  '/events/%2F%2Fevil.test',
  '/classroom/course/%5clogin',
  '/events/%00hidden',
  '/grades?tab=feedback\n',
  '/gra\ndes',
])('rejects login loops, retired pages and ambiguous return path %s', (path) => {
  expect(sanitizeReturnPath(path)).toBe('/');
  expect(campusOneLoginHref(new URLSearchParams({ returnUrl: path }))).toBeNull();
});

it('drops nested redirect and credential parameters, including encoded parameter names', () => {
  const path = '/grades?tab=feedback&campus=nthu&next=%2F%2Fevil.test&returnUrl=%2Flogin' +
    '&returnTo=%2Fadmin&redirect=https%3A%2F%2Fevil.test&continue=%2Flogin&callback=%2Fauth%2Fcallback' +
    '&token=private&access_token=private&code=private&state=private&session=private&%6Eext=%2Fadmin#feedback';
  expect(sanitizeReturnPath(path)).toBe('/grades?tab=feedback&campus=nthu#feedback');
  const handoff = new URL(campusOneLoginHref(new URLSearchParams({ returnUrl: path }))!, 'https://nuni.tw');
  expect(handoff.searchParams.get('returnUrl')).toBe('/grades?tab=feedback&campus=nthu#feedback');
});

it('keeps the first page-state value without letting duplicate or encoded keys change its meaning', () => {
  expect(sanitizeReturnPath('/grades?campus=nthu&campus=pu&%74ab=feedback&tab=semester')).toBe(
    '/grades?campus=nthu&tab=feedback',
  );
});

it('keeps a URL as search text without treating it as a nested destination', () => {
  const params = new URLSearchParams({ q: 'https://example.test/?next=/login', category: 'campus' });
  const path = `/search?${params}`;
  expect(sanitizeReturnPath(path)).toBe(path);
});

it('does not propagate control characters embedded in page-state values', () => {
  expect(sanitizeReturnPath('/grades?campus=pu&tab=feedback%0A&section=%5Caccount')).toBe('/grades?campus=pu');
});

it.each([
  '#access_token=private',
  '#code=private&state=private',
  '#next=https://evil.test',
  '#redirect=%2Flogin',
  '#access_token%3Dprivate',
  '#next%3D%2F%2Fevil.test',
  '#registration%0A',
  '#registration%5C',
  '#%E0%A4%A',
])('drops payload fragment %s while preserving the page and browsing context', (hash) => {
  expect(sanitizeReturnPath(`/grades?tab=feedback&campus=nthu${hash}`)).toBe(
    '/grades?tab=feedback&campus=nthu',
  );
});

it.each(['#reading', '#registration', '#assignment-hw-3', '#%E9%96%B1%E8%AE%80'])('keeps content anchor %s', (hash) => {
  expect(sanitizeReturnPath(`/grades?campus=pu${hash}`)).toBe(`/grades?campus=pu${hash}`);
});

it.each([
  ['/auth/platform/class-workspace/join?campus=nthu', '/auth/platform/class-workspace/join'],
  ['/auth/platform/class-workspace/cw_11111111-1111-4111-8111-111111111111?campus=nthu#materials', '/'],
  ['/auth/platform/ops?create=school#form', '/'],
  ['/auth/platform/school-review?campus=pu', '/auth/platform/school-review'],
 ])('keeps retained account callbacks on their path-only contract: %s', (path, expected) => {
  expect(sanitizeReturnPath(path)).toBe(expected);
  expect(campusOneLoginHref(new URLSearchParams({ returnUrl: path }))).toBeNull();
});

it('filters return context before handing a task to Campus One login', () => {
  const input = '/events/open-day?campus=pu&next=%2F%2Fevil.test&token=private#registration';
  const destination = '/events/open-day?campus=pu#registration';
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: input }));
  expect(new URL(href!, 'https://nuni.tw').searchParams.get('returnUrl')).toBe(destination);
});

it('keeps the first safe content anchor when a stale document fragment is repeated', () => {
  expect(sanitizeReturnPath('/grades?campus=pu#feedback#stale')).toBe('/grades?campus=pu#feedback');
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
  const returnPath = '/grades?tab=feedback&campus=pu#course-cs101';
  await startGoogleContinue('/grades?tab=feedback&campus=pu&next=%2F%2Fevil.test#course-cs101');
  expect(fetchMock).toHaveBeenCalledWith('/auth/platform/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', kind: 'google-consumer' }),
  });
  const stored = JSON.parse(sessionStorage.getItem(PLATFORM_LOGIN_TRANSACTION_KEY)!);
  expect(stored.returnPath).toBe(returnPath);
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

it.each([
  '/course/cs101?schoolId=pu#assignment-hw-3',
  '/events/evt-1?campus=pu&source=school-club-events#registration',
])('starts school login with return context for %s', async (returnPath) => {
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
  await startSchoolProvider('tenant-1', 'google-workspace', returnPath);
  expect(fetchMock).toHaveBeenCalledWith('/auth/account/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'start', tenantId: 'tenant-1', kind: 'google-workspace' }),
  });
  const stored = JSON.parse(sessionStorage.getItem(ACCOUNT_LOGIN_TRANSACTION_KEY)!);
  expect(stored.returnPath).toBe(returnPath);
  expect(stored.redirectUri).toBe('https://nuni.tw/auth/account/callback');
  expect(assign).toHaveBeenCalledOnce();
});
