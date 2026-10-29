// @vitest-environment node
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createPuRelayFetch,
  readPuEdgeRelayConfig,
  RELAY_COLO_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  signRelayRequest,
  verifyRelaySignature,
  type FetchLike,
} from './puEdgeRelay';

const GOLDEN_SECRET = 'test-relay-secret';
const GOLDEN_TS = '1700000000';
const GOLDEN_METHOD = 'POST';
const GOLDEN_TARGET = 'https://alcat.pu.edu.tw/index_check.php';
const GOLDEN_SIGN = 'e62e22b5464464754b36735ef948b92c0dc504f367f5c749344a2b2f61ef6a82';

const RELAY_URL = 'https://pu-edge-relay.example.workers.dev';
const SECRET = 'unit-test-secret';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function nodeSign(secret: string, timestamp: string, method: string, target: string) {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${method}\n${target}`, 'utf8')
    .digest('hex');
}

it('keeps worker protocol source identical to the web protocol', () => {
  const stripHeader = (source: string) => source.split('\n').slice(1).join('\n');
  const web = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'puEdgeRelayProtocol.ts'),
    'utf8',
  );
  const worker = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../deploy/edge-relay/src/protocol.ts'),
    'utf8',
  );
  expect(stripHeader(worker)).toBe(stripHeader(web));
});

it('uses the same HMAC canonical string on web and Node crypto', async () => {
  expect(GOLDEN_SIGN).toBe(nodeSign(GOLDEN_SECRET, GOLDEN_TS, GOLDEN_METHOD, GOLDEN_TARGET));
  expect(await signRelayRequest(GOLDEN_SECRET, GOLDEN_TS, GOLDEN_METHOD, GOLDEN_TARGET)).toBe(
    GOLDEN_SIGN,
  );
});

it('treats relay as off unless both https URL and secret are set', () => {
  expect(readPuEdgeRelayConfig({})).toBeNull();
  expect(readPuEdgeRelayConfig({ PU_EDGE_RELAY_URL: RELAY_URL })).toBeNull();
  expect(readPuEdgeRelayConfig({ PU_EDGE_RELAY_SECRET: SECRET })).toBeNull();
  expect(readPuEdgeRelayConfig({ PU_EDGE_RELAY_URL: 'http://relay.example', PU_EDGE_RELAY_SECRET: SECRET })).toBeNull();
  expect(readPuEdgeRelayConfig({ PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET })).toEqual({
    url: RELAY_URL,
    secret: SECRET,
  });
});

it('keeps IPv4 direct fetch when relay env is unset', async () => {
  const direct = vi.fn<FetchLike>(async () => new Response('direct'));
  const relay = vi.fn<FetchLike>(async () => new Response('relay'));
  const fetchLike = createPuRelayFetch({
    env: {},
    directFetch: direct,
    fetch: relay,
  });
  const response = await fetchLike('https://alcat.pu.edu.tw/', { method: 'GET' });
  expect(await response.text()).toBe('direct');
  expect(direct).toHaveBeenCalledTimes(1);
  expect(direct.mock.calls[0]?.[0]).toBe('https://alcat.pu.edu.tw/');
  expect(relay).not.toHaveBeenCalled();
});

it('signs and sends campus requests to the worker when env is set', async () => {
  const direct = vi.fn<FetchLike>(async () => new Response('direct'));
  const relay = vi.fn<FetchLike>(async () => new Response('ok', { headers: { [RELAY_COLO_HEADER]: 'TPE' } }));
  const now = () => 1_700_000_000_000;
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    directFetch: direct,
    fetch: relay,
    now,
  });
  const body = 'uid=1110700321&upassword=secret';
  const response = await fetchLike('https://alcat.pu.edu.tw/index_check.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'SID=abc' },
    body,
  });
  expect(await response.text()).toBe('ok');
  expect(direct).not.toHaveBeenCalled();
  expect(relay).toHaveBeenCalledTimes(1);
  const [url, init] = relay.mock.calls[0] || [];
  expect(url).toBe(RELAY_URL);
  expect(init?.method).toBe('POST');
  expect(init?.redirect).toBe('manual');
  expect(init?.body).toBe(body);
  const headers = new Headers(init?.headers);
  expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  expect(headers.get('cookie')).toBe('SID=abc');
  expect(headers.get(RELAY_TS_HEADER)).toBe('1700000000');
  expect(headers.get(RELAY_TARGET_HEADER)).toBe('https://alcat.pu.edu.tw/index_check.php');
  const signature = headers.get(RELAY_SIGN_HEADER) || '';
  expect(signature).toBe(
    await signRelayRequest(SECRET, '1700000000', 'POST', 'https://alcat.pu.edu.tw/index_check.php'),
  );
  await expect(
    verifyRelaySignature({
      secret: SECRET,
      timestamp: '1700000000',
      method: 'POST',
      target: 'https://alcat.pu.edu.tw/index_check.php',
      signature,
      nowMs: now(),
    }),
  ).resolves.toBe(true);
});

it('does not send non-pu hosts through the worker', async () => {
  const direct = vi.fn<FetchLike>(async () => new Response('direct'));
  const relay = vi.fn<FetchLike>(async () => new Response('relay'));
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    directFetch: direct,
    fetch: relay,
  });
  await fetchLike('https://example.com/');
  expect(direct).toHaveBeenCalledTimes(1);
  expect(relay).not.toHaveBeenCalled();
});

it('verifyRelaySignature matches createPuRelayFetch output', async () => {
  const now = () => 1_711_000_000_000;
  const relay = vi.fn<FetchLike>(async () => new Response('ok'));
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    fetch: relay,
    now,
  });
  await fetchLike('https://mypu.pu.edu.tw/score_query/score_all.php');
  const headers = new Headers(relay.mock.calls[0]?.[1]?.headers);
  await expect(
    verifyRelaySignature({
      secret: SECRET,
      timestamp: headers.get(RELAY_TS_HEADER) || '',
      method: 'GET',
      target: 'https://mypu.pu.edu.tw/score_query/score_all.php',
      signature: headers.get(RELAY_SIGN_HEADER) || '',
      nowMs: now(),
    }),
  ).resolves.toBe(true);
});
