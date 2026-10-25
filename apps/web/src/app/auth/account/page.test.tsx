import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AccountPage from './page';

const fetchMock = vi.fn<typeof fetch>();
const search = { current: new URLSearchParams() };

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
    if (url === '/auth/find-school/search') {
      return new Response(
        JSON.stringify({
          schools: [{ available: true, tenantId: 'tenant-1', displayName: '靜宜大學', providerKinds: ['google-workspace'] }],
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
  expect(fetchMock.mock.calls.some(([url, init]) => url === '/auth/find-school/search' && init?.method === 'POST')).toBe(
    true,
  );
});

it('sends a signed-in visitor to the allowed return path without showing the form', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, origin: 'https://nuni.tw' });
  search.current = new URLSearchParams('returnUrl=/life');
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
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/life'));
  expect(screen.queryByRole('button', { name: '登入校園帳號' })).toBeNull();
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

