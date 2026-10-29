// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryNonceStore, handleRelayRequest } from './index';
import {
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  sha256Hex,
  signRelayRequest,
} from './protocol';

const RELAY_URL = 'https://pu-edge-relay.example.workers.dev';
const SECRET = 'unit-test-secret';
const FIXED_NONCE = '0123456789abcdef0123456789abcdef';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signedRelayRequest(
  target: string,
  init: RequestInit = {},
  nowMs = Date.now(),
  nonce = FIXED_NONCE,
) {
  const method = String(init.method || 'GET').toUpperCase();
  const timestamp = String(Math.floor(nowMs / 1000));
  const headers = new Headers(init.headers);
  const bodyText = typeof init.body === 'string' ? init.body : '';
  const bodySha256 = await sha256Hex(new TextEncoder().encode(bodyText));
  const signature = await signRelayRequest(SECRET, {
    timestamp,
    nonce,
    method,
    target,
    bodySha256,
    cookie: headers.get('cookie') ?? '',
    contentType: headers.get('content-type') ?? '',
  });
  headers.set(RELAY_TS_HEADER, timestamp);
  headers.set(RELAY_NONCE_HEADER, nonce);
  headers.set(RELAY_SIGN_HEADER, signature);
  headers.set(RELAY_TARGET_HEADER, target);
  return new Request(RELAY_URL, { ...init, method, headers });
}

function requestWithPlacement(request: Request, placement: string): Request {
  return new Proxy(request, {
    get(target, prop, receiver) {
      if (prop === 'headers') {
        const headers = new Headers(target.headers);
        headers.set('cf-placement', placement);
        return headers;
      }
      if (prop === 'arrayBuffer') return () => target.arrayBuffer();
      if (prop === 'clone') return () => requestWithPlacement(target.clone(), placement);
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

it('returns 404 without a valid signature', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  vi.stubGlobal('fetch', upstream);
  const response = await handleRelayRequest(
    new Request(RELAY_URL, { method: 'GET' }),
    { RELAY_SECRET: SECRET },
    Date.now(),
    createMemoryNonceStore(),
  );
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('rejects hosts outside the allowlist with 404', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  vi.stubGlobal('fetch', upstream);
  const request = await signedRelayRequest('https://evil.example/steal');
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('rejects stale timestamps', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  vi.stubGlobal('fetch', upstream);
  const request = await signedRelayRequest(
    'https://alcat.pu.edu.tw/',
    { method: 'GET' },
    Date.parse('2020-01-01T00:00:00Z'),
  );
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('returns 404 when the body is changed after signing', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  vi.stubGlobal('fetch', upstream);
  const signed = await signedRelayRequest('https://alcat.pu.edu.tw/index_check.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'uid=1110700321&upassword=secret',
  });
  const tampered = new Request(signed, { body: 'uid=1110700321&upassword=changed' });
  const response = await handleRelayRequest(tampered, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('returns 404 when the Cookie header is changed after signing', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  vi.stubGlobal('fetch', upstream);
  const signed = await signedRelayRequest('https://mypu.pu.edu.tw/score_query/score_all.php', {
    method: 'GET',
    headers: { Cookie: 'PHPSESSID=mypu' },
  });
  const headers = new Headers(signed.headers);
  headers.set('Cookie', 'PHPSESSID=stolen');
  const tampered = new Request(signed, { headers });
  const response = await handleRelayRequest(tampered, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('returns 404 when the same nonce is replayed inside the window', async () => {
  const upstream = vi.fn(async () => new Response('ok'));
  vi.stubGlobal('fetch', upstream);
  const store = createMemoryNonceStore();
  const first = await signedRelayRequest('https://alcat.pu.edu.tw/', { method: 'GET' }, Date.now(), FIXED_NONCE);
  const second = await signedRelayRequest('https://alcat.pu.edu.tw/', { method: 'GET' }, Date.now(), FIXED_NONCE);
  expect((await handleRelayRequest(first, { RELAY_SECRET: SECRET }, Date.now(), store)).status).toBe(200);
  expect((await handleRelayRequest(second, { RELAY_SECRET: SECRET }, Date.now(), store)).status).toBe(404);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('forwards method, cookies, body, multiple Set-Cookie, Location, and execution placement', async () => {
  const logs: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((message) => {
    logs.push(String(message));
  });
  const upstream = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://identity.pu.edu.tw/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('cookie')).toBe('SESSION=from-client');
    expect(headers.get(RELAY_SIGN_HEADER)).toBeNull();
    expect(headers.get(RELAY_TARGET_HEADER)).toBeNull();
    expect(headers.get(RELAY_NONCE_HEADER)).toBeNull();
    const out = new Headers();
    out.append('Set-Cookie', 'a=1; Path=/; HttpOnly');
    out.append('Set-Cookie', 'b=2; Path=/');
    out.set('Location', 'https://tronclass.pu.edu.tw/user/index');
    return new Response(null, { status: 302, headers: out });
  });
  vi.stubGlobal('fetch', upstream);
  const request = requestWithPlacement(
    await signedRelayRequest('https://identity.pu.edu.tw/auth/login', {
      method: 'POST',
      headers: { Cookie: 'SESSION=from-client', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=s1110700321&password=secret',
    }),
    'remote-TPE',
  );
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('https://tronclass.pu.edu.tw/user/index');
  expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/']);
  expect(response.headers.get(RELAY_COLO_HEADER)).toBe('remote-TPE');
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(logs.join('\n')).not.toMatch(/password|SESSION=from-client|username=/i);
  const payload = JSON.parse(logs[0] || '{}') as Record<string, unknown>;
  expect(payload).toMatchObject({
    msg: 'pu_edge_relay',
    host: 'identity.pu.edu.tw',
    path: '/auth/login',
    status: 302,
    colo: 'remote-TPE',
  });
  expect(payload).not.toHaveProperty('placement_miss');
  expect(payload).not.toHaveProperty('search');
  log.mockRestore();
});

it('marks placement_miss when execution is not near Taiwan', async () => {
  const logs: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((message) => {
    logs.push(String(message));
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
  const request = requestWithPlacement(
    await signedRelayRequest('https://alcat.pu.edu.tw/', { method: 'GET' }, Date.now(), 'fedcba9876543210fedcba9876543210'),
    'remote-NRT',
  );
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(200);
  expect(response.headers.get(RELAY_COLO_HEADER)).toBe('remote-NRT');
  expect(JSON.parse(logs[0] || '{}')).toMatchObject({
    colo: 'remote-NRT',
    placement_miss: true,
  });
  log.mockRestore();
});

it('accepts nested pu.edu.tw hosts and keeps redirect manual', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response('html', { status: 200 }));
  vi.stubGlobal('fetch', upstream);
  const request = await signedRelayRequest('https://webpacx.lib.pu.edu.tw/search');
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('html');
  expect(upstream.mock.calls[0]?.[1]?.redirect).toBe('manual');
});

it('normalizes trailing-dot FQDN targets before forwarding', async () => {
  const upstream = vi.fn(async (url: string) => {
    expect(url).toBe('https://alcat.pu.edu.tw/index_check.php');
    return new Response('ok');
  });
  vi.stubGlobal('fetch', upstream);
  const request = await signedRelayRequest('https://alcat.pu.edu.tw./index_check.php');
  const response = await handleRelayRequest(request, { RELAY_SECRET: SECRET }, Date.now(), createMemoryNonceStore());
  expect(response.status).toBe(200);
});
