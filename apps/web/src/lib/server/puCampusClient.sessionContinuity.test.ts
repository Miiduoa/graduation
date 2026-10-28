// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPuCampusGateway, type CampusLoginRoute } from './puCampusClient';

const account = '412345678';
const password = 'fixture-password';
const identity = { id: 44, login_name: account, name: '測試同學', role: 'student' };
function json(body: unknown, cookies: string[] = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  cookies.forEach((value) => headers.append('Set-Cookie', value));
  return new Response(JSON.stringify(body), { status: 200, headers });
}
function school(profileCookies: string[], profile = identity) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) return json(identity, ['session=before; Path=/; Secure', 'csrf=one; Path=/']);
    if (url.endsWith('/api/profile')) {
      expect(new Headers(init?.headers).get('Cookie')).toContain('session=before');
      return json(profile, profileCookies);
    }
    if (url.endsWith('/api/my-courses')) return json({ courses: [{ name: '資料庫', role: 'student' }] });
    throw new Error('Unexpected school request');
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('verified school session continuity', () => {
  it.each(['student', 'teacher'] as CampusLoginRoute[])('uses the profile-verified rotation for the next course read: %s', async (route) => {
    const fetch = school(['session=verified==; Path=/; Secure; HttpOnly', 'csrf=two; Path=/']);
    const gateway = createPuCampusGateway({ fetch });
    const session = await gateway.loginTronClass(account, password, { route });
    expect(session.cookies).toEqual({ session: 'verified==', csrf: 'two' });
    await gateway.fetchTronClassCourses(session);
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get('Cookie')).toBe('session=verified==; csrf=two');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://tronclass.pu.edu.tw/api/login', 'https://tronclass.pu.edu.tw/api/profile',
      'https://tronclass.pu.edu.tw/api/my-courses',
    ]);
  });

  it.each([
    'session=; Path=/',
    'session=revoked; Max-Age=0; Path=/',
    'session=revoked; mAx-AgE=-1; Path=/',
    'session=revoked; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    'session=revoked; Max-Age=0; Expires=Wed, 01 Jan 2098 00:00:00 GMT',
  ])('does not accept a removed session from a successful profile response: %s', async (cookie) => {
    const fetch = school([cookie]);
    await expect(createPuCampusGateway({ fetch }).loginTronClass(account, password))
      .rejects.toMatchObject({ kind: 'credentials', stage: 'verify' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses positive Max-Age in preference to a past Expires date', async () => {
    const fetch = school(['session=verified; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
    expect((await createPuCampusGateway({ fetch }).loginTronClass(account, password)).cookies.session).toBe('verified');
  });
  it('keeps the login session when the verified profile does not replace it', async () => {
    const fetch = school([]);
    expect((await createPuCampusGateway({ fetch }).loginTronClass(account, password)).cookies)
      .toEqual({ session: 'before', csrf: 'one' });
  });
  it('removes unrelated expired cookies without losing the verified session', async () => {
    const fetch = school(['csrf=removed; Max-Age=0', 'session=verified; Path=/']);
    expect((await createPuCampusGateway({ fetch }).loginTronClass(account, password)).cookies)
      .toEqual({ session: 'verified' });
  });
  it('does not convert an invalid expiry attribute into an immediate logout', async () => {
    const fetch = school(['session=verified; Max-Age=unknown; Expires=not-a-date']);
    expect((await createPuCampusGateway({ fetch }).loginTronClass(account, password)).cookies.session).toBe('verified');
  });
  it('still rejects another account even when its profile rotates a session', async () => {
    const fetch = school(['session=another; Path=/'], { ...identity, login_name: 'different-account' });
    await expect(createPuCampusGateway({ fetch }).loginTronClass(account, password))
      .rejects.toMatchObject({ kind: 'credentials' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never reaches the profile or courses when login explicitly expires its session', async () => {
    const fetch = vi.fn(async () => json(identity, ['session=before; Max-Age=0']));
    await expect(createPuCampusGateway({ fetch }).loginTronClass(account, password)).rejects.toMatchObject({ kind: 'credentials' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
