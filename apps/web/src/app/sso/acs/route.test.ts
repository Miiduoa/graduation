// @vitest-environment node
import { expect, it } from 'vitest';
import { GET, POST } from './route';

const acs = 'https://campus.example/sso/acs';

it('rejects oversized SAML forms without rendering their contents', async () => {
  const body = new URLSearchParams({ SAMLResponse: 'a'.repeat(256 * 1024) });
  const response = await POST(new Request(acs, { method: 'POST', body }));
  expect(response.status).toBe(413);
  expect(await response.text()).not.toContain('window.name');
});

it.each(['urlencoded', 'multipart'])('accepts a normal %s SAML response', async (encoding) => {
  const body = encoding === 'urlencoded' ? new URLSearchParams() : new FormData();
  body.set('SAMLResponse', 'synthetic-assertion');
  body.set('RelayState', '/sso-callback?tx_state=example');
  const response = await POST(new Request(acs, { method: 'POST', body }));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('synthetic-assertion');
  expect(html).toContain('https://campus.example/sso-callback?tx_state=example');
});

it('returns a no-store redirect for a GET without an assertion', async () => {
  const response = await GET(new Request(acs));
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('https://campus.example/sso-callback');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
