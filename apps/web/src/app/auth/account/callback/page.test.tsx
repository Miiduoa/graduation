import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ACCOUNT_EXPIRES_AT_KEY,
  ACCOUNT_LOGIN_TRANSACTION_KEY,
  AUTH_SOURCE_KEY,
  PLATFORM_LOGIN_TRANSACTION_KEY,
  completeSchoolCallback,
  startSchoolProvider,
} from '../legacyLogin';
import SchoolAccountCallbackPage from './page';

const origin = 'https://nuni.tw';
const callback = origin + '/auth/account/callback';
const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
const replace = vi.fn();
const returnPath = '/teacher?schoolId=pu';
const state = 's'.repeat(43);
const verifier = 'v'.repeat(43);

function schoolStart(kind: string) {
  return {
    tenantId: 'pu',
    kind,
    clientKind: 'web',
    clientId: kind === 'google-workspace'
      ? 'school.apps.googleusercontent.com'
      : '00000000-0000-4000-8000-000000000001',
    issuer: kind === 'google-workspace'
      ? 'https://accounts.google.com'
      : 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0',
    nonce: 'n'.repeat(48),
    scopes: ['openid', 'email', 'profile'],
    expiresInSeconds: 600,
  };
}

function savePending(changes: Record<string, unknown> = {}) {
  sessionStorage.setItem(ACCOUNT_LOGIN_TRANSACTION_KEY, JSON.stringify({
    ...schoolStart('google-workspace'), state, codeVerifier: verifier,
    redirectUri: callback, createdAt: Date.now(), returnPath, ...changes,
  }));
}

function setCallback(search: string) {
  vi.stubGlobal('location', { origin, href: callback + search, search, replace, assign });
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem(PLATFORM_LOGIN_TRANSACTION_KEY, 'unrelated-platform-transaction');
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setCallback('');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(['google-workspace', 'microsoft-entra'])('finishes a %s sign-in through the school BFF once', async (kind) => {
  fetchMock.mockResolvedValueOnce(Response.json(schoolStart(kind)));
  await startSchoolProvider('pu', kind, returnPath);
  const authUrl = new URL(assign.mock.calls[0][0]);
  expect(authUrl.searchParams.get('redirect_uri')).toBe(callback);
  const pending = JSON.parse(sessionStorage.getItem(ACCOUNT_LOGIN_TRANSACTION_KEY)!);
  expect(authUrl.searchParams.get('state')).toBe(pending.state);
  fetchMock.mockClear().mockResolvedValueOnce(Response.json({ authenticated: true, expiresIn: 900 }));
  setCallback('?' + new URLSearchParams({ code: 'provider-code', state: pending.state }));
  render(<StrictMode><SchoolAccountCallbackPage /></StrictMode>);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(returnPath));
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/auth/account/token');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    grantType: 'exchange', code: 'provider-code', codeVerifier: pending.codeVerifier,
  });
  expect(sessionStorage.getItem(ACCOUNT_LOGIN_TRANSACTION_KEY)).toBeNull();
  expect(sessionStorage.getItem(PLATFORM_LOGIN_TRANSACTION_KEY)).toBe('unrelated-platform-transaction');
  expect(sessionStorage.getItem(AUTH_SOURCE_KEY)).toBe('campus-account');
  expect(Number(sessionStorage.getItem(ACCOUNT_EXPIRES_AT_KEY))).toBeGreaterThan(Date.now());
  await expect(completeSchoolCallback(window.location.href)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each([
  ['state mismatch', '?state=wrong&code=a', {}],
  ['two states', `?state=${state}&state=${state}&code=a`, {}],
  ['two codes', `?state=${state}&code=a&code=b`, {}],
  ['consent cancelled', `?state=${state}&error=access_denied&error_description=private-provider-text`, {}],
  ['expired transaction', `?state=${state}&code=a`, { createdAt: Date.now() - 601000 }],
  ['invalid PKCE verifier', `?state=${state}&code=a`, { codeVerifier: 'invalid' }],
  ['platform transaction', `?state=${state}&code=a`, { kind: 'google-consumer' }],
  ['other callback origin', `?state=${state}&code=a`, { redirectUri: 'https://example.test/auth/account/callback' }],
] as const)('offers a fresh school login after %s without exchanging or adopting another session', async (_, search, changes) => {
  savePending(changes);
  setCallback(search);
  render(<SchoolAccountCallbackPage />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).not.toContain('private-provider-text');
  expect(screen.getByRole('link').getAttribute('href')).toBe('/auth/account?method=school');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(AUTH_SOURCE_KEY)).toBeNull();
  expect(sessionStorage.getItem(PLATFORM_LOGIN_TRANSACTION_KEY)).toBe('unrelated-platform-transaction');
});

it.each([
  [403, { error: 'private-reason' }],
  [200, { authenticated: false, expiresIn: 900, isPlatformOperator: true }],
] as const)('requires successful school verification before continuing (%i)', async (status, body) => {
  savePending();
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
  await expect(completeSchoolCallback(`${callback}?state=${state}&code=a`)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(AUTH_SOURCE_KEY)).toBeNull();
  expect(sessionStorage.getItem(PLATFORM_LOGIN_TRANSACTION_KEY)).toBe('unrelated-platform-transaction');
});
