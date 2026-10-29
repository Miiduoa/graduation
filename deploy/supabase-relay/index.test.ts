// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createMemoryNonceStore,
  handleSupabaseRelayRequest,
  resetSupabaseRelaySecretCache,
} from './index';
import {
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  sha256Hex,
  signRelayRequest,
} from '../edge-relay/src/protocol';

const RELAY_URL = 'https://alt-relay.example.supabase.co/functions/v1/pu-edge-relay';
const SECRET = 'unit-test-secret';
const FIXED_NONCE = '0123456789abcdef0123456789abcdef';

afterEach(() => {
  vi.restoreAllMocks();
  resetSupabaseRelaySecretCache();
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

it('returns 404 without a valid HMAC signature and does not require a JWT', async () => {
  const upstream = vi.fn(async () => new Response('should-not-run'));
  const response = await handleSupabaseRelayRequest(new Request(RELAY_URL, { method: 'GET' }), {
    secret: SECRET,
    fetch: upstream as unknown as typeof fetch,
    nonceStore: createMemoryNonceStore(),
  });
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it('forwards a signed campus request without an Authorization JWT', async () => {
  const logs: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((message) => logs.push(String(message)));
  const upstream = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://alcat.pu.edu.tw/index_check.php');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('cookie')).toBe('SID=abc');
    expect(headers.get(RELAY_SIGN_HEADER)).toBeNull();
    expect(headers.get('authorization')).toBeNull();
    const out = new Headers();
    out.append('Set-Cookie', 'a=1; Path=/');
    out.append('Set-Cookie', 'b=2; Path=/');
    return new Response('ok', { status: 200, headers: out });
  });
  const request = await signedRelayRequest('https://alcat.pu.edu.tw/index_check.php', {
    method: 'POST',
    headers: { Cookie: 'SID=abc', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'uid=1110700321&upassword=secret',
  });
  const response = await handleSupabaseRelayRequest(request, {
    secret: SECRET,
    fetch: upstream as unknown as typeof fetch,
    nonceStore: createMemoryNonceStore(),
    region: 'ap-northeast-1',
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('ok');
  expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  expect(response.headers.get(RELAY_COLO_HEADER)).toBe('supabase-ap-northeast-1');
  expect(logs.join('\n')).not.toMatch(/password|SID=abc|unit-test-secret/i);
  expect(JSON.parse(logs[0] || '{}')).toMatchObject({
    msg: 'pu_edge_relay',
    host: 'alcat.pu.edu.tw',
    path: '/index_check.php',
    status: 200,
    colo: 'supabase-ap-northeast-1',
  });
  log.mockRestore();
});

it('loads the HMAC secret from Vault RPC and caches it', async () => {
  const vault = vi.fn(async (url: string) => {
    if (String(url).endsWith('/rest/v1/rpc/pu_edge_relay_secret')) {
      return new Response(JSON.stringify(SECRET), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('ok');
  });
  const first = await handleSupabaseRelayRequest(
    await signedRelayRequest('https://mypu.pu.edu.tw/score_query/score_all.php'),
    {
      fetch: vault as unknown as typeof fetch,
      nonceStore: createMemoryNonceStore(),
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-test-key',
    },
  );
  expect(first.status).toBe(200);
  expect(vault.mock.calls[0]?.[0]).toBe('https://example.supabase.co/rest/v1/rpc/pu_edge_relay_secret');
  const second = await handleSupabaseRelayRequest(
    await signedRelayRequest(
      'https://mypu.pu.edu.tw/score_query/score_all.php',
      {},
      Date.now(),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ),
    {
      fetch: vault as unknown as typeof fetch,
      nonceStore: createMemoryNonceStore(),
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-test-key',
    },
  );
  expect(second.status).toBe(200);
  const vaultCalls = vault.mock.calls.filter((call) =>
    String(call[0]).includes('/rpc/pu_edge_relay_secret'),
  );
  expect(vaultCalls).toHaveLength(1);
});

it('rejects hosts outside the allowlist and replayed nonces', async () => {
  const upstream = vi.fn(async () => new Response('ok'));
  const store = createMemoryNonceStore();
  const blocked = await handleSupabaseRelayRequest(
    await signedRelayRequest('https://evil.example/steal'),
    { secret: SECRET, fetch: upstream as unknown as typeof fetch, nonceStore: store },
  );
  expect(blocked.status).toBe(404);

  const first = await handleSupabaseRelayRequest(
    await signedRelayRequest('https://alcat.pu.edu.tw/'),
    { secret: SECRET, fetch: upstream as unknown as typeof fetch, nonceStore: store },
  );
  const replay = await handleSupabaseRelayRequest(
    await signedRelayRequest('https://alcat.pu.edu.tw/'),
    { secret: SECRET, fetch: upstream as unknown as typeof fetch, nonceStore: store },
  );
  expect(first.status).toBe(200);
  expect(replay.status).toBe(404);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('returns 502 when the campus host cannot be reached', async () => {
  const response = await handleSupabaseRelayRequest(
    await signedRelayRequest('https://alcat.pu.edu.tw/'),
    {
      secret: SECRET,
      nonceStore: createMemoryNonceStore(),
      fetch: (async () => {
        throw new Error('timeout');
      }) as unknown as typeof fetch,
    },
  );
  expect(response.status).toBe(502);
});
