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
  adminLoginReturnPath,
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

it.each([
  '/lost-found?schoolId=nthu&q=%E9%9B%A8%E5%82%98&type=found&status=open&mine=1&page=2',
  '/lost-found/item-1?schoolId=nthu&type=lost&status=resolved&page=3',
  '/events/event-1?schoolId=nthu&source=school-events&view=upcoming&page=12',
  '/announcements/notice-1?schoolId=pu&category=academic&pinned=1&page=2',
])('keeps validated service-list state through login: %s', (path) => {
  expect(sanitizeReturnPath(path)).toBe(path);
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: path }));
  expect(new URL(href!, 'https://nuni.tw').searchParams.get('returnUrl')).toBe(path);
});

it('does not let list-only parameters carry auth payloads or affect unrelated routes', () => {
  expect(sanitizeReturnPath('/lost-found?schoolId=nthu&type=https%3A%2F%2Fevil.test&status=token&mine=true&page=999&returnUrl=%2Fadmin&token=secret'))
    .toBe('/lost-found?schoolId=nthu');
  expect(sanitizeReturnPath('/grades?schoolId=nthu&page=2&type=found&status=open&mine=1&pinned=1'))
    .toBe('/grades?schoolId=nthu');
  expect(sanitizeReturnPath('/events?page=0&page=2&pinned=1&mine=1'))
    .toBe('/events?page=2');
});

it('preserves the allowed 200-character Chinese service query without expanding unrelated destinations', () => {
  const q = '校園'.repeat(100);
  const path = `/lost-found?${new URLSearchParams({ schoolId: 'nthu', q, type: 'found', page: '2' })}`;
  expect(path.length).toBeGreaterThan(1200);
  expect(sanitizeReturnPath(path)).toBe(path);
  expect(sanitizeReturnPath('/profile?q=' + 'x'.repeat(1300))).toBe('/');
  expect(sanitizeReturnPath('/lost-found?q=' + 'x'.repeat(201))).toBe('/lost-found');
  expect(sanitizeReturnPath('/events?q=' + 'x'.repeat(4097))).toBe('/');
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
  ['/account-deletion/status', '/account-deletion/status'],
  ['/auth/platform/class-workspace/join', '/auth/platform/class-workspace/join'],
  ['/admin/ops', '/admin/ops'],
  ['/admin/ops#people', '/admin/ops#people'],
  ['/admin/ops?tab=people', '/admin/ops?tab=people'],
  ['/admin/ops#secret', '/'],
  ['/admin/ops?tab=evil', '/'],
  ['/admin/ops?tab=people&tab=audit', '/'],
  ['/admin/ops?tab=people#merchants', '/'],
  ['/admin/school-review', '/admin/school-review'],
  ['/auth/platform/ops', '/auth/platform/ops'],
  ['/auth/platform/school-review', '/auth/platform/school-review'],
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
])('keeps only nuni return paths and rejects %s', (input, expected) => {
  expect(sanitizeReturnPath(input)).toBe(expected);
  expect(readReturnPath(`returnUrl=${encodeURIComponent(input)}`)).toBe(expected);
});

it.each([
  [null, '/admin'],
  ['', '/admin'],
  ['/admin', '/admin'],
  ['/admin/ops?tab=people', '/admin/ops?tab=people'],
  ['/admin/ops#people', '/admin/ops#people'],
  ['/admin/school-review', '/admin/school-review'],
  ['/', '/'],
  ['/admin/ops#secret', '/admin'],
  ['/admin/ops?tab=evil', '/admin'],
  ['https://evil.test', '/admin'],
  ['/login', '/admin'],
  ['/auth/platform#pending', '/admin'],
])('sends admin login back through the existing whitelist: %s', (input, expected) => {
  expect(adminLoginReturnPath(input)).toBe(expected);
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
])('hands the nuni destination %s to its own login route', (destination) => {
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

it.each(['join', 'new'])('returns a bookmarked class %s action through its platform login', (action) => {
  const destination = `/auth/platform/class-workspace/${action}?campus=nthu`;
  const href = campusOneLoginHref(new URLSearchParams({ next: destination + '&token=private' }));
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.pathname).toBe('/classroom/login');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
  expect(platformDestination(login.searchParams.get('returnUrl'))).toBe(destination);
});

it.each([
  ['/grades?tab=semester&tab=feedback&campus=pu', '/grades?tab=semester&campus=pu'],
  ['/course/cs101?campus=pu#assignment-hw-1', '/course/cs101?campus=pu#assignment-hw-1'],
])('keeps %s in the school account flow after filtering page state', (requested, destination) => {
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: requested }));
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
  expect(platformDestination(login.searchParams.get('returnUrl'))).toBe('/classroom');
});

it('hands a personal timetable back to Google sign-in with its campus and section intact', () => {
  const destination = '/timetable?campus=nthu#personal-timetable';
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: destination }));
  const login = new URL(href!, 'https://nuni.tw');
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('returnUrl')).toBe(destination);
  expect(login.searchParams.has('reconnect')).toBe(false);
  expect(platformDestination(login.searchParams.get('returnUrl'))).toBe(destination);
});

it.each([
  null,
  '',
  '/',
  '/life',
  '/search',
  '/auth/platform',
  '/auth/platform/class-workspace/join/unknown',
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

it.each([
  ['/connect', 'topics'],
  ['/connect', 'people'],
  ['/connect', 'updates'],
  ['/life', 'travel'],
  ['/life', 'daily'],
  ['/life', 'resources'],
])('returns to %s with its known %s group and campus after sign-in', (page, group) => {
  const path = `${page}?${new URLSearchParams({ campus: 'nthu', group, q: '校園' })}`;
  expect(sanitizeReturnPath(path)).toBe(path);
  expect(platformDestination(path)).toBe(path);
  const href = campusOneLoginHref(new URLSearchParams({ returnUrl: path }));
  expect(new URL(href!, 'https://nuni.tw').searchParams.get('returnUrl')).toBe(path);
});

it('allows only the exchange landing page on the retained plain-page callback', () => {
  expect(sanitizeReturnPath('/connect')).toBe('/connect');
  expect(campusOneLoginHref('returnUrl=%2Fconnect')).toBeNull();
  expect(sanitizeReturnPath('/connect/private')).toBe('/');
  expect(sanitizeReturnPath('/connect-other')).toBe('/');
  expect(platformDestination('/connect/private')).toBe('/classroom');
});

it('drops unknown or cross-section journey groups and unrelated return context', () => {
  expect(sanitizeReturnPath('/connect?group=daily&campus=pu&token=secret&next=%2Fadmin&section=account')).toBe('/connect?campus=pu');
  expect(sanitizeReturnPath('/life?group=topics&q=food&groupId=private')).toBe('/life?q=food');
  expect(sanitizeReturnPath('/connect?group=people&group=topics')).toBe('/connect?group=people');
  expect(sanitizeReturnPath('/grades?group=people')).toBe('/grades');
});

it('preserves bounded journey search text while dropping oversized or unsafe values', () => {
  const valid = `/connect?${new URLSearchParams({ q: '校園'.repeat(50), group: 'topics' })}`;
  expect(sanitizeReturnPath(valid)).toBe(valid);
  expect(sanitizeReturnPath('/connect?q=' + 'x'.repeat(101) + '&group=people')).toBe('/connect?group=people');
  expect(sanitizeReturnPath('/life?q=food%0A&group=daily')).toBe('/life?group=daily');
  expect(sanitizeReturnPath('/connect?q=https%3A%2F%2Fexample.test%2F%3Fnext%3D%2Flogin&group=topics')).toBe('/connect?q=https%3A%2F%2Fexample.test%2F%3Fnext%3D%2Flogin&group=topics');
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
  ['/auth/platform/class-workspace/cw_11111111-1111-4111-8111-111111111111?campus=nthu#materials', '/'],
  ['/auth/platform/ops?create=school#form', '/'],
  ['/auth/platform/school-review?campus=pu', '/auth/platform/school-review'],
 ])('keeps retained account callbacks on their path-only contract: %s', (path, expected) => {
  expect(sanitizeReturnPath(path)).toBe(expected);
  expect(campusOneLoginHref(new URLSearchParams({ returnUrl: path }))).toBeNull();
});

it('filters return context before handing a task to nuni login', () => {
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

it.each([
  [{ authenticated: true, family: 'campus-account' }, true],
  [{ authenticated: true, family: 'oidc' }, false],
  [{ authenticated: true, platformAccountId: 'pa_existing' }, false],
  [{ authenticated: false, family: 'campus-account' }, false],
] as const)('checks only the school BFF session family for staff sign-in', async (session, expected) => {
  fetchMock.mockResolvedValueOnce(Response.json(session));
  await expect(readExistingSession(true)).resolves.toBe(expected);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe('/auth/session');
});

it('treats nuni session as signed in before falling back to /auth/session', async () => {
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


function schoolSearchResponse(schools: unknown[]) {
  return new Response(JSON.stringify({ schools }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

it.each(['pu', ' PU ', ' Ｐ Ｕ ', 'p\tu'])('normalizes code %s and supplements only server-returned schools', async (query) => {
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([]));
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'pu', displayName: '靜宜大學', available: true },
    { tenantId: 'unrelated', displayName: '其他大學', available: true },
  ]));
  await expect(searchSchoolsByName(query)).resolves.toEqual([
    expect.objectContaining({ tenantId: 'pu', available: true }),
  ]);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    '/auth/find-school/search?q=' + encodeURIComponent(query.replace(/\s+/g, '')),
    '/auth/find-school/search?q=' + encodeURIComponent('靜宜大學'),
  ]);
});

it('supplements nccu by its directory name without inventing availability', async () => {
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([]));
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'nccu', displayName: '國立政治大學', available: false, reason: 'school-not-open' },
  ]));
  await expect(searchSchoolsByName('ＮＣＣＵ')).resolves.toEqual([
    expect.objectContaining({ tenantId: 'nccu', available: false, reason: 'school-not-open' }),
  ]);
  expect(fetchMock.mock.calls[1][0]).toBe('/auth/find-school/search?q=' + encodeURIComponent('國立政治大學'));
});

it('uses shared matching and stable exact-code priority for server rows', async () => {
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'ntpu', displayName: '國立臺北大學' },
    { tenantId: 'pu', displayName: '靜宜大學' },
    { tenantId: 'other-pu', displayName: 'PU 分校' },
    { tenantId: 'unrelated', displayName: '其他大學' },
  ]));
  expect((await searchSchoolsByName('P U')).map((row) => row.tenantId)).toEqual(['pu', 'ntpu', 'other-pu']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('matches normalized names, aliases and domains from shared metadata', async () => {
  for (const query of [' 台 大 ', 'ＮＴＵ.ＥＤＵ.ＴＷ', '國立臺灣大學']) {
    fetchMock.mockResolvedValueOnce(schoolSearchResponse([
      { tenantId: 'ntu', displayName: '國立臺灣大學' },
      { tenantId: 'pu', displayName: '靜宜大學' },
    ]));
    expect((await searchSchoolsByName(query)).map((row) => row.tenantId)).toEqual(['ntu']);
  }
});

it('does not supplement an explicit denial or grant availability from the directory', async () => {
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'pu', displayName: '靜宜大學', available: false },
  ]));
  await expect(searchSchoolsByName('pu')).resolves.toEqual([
    expect.objectContaining({ available: false, tenantId: 'pu' }),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([]));
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([{ displayName: '靜宜大學', available: true }]));
  await expect(searchSchoolsByName('pu')).resolves.toEqual([]);
});

it('preserves empty-query directory order and reports endpoint errors', async () => {
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'nccu', displayName: '國立政治大學' },
    { tenantId: 'pu', displayName: '靜宜大學' },
  ]));
  expect((await searchSchoolsByName('　')).map((row) => row.tenantId)).toEqual(['nccu', 'pu']);
  fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  await expect(searchSchoolsByName('pu')).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
  await expect(searchSchoolsByName('pu')).rejects.toMatchObject({ code: 'SCHOOL_SEARCH_FAILED' });
});

// Match the retained endpoint's literal-name ILIKE semantics, without 臺/台 folding.
it.each(['國立臺灣大學', '國立台灣大學', 'NTU', 'pu'])('preserves endpoint spelling for %s', async (query) => {
  const schools = [
    { tenantId: 'ntu', displayName: '國立臺灣大學', status: 'open' },
    { tenantId: 'tw-other', displayName: '國立台灣大學分校', status: 'open' },
    { tenantId: 'pu', displayName: '靜宜大學', status: 'open' },
  ];
  fetchMock.mockImplementation(async (input) => {
    const q = new URL(String(input), 'https://nuni.invalid').searchParams.get('q')!;
    return schoolSearchResponse(schools.filter((school) => school.displayName.toLowerCase().includes(q.toLowerCase())));
  });
  const rows = await searchSchoolsByName(query);
  expect(rows.map((row) => row.tenantId)).toContain(query === 'pu' ? 'pu' : query === '國立台灣大學' ? 'tw-other' : 'ntu');
  expect(new URL(String(fetchMock.mock.calls[0][0]), 'https://nuni.invalid').searchParams.get('q')).toBe(query);
  if (query === 'NTU') {
    expect(new URL(String(fetchMock.mock.calls[1][0]), 'https://nuni.invalid').searchParams.get('q')).toBe('國立臺灣大學');
  }
});

it.each([[false, undefined], [true, undefined], [false, true], [true, true]])('preserves status denial (supplement: %s, available: %s)', async (supplement, available) => {
  if (supplement) fetchMock.mockResolvedValueOnce(schoolSearchResponse([]));
  fetchMock.mockResolvedValueOnce(schoolSearchResponse([
    { tenantId: 'ntpu', displayName: '國立臺北大學', status: 'open' },
    { tenantId: 'pu', displayName: '靜宜大學', status: 'not-open', available, reason: 'school-not-open' },
    { displayName: '靜宜大學', status: 'open', available: true },
  ]));
  const rows = await searchSchoolsByName('pu');
  expect(rows[0]).toMatchObject({ tenantId: 'pu', available: false, reason: 'school-not-open' });
  expect(rows.filter((row) => row.available && row.tenantId).map((row) => row.tenantId)).toEqual(supplement ? [] : ['ntpu']);
  expect(fetchMock).toHaveBeenCalledTimes(supplement ? 2 : 1);
});
