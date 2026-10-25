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
  expect(screen.getByRole('heading', { name: '登入' })).toBeTruthy();
  expect(screen.getByText('請用學校核發的帳號登入。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '登入校園帳號' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: '用 Google 繼續' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '尋找學校' }).getAttribute('href')).toBe('/auth/find-school');
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
  expect(screen.queryByRole('button', { name: '用 Google 繼續' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '登入校園帳號' }));
  fireEvent.change(screen.getByLabelText('學校配發的信箱'), { target: { value: 'student@pu.edu.tw' } });
  fireEvent.click(screen.getByRole('button', { name: '找到我的學校' }));
  expect(await screen.findByRole('heading', { name: '靜宜大學' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '使用學校 Google 帳號' })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/v1/auth/account/registration-start'))).toBe(true);
});
