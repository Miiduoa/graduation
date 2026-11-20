import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolAccountPage from './page';

const request = vi.fn<typeof fetch>();
const current = { authenticated: true, family: 'campus-account', sessionContext: 'school-session-a' };
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  [401, { authenticated: false }],
  [200, { authenticated: true }],
  [200, { authenticated: true, family: 'platform-account' }],
] as const)('requires a verified school session (%s %j)', async (status, body) => {
  request.mockResolvedValueOnce(answer(body, status));
  render(<SchoolAccountPage />);
  expect((await screen.findByRole('link', { name: '使用校方帳號登入' })).getAttribute('href')).toBe('/auth/account?method=school');
  expect(screen.queryByText('已登入校方帳號')).toBeNull();
  expect(screen.queryByRole('button', { name: /登出/ })).toBeNull();
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/auth/session']);
});

it('retries an unavailable session and shows only school actions', async () => {
  request.mockResolvedValueOnce(answer({}, 503)).mockResolvedValueOnce(answer(current));
  render(<SchoolAccountPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('無法確認校方帳號');
  fireEvent.click(screen.getByRole('button', { name: '重新查詢' }));
  expect((await screen.findByRole('link', { name: '查看學校資訊與官網' })).getAttribute('href')).toBe('/school-info');
  expect(screen.queryByRole('link', { name: /管理台/ })).toBeNull();
});

it('confirms revocation with a fresh school-session read before offering another login', async () => {
  request.mockResolvedValueOnce(answer(current)).mockResolvedValueOnce(answer(current))
    .mockResolvedValueOnce(answer({ revoked: true })).mockResolvedValueOnce(answer({ authenticated: false }, 401));
  render(<SchoolAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: /登出或切換/ }));
  await screen.findByRole('link', { name: '使用校方帳號登入' });
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/auth/session', '/auth/session', '/auth/account/token', '/auth/session']);
  expect(request.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ grantType: 'logout' }) });
});

it.each([
  [{ revoked: false }, { authenticated: false }],
  [{ revoked: true }, current],
])('keeps an unconfirmed logout out of the signed-out state', async (receipt, afterLogout) => {
  request.mockResolvedValueOnce(answer(current)).mockResolvedValueOnce(answer(current))
    .mockResolvedValueOnce(answer(receipt)).mockResolvedValueOnce(answer(afterLogout));
  render(<SchoolAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: /登出或切換/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('尚未確認登出結果');
  expect(screen.queryByRole('link', { name: '使用校方帳號登入' })).toBeNull();
});

it.each([
  ['school-session-a', 'school-session-b'],
  [null, null],
])('never posts a logout without a matching active session context (%j to %j)', async (before, after) => {
  request.mockResolvedValueOnce(answer({ ...current, sessionContext: before }))
    .mockResolvedValueOnce(answer({ ...current, sessionContext: after }));
  render(<SchoolAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: /登出或切換/ }));
  await screen.findByRole('alert');
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/auth/session', '/auth/session']);
});

it('resumes a pending school logout after reloading the page', async () => {
  const pending = { authenticated: false, logoutPending: true, family: 'campus-account' };
  request.mockResolvedValueOnce(answer(pending, 401)).mockResolvedValueOnce(answer(pending, 401))
    .mockResolvedValueOnce(answer({ revoked: true })).mockResolvedValueOnce(answer({ authenticated: false }, 401));
  render(<SchoolAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重試登出校方帳號' }));
  await screen.findByRole('link', { name: '使用校方帳號登入' });
  expect(request.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ grantType: 'logout' }) });
});
