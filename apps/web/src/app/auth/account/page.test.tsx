import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniSignIn } from '@/components/NuniSignIn';
import AccountPage from './page';

const fetchMock = vi.fn<typeof fetch>();
const search = { current: new URLSearchParams() };
const platform = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string },
  loading: false,
  pendingLogout: false,
  error: '',
  refresh: vi.fn(),
  logout: vi.fn(),
  request: vi.fn(),
}));

vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => platform,
  browserRequest: platform.request,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.current,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  search.current = new URLSearchParams();
  platform.session = null;
  platform.request.mockReset().mockResolvedValue({ google: true });
  sessionStorage.clear();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/nuni/session' || url === '/auth/session') {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/auth/platform/providers') {
      return new Response(JSON.stringify({ kinds: ['google-consumer'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  });
});

it('shows the unsigned entry without the old preview card or long copy', async () => {
  render(<AccountPage />);
  expect(await screen.findByRole('button', { name: '登入校園帳號' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '登入' })).toBeTruthy();
  expect(screen.getByText('請用學校核發的帳號登入。')).toBeTruthy();
  expect(await screen.findByRole('button', { name: '用 Google 繼續' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '尋找學校' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '尋找學校' })).toBeNull();
  expect(screen.getByRole('link', { name: '課班／教學' }).getAttribute('href')).toBe(
    '/auth/platform/class-workspace/join',
  );
  expect(screen.getByRole('link', { name: '隱私資訊' }).getAttribute('href')).toBe('/privacy');
  expect(screen.getByRole('link', { name: '服務條款' }).getAttribute('href')).toBe('/terms');
  expect(screen.getByRole('link', { name: '使用支援' }).getAttribute('href')).toBe('/support');
  expect(screen.getByRole('link', { name: '帳號刪除／停用' }).getAttribute('href')).toBe('/account-deletion');
  expect(screen.queryByText('示意')).toBeNull();
  expect(screen.queryByText('資料庫系統')).toBeNull();
  expect(screen.queryByText('商院 305 · 第 3 節')).toBeNull();
  expect(screen.queryByText('課表、請假、點餐，先看今天。')).toBeNull();
  expect(
    screen.queryByText(/學生、教職員與合作店家都要核發後的身分才能登入/),
  ).toBeNull();
  expect(screen.queryByText(/學校還沒開通時，仍可用課班上課/)).toBeNull();
  expect(screen.queryByLabelText('示意')).toBeNull();
});

it('keeps Google continue on the existing platform token start', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign, origin: 'https://nuni.tw' });
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/nuni/session' || url === '/auth/session') {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/auth/platform/providers') {
      return new Response(JSON.stringify({ kinds: ['google-consumer'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/auth/platform/token') {
      return new Response(
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
      );
    }
    return new Response('{}', { status: 404 });
  });
  render(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: '用 Google 繼續' }));
  await waitFor(() => expect(assign).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls.some(([url, init]) => url === '/auth/platform/token' && init?.method === 'POST')).toBe(
    true,
  );
  expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/auth/platform/token')?.[1]?.body))).toEqual({
    grantType: 'start',
    kind: 'google-consumer',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/platform/start'))).toBe(false);
});

it('opens the school-email form from 登入校園帳號 and looks up the school on the existing API', async () => {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/nuni/session' || url === '/auth/session') {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/auth/platform/providers') {
      return new Response(JSON.stringify({ kinds: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/v1/auth/account/registration-start')) {
      return new Response(
        JSON.stringify({
          available: true,
          tenantId: 'tenant-1',
          displayName: '靜宜大學',
          providerKinds: ['google-workspace'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  });
  render(<AccountPage />);
  expect(await screen.findByRole('button', { name: '登入校園帳號' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '用 Google 繼續' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '登入校園帳號' }));
  fireEvent.change(screen.getByLabelText('學校配發的信箱'), { target: { value: 'student@pu.edu.tw' } });
  fireEvent.click(screen.getByRole('button', { name: '找到我的學校' }));
  expect(await screen.findByRole('heading', { name: '靜宜大學' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '使用學校 Google 帳號' })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/v1/auth/account/registration-start'))).toBe(true);
});

it('opens an in-page school lookup from 尋找學校 and searches by school name', async () => {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/nuni/session' || url === '/auth/session') {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/auth/platform/providers') {
      return new Response(JSON.stringify({ kinds: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/auth/find-school/search?')) {
      const parsed = new URL(url, 'https://nuni.invalid');
      expect(parsed.pathname).toBe('/auth/find-school/search');
      expect(parsed.searchParams.get('q')).toBe('靜宜大學');
      if (init?.method === 'POST') {
        return new Response('', { status: 405, statusText: 'Method Not Allowed' });
      }
      return new Response(
        JSON.stringify({
          schools: [{ tenantId: 'pu', displayName: '靜宜大學', status: 'open' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  });
  render(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: '尋找學校' }));
  fireEvent.change(screen.getByLabelText('學校配發的信箱或校名'), { target: { value: '靜宜大學' } });
  fireEvent.click(screen.getByRole('button', { name: '找到我的學校' }));
  expect(await screen.findByRole('heading', { name: '靜宜大學' })).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        url === '/auth/find-school/search?q=' + encodeURIComponent('靜宜大學') && init?.method !== 'POST',
    ),
  ).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it.each([
  '/life',
  '/grades?tab=feedback&campus=pu',
  '/course/cs101?schoolId=pu#assignment-hw-3',
  '/events/open-day?schoolId=nchu&source=campus',
  '/grades?tab=feedback&schoolId=nthu&campus=nthu#feedback',
  '/settings?section=appearance&campus=nthu',
  '/events/evt-1?schoolId=pu&campus=pu&source=school-club-events#registration',
  '/school-info?campus=ncku#contact',
  '/admin/ops#people',
  '/admin/school-review#pending',
])('sends a signed-in visitor back to %s without losing task context', async (returnPath) => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, origin: 'https://nuni.tw' });
  search.current = new URLSearchParams({ returnUrl: returnPath });
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/nuni/session') {
      return new Response(JSON.stringify({ authenticated: true, platformAccountId: 'pa_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const entry = render(<AccountPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: '登入校園帳號' })).toBeNull();
  if (returnPath === '/life') {
    expect(replace).toHaveBeenCalledWith(returnPath);
  } else {
    const handoff = new URL(replace.mock.calls[0][0], 'https://nuni.tw');
    expect(handoff.pathname).toBe('/login');
    expect(handoff.searchParams.get('returnUrl')).toBe(returnPath);
    entry.unmount();
    platform.session = { platformAccountId: 'pa_1' };
    render(<NuniSignIn returnUrl={handoff.searchParams.get('returnUrl')!} />);
    expect(screen.getByRole('link', { name: '繼續使用' }).getAttribute('href')).toBe(
      returnPath.startsWith('/course/') ? '/classroom' : returnPath,
    );
  }
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])('preserves feedback context through the Campus One login handoff (signed in: %s, auth payload: %s)', async (signedIn, withAuthPayload) => {
  const destination = '/grades?tab=feedback&campus=nthu&q=a%26b%3Dc#recent';
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, origin: 'https://nuni.tw' });
  search.current = new URLSearchParams({
    returnUrl: withAuthPayload
      ? destination.replace('#recent', '&token=private&returnUrl=%2Flogin#recent')
      : destination,
    next: '/timetable',
  });
  platform.session = signedIn ? { platformAccountId: 'pa_1' } : null;
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    authenticated: signedIn,
    platformAccountId: signedIn ? 'pa_1' : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  const entry = render(<AccountPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledOnce());
  const handoff = new URL(replace.mock.calls[0][0], 'https://nuni.tw');
  expect(handoff.pathname).toBe('/login');
  expect(handoff.searchParams.get('returnUrl')).toBe(destination);
  expect(screen.queryByRole('button', { name: '登入校園帳號' })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  entry.unmount();

  render(<NuniSignIn returnUrl={handoff.searchParams.get('returnUrl')!} />);
  if (signedIn) {
    expect(screen.getByRole('link', { name: '繼續使用' }).getAttribute('href')).toBe(destination);
    expect(platform.request).not.toHaveBeenCalled();
  } else {
    const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
    const action = new URL(button.closest('form')!.action);
    expect(action.pathname).toBe('/auth/platform/start');
    expect(action.searchParams.get('returnUrl')).toBe(destination);
    expect(sessionStorage.getItem('campus.platform-login.transaction')).toBeNull();
  }
});

it.each([
  ['/auth/platform/ops?tab=review', '/auth/platform/ops'],
  ['/auth/platform/ops?create=school#form', '/'],
])('keeps the legacy operator destination on its existing session flow: %s', async (destination, expected) => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, origin: 'https://nuni.tw' });
  search.current = new URLSearchParams({ returnUrl: destination });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ authenticated: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  render(<AccountPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
  expect(fetchMock).toHaveBeenCalledWith('/api/nuni/session', expect.anything());
});

it('drops a missing old return path when taking a signed-in visitor home', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, origin: 'https://nuni.tw' });
  search.current = new URLSearchParams('returnUrl=/staff');
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/nuni/session') {
      return new Response(JSON.stringify({ authenticated: true, platformAccountId: 'pa_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  render(<AccountPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
});

