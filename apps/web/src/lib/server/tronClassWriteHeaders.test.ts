// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { tronClassSchoolWriteHeaders } from './tronClassWriteHeaders';

// Synthetic cookies exercise the public client's request serialization only.
// They are not proof of a school session or a successful write.
const binding = (cookies: Record<string, string>): TronClassSubmissionBinding => ({
  schoolId: 'pu', account: 'synthetic', userId: 30, userName: null,
  revision: 'a'.repeat(32), expiresAt: '2026-11-18T12:00:00.000Z', cookies,
});

describe('PU school write headers from the official Angular client', () => {
  it.each([undefined, ''])('omits an absent or empty optional token: %j', token => {
    const cookies: Record<string, string> = { session: 'synthetic-session' };
    if (token !== undefined) cookies['XSRF-TOKEN'] = token;
    const headers = tronClassSchoolWriteHeaders(binding(cookies));
    expect(headers.get('Cookie')).toContain('session=synthetic-session');
    expect(headers.has('X-XSRF-TOKEN')).toBe(false);
    expect(headers.get('Origin')).toBe('https://tronclass.pu.edu.tw');
    expect(headers.get('Referer')).toBe('https://tronclass.pu.edu.tw/');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('URL-decodes the nonempty cookie once without changing the Cookie header', () => {
    const headers = tronClassSchoolWriteHeaders(binding({ session: 'synthetic-session', 'XSRF-TOKEN': 'token%2Bwith%252Fvalue' }));
    expect(headers.get('X-XSRF-TOKEN')).toBe('token+with%2Fvalue');
    expect(headers.get('Cookie')).toContain('XSRF-TOKEN=token%2Bwith%252Fvalue');
  });

  it.each([
    { session: 'bad; other=secret' }, { session: 'bad\r\nHeader: injected' },
    { session: 'synthetic', 'XSRF-TOKEN': '%xx' },
    { session: 'synthetic', 'XSRF-TOKEN': 'bad%0d%0aheader' },
    { session: 'synthetic', 'XSRF-TOKEN': 'token%20space' },
    { session: 'synthetic', 'XSRF-TOKEN': 'x'.repeat(4097) },
    {}, Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`cookie${index}`, 'value'])),
    { session: 'x'.repeat(32 * 1024) },
  ])('rejects malformed session material before any transport is possible', cookies => {
    expect(() => tronClassSchoolWriteHeaders(binding(cookies))).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });

  it('does not take a token from an inherited cookie property', () => {
    const cookies = Object.assign(Object.create({ 'XSRF-TOKEN': 'inherited-token' }), { session: 'synthetic' });
    expect(() => tronClassSchoolWriteHeaders(binding(cookies))).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });
});
