// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createPuRelayFetch,
  isRelayPlacementMiss,
  normalizeRelayTarget,
  readPuEdgeRelayConfig,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  sha256Hex,
  signRelayRequest,
  verifyRelaySignature,
  type FetchLike,
} from './puEdgeRelay';
import { isCampusHostBlocked, resetCampusCircuitForTests } from './puCampusCircuit';

const GOLDEN_SECRET = 'test-relay-secret';
const GOLDEN_TS = '1700000000';
const GOLDEN_NONCE = '0123456789abcdef0123456789abcdef';
const GOLDEN_METHOD = 'POST';
const GOLDEN_TARGET = 'https://alcat.pu.edu.tw/index_check.php';
const GOLDEN_BODY = 'uid=1110700321&upassword=secret';
const GOLDEN_COOKIE = 'SID=abc';
const GOLDEN_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const GOLDEN_BODY_SHA = '5c38824100d9ffcf24823e691ad711b0b640cec9d58fd4d770f9a1049b9fd3a0';
const GOLDEN_SIGN = '8a8512b7c00a0ae25cd545ef61b5c8d905cc5a973167ae3e60f94e63298ed8b0';

const RELAY_URL = 'https://pu-edge-relay.example.workers.dev';
const SECRET = 'unit-test-secret';
const FIXED_NONCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

afterEach(() => {
  resetCampusCircuitForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function nodeSign(fields: {
  timestamp: string;
  nonce: string;
  method: string;
  target: string;
  bodySha256: string;
  cookie: string;
  contentType: string;
}) {
  return createHmac('sha256', GOLDEN_SECRET)
    .update(
      [
        fields.timestamp,
        fields.nonce,
        fields.method,
        fields.target,
        fields.bodySha256,
        fields.cookie,
        fields.contentType,
      ].join('\n'),
      'utf8',
    )
    .digest('hex');
}

const goldenFields = {
  timestamp: GOLDEN_TS,
  nonce: GOLDEN_NONCE,
  method: GOLDEN_METHOD,
  target: GOLDEN_TARGET,
  bodySha256: GOLDEN_BODY_SHA,
  cookie: GOLDEN_COOKIE,
  contentType: GOLDEN_CONTENT_TYPE,
};

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
  expect(GOLDEN_BODY_SHA).toBe(createHash('sha256').update(GOLDEN_BODY, 'utf8').digest('hex'));
  expect(GOLDEN_SIGN).toBe(nodeSign(goldenFields));
  expect(await signRelayRequest(GOLDEN_SECRET, goldenFields)).toBe(GOLDEN_SIGN);
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

it('signs body, cookie and content-type then sends campus requests to the worker', async () => {
  const direct = vi.fn<FetchLike>(async () => new Response('direct'));
  const relay = vi.fn<FetchLike>(async () => new Response('ok', { headers: { [RELAY_COLO_HEADER]: 'remote-TPE' } }));
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const now = () => 1_700_000_000_000;
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    directFetch: direct,
    fetch: relay,
    now,
    nonce: () => FIXED_NONCE,
  });
  const body = GOLDEN_BODY;
  const response = await fetchLike('https://alcat.pu.edu.tw./index_check.php', {
    method: 'POST',
    headers: { 'Content-Type': GOLDEN_CONTENT_TYPE, Cookie: GOLDEN_COOKIE },
    body,
  });
  expect(await response.text()).toBe('ok');
  expect(direct).not.toHaveBeenCalled();
  expect(relay).toHaveBeenCalledTimes(1);
  const [url, init] = relay.mock.calls[0] || [];
  expect(url).toBe(RELAY_URL);
  expect(init?.method).toBe('POST');
  expect(init?.redirect).toBe('manual');
  const headers = new Headers(init?.headers);
  expect(headers.get('content-type')).toBe(GOLDEN_CONTENT_TYPE);
  expect(headers.get('cookie')).toBe(GOLDEN_COOKIE);
  expect(headers.get(RELAY_TS_HEADER)).toBe('1700000000');
  expect(headers.get(RELAY_NONCE_HEADER)).toBe(FIXED_NONCE);
  expect(headers.get(RELAY_TARGET_HEADER)).toBe(GOLDEN_TARGET);
  const signature = headers.get(RELAY_SIGN_HEADER) || '';
  const fields = {
    timestamp: '1700000000',
    nonce: FIXED_NONCE,
    method: 'POST',
    target: GOLDEN_TARGET,
    bodySha256: await sha256Hex(new TextEncoder().encode(body)),
    cookie: GOLDEN_COOKIE,
    contentType: GOLDEN_CONTENT_TYPE,
  };
  expect(signature).toBe(await signRelayRequest(SECRET, fields));
  await expect(
    verifyRelaySignature({
      secret: SECRET,
      fields,
      signature,
      nowMs: now(),
    }),
  ).resolves.toBe(true);
  expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
    msg: 'pu_edge_relay_client',
    host: 'alcat.pu.edu.tw',
    path: '/index_check.php',
    status: 200,
    colo: 'remote-TPE',
  });
  info.mockRestore();
});

it('logs placement_miss when the worker did not run near Taiwan', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const relay = vi.fn<FetchLike>(async () => new Response('ok', { headers: { [RELAY_COLO_HEADER]: 'remote-NRT' } }));
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    fetch: relay,
    nonce: () => FIXED_NONCE,
  });
  await fetchLike('https://alcat.pu.edu.tw/');
  expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
    colo: 'remote-NRT',
    placement_miss: true,
  });
  expect(isRelayPlacementMiss('remote-NRT')).toBe(true);
  expect(isRelayPlacementMiss('remote-TPE')).toBe(false);
  info.mockRestore();
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
    nonce: () => FIXED_NONCE,
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await fetchLike('https://mypu.pu.edu.tw/score_query/score_all.php');
  const headers = new Headers(relay.mock.calls[0]?.[1]?.headers);
  await expect(
    verifyRelaySignature({
      secret: SECRET,
      fields: {
        timestamp: headers.get(RELAY_TS_HEADER) || '',
        nonce: headers.get(RELAY_NONCE_HEADER) || '',
        method: 'GET',
        target: 'https://mypu.pu.edu.tw/score_query/score_all.php',
        bodySha256: await sha256Hex(new Uint8Array()),
        cookie: '',
        contentType: '',
      },
      signature: headers.get(RELAY_SIGN_HEADER) || '',
      nowMs: now(),
    }),
  ).resolves.toBe(true);
});

it('normalizes trailing-dot campus hosts to the same relay target', () => {
  expect(normalizeRelayTarget('https://alcat.pu.edu.tw./index_check.php')).toBe(GOLDEN_TARGET);
  expect(normalizeRelayTarget('https://identity.pu.edu.tw./auth')).toBe('https://identity.pu.edu.tw/auth');
});

it('opens the alcat circuit when the relay returns HTTP 555 and then skips that host', async () => {
  const relay = vi.fn<FetchLike>(async () => new Response('blocked', { status: 555 }));
  const fetchLike = createPuRelayFetch({
    env: { PU_EDGE_RELAY_URL: RELAY_URL, PU_EDGE_RELAY_SECRET: SECRET },
    fetch: relay,
    now: () => 1_711_000_000_000,
    nonce: () => FIXED_NONCE,
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await expect(fetchLike('https://alcat.pu.edu.tw/index_check.php')).rejects.toMatchObject({
    name: 'CampusHostBlockedError',
  });
  expect(isCampusHostBlocked('alcat.pu.edu.tw')).toBe(true);
  await expect(fetchLike('https://alcat.pu.edu.tw/index_check.php')).rejects.toMatchObject({
    name: 'CampusHostBlockedError',
  });
  expect(relay).toHaveBeenCalledTimes(1);
});
