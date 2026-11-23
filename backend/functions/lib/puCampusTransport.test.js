const { createHash, createHmac } = require('node:crypto');
const {
  EMPTY_BODY_SHA256,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  createCjsRelayFetch,
  hostMatchesRelayAltHosts,
  isAllowedRelayTarget,
  normalizeRelayTarget,
  parseRelayAltHosts,
  readPuEdgeRelayAltConfig,
  readPuEdgeRelayConfig,
  sendWithCampusFetch,
  setCampusHttpFetch,
  sha256Hex,
  signRelayRequest,
} = require('./puCampusTransport');

const GOLDEN_FIELDS = {
  timestamp: '1700000000',
  nonce: '0123456789abcdef0123456789abcdef',
  method: 'POST',
  target: 'https://alcat.pu.edu.tw/index_check.php',
  bodySha256: '5c38824100d9ffcf24823e691ad711b0b640cec9d58fd4d770f9a1049b9fd3a0',
  cookie: 'SID=abc',
  contentType: 'application/x-www-form-urlencoded',
};
const GOLDEN_SIGN = '8a8512b7c00a0ae25cd545ef61b5c8d905cc5a973167ae3e60f94e63298ed8b0';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  setCampusHttpFetch(null);
  delete process.env.PU_EDGE_RELAY_URL;
  delete process.env.PU_EDGE_RELAY_SECRET;
  delete process.env.PU_EDGE_RELAY_ALT_URL;
  delete process.env.PU_EDGE_RELAY_ALT_SECRET;
  delete process.env.PU_EDGE_RELAY_ALT_HOSTS;
});

test('CJS HMAC matches the shared golden vector', () => {
  expect(sha256Hex(Buffer.from('uid=1110700321&upassword=secret'))).toBe(GOLDEN_FIELDS.bodySha256);
  expect(signRelayRequest('test-relay-secret', GOLDEN_FIELDS)).toBe(GOLDEN_SIGN);
  expect(
    createHmac('sha256', 'test-relay-secret')
      .update(
        [
          GOLDEN_FIELDS.timestamp,
          GOLDEN_FIELDS.nonce,
          GOLDEN_FIELDS.method,
          GOLDEN_FIELDS.target,
          GOLDEN_FIELDS.bodySha256,
          GOLDEN_FIELDS.cookie,
          GOLDEN_FIELDS.contentType,
        ].join('\n'),
        'utf8',
      )
      .digest('hex'),
  ).toBe(GOLDEN_SIGN);
  expect(createHash('sha256').update(Buffer.alloc(0)).digest('hex')).toBe(EMPTY_BODY_SHA256);
});

test('relay stays off unless both https URL and secret exist', () => {
  expect(readPuEdgeRelayConfig({})).toBeNull();
  process.env.PU_EDGE_RELAY_URL = 'https://relay.example';
  expect(readPuEdgeRelayConfig()).toBeNull();
  process.env.PU_EDGE_RELAY_SECRET = 'secret';
  expect(readPuEdgeRelayConfig()).toEqual({
    url: 'https://relay.example',
    secret: 'secret',
  });
});

test('allowlist accepts nested pu.edu.tw, trailing-dot FQDN, and rejects lookalikes', () => {
  const allow = ['*.pu.edu.tw'];
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw/index_check.php', allow)).toBe(true);
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw./index_check.php', allow)).toBe(true);
  expect(isAllowedRelayTarget('https://webpacx.lib.pu.edu.tw/', allow)).toBe(true);
  expect(isAllowedRelayTarget('https://identity.pu.edu.tw/auth', allow)).toBe(true);
  expect(isAllowedRelayTarget('http://alcat.pu.edu.tw/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw:8443/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw.evil.test/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://notpu.edu.tw/', allow)).toBe(false);
  expect(normalizeRelayTarget('https://alcat.pu.edu.tw./index_check.php')).toBe(
    'https://alcat.pu.edu.tw/index_check.php',
  );
});

test('injected fetch preserves cookies and does not follow redirects', async () => {
  const fetchImpl = jest.fn(async (url, init) => {
    expect(url).toBe('https://mypu.pu.edu.tw/score_query/score_all.php');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('cookie')).toBe('PHPSESSID=mypu');
    const headers = new Headers();
    headers.append('Set-Cookie', 'a=1; Path=/');
    headers.append('Set-Cookie', 'b=2; Path=/');
    headers.set('Location', 'https://mypu.pu.edu.tw/login');
    return new Response('moved', { status: 302, headers });
  });
  setCampusHttpFetch(fetchImpl);
  const result = await sendWithCampusFetch({
    url: 'https://mypu.pu.edu.tw/score_query/score_all.php',
    method: 'GET',
    cookies: { PHPSESSID: 'mypu' },
  });
  expect(result.status).toBe(302);
  expect(result.headers.location).toBe('https://mypu.pu.edu.tw/login');
  expect(result.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  expect(result.cookies).toMatchObject({ PHPSESSID: 'mypu', a: '1', b: '2' });
  expect(result.body).toBe('moved');
});

test('env-based relay signs body hash, cookie and nonce to the worker URL', async () => {
  const logs = [];
  const info = jest.spyOn(console, 'info').mockImplementation((message) => logs.push(String(message)));
  const relayFetch = createCjsRelayFetch(
    { url: 'https://pu-edge-relay.example.workers.dev', secret: 'unit-test-secret' },
    async (url, init) => {
      expect(url).toBe('https://pu-edge-relay.example.workers.dev');
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      const headers = new Headers(init.headers);
      expect(headers.get(RELAY_TARGET_HEADER)).toBe('https://tronclass.pu.edu.tw/api/profile');
      expect(headers.get(RELAY_NONCE_HEADER)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(headers.get(RELAY_SIGN_HEADER)).toBe(
        signRelayRequest('unit-test-secret', {
          timestamp: headers.get(RELAY_TS_HEADER),
          nonce: headers.get(RELAY_NONCE_HEADER),
          method: 'GET',
          target: 'https://tronclass.pu.edu.tw/api/profile',
          bodySha256: EMPTY_BODY_SHA256,
          cookie: '',
          contentType: '',
        }),
      );
      const out = new Headers({ 'x-pu-relay-colo': 'remote-TPE' });
      return new Response('ok', { headers: out });
    },
    () => 1_700_000_000_000,
    () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  );
  const result = await sendWithCampusFetch({
    url: 'https://tronclass.pu.edu.tw./api/profile',
    method: 'GET',
    fetch: relayFetch,
  });
  expect(result.body).toBe('ok');
  expect(JSON.parse(logs[0])).toMatchObject({
    msg: 'pu_edge_relay_client',
    host: 'tronclass.pu.edu.tw',
    path: '/api/profile',
    colo: 'remote-TPE',
  });
  info.mockRestore();
});

test('without injection or env, sendWithCampusFetch leaves https.request in charge', async () => {
  await expect(sendWithCampusFetch({ url: 'https://alcat.pu.edu.tw/' })).resolves.toBeNull();
});

test('does not start a relay fetch or direct fallback when the caller signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private-reason'));
  const fetch = jest.fn();
  await expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', fetch, signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR', message: 'Campus request cancelled' });
  expect(fetch).not.toHaveBeenCalled();
  await expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', signal: controller.signal }))
    .rejects.toMatchObject({ code: 'ABORT_ERR' });
});

test('aborts the actual injected fetch and removes the parent signal listener', async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  let upstream;
  const fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
    upstream = init.signal;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('private-reason'), { name: 'AbortError' })), { once: true });
  }));
  const pending = expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', fetch,
    signal: controller.signal, timeoutMs: 8_000 })).rejects.toMatchObject({ code: 'ABORT_ERR', message: 'Campus request cancelled' });
  controller.abort();
  await pending;
  expect(upstream.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('retains the transport timeout when a caller also supplies a signal', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  let upstream;
  const fetch = (_url, init) => new Promise((_resolve, reject) => {
    upstream = init.signal;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('private-reason'), { name: 'AbortError' })), { once: true });
  });
  const pending = expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', fetch,
    signal: controller.signal, timeoutMs: 100 })).rejects.toMatchObject({ code: 'ETIMEDOUT', message: 'Campus request timed out' });
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(upstream.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
});

test('cancels a stalled bounded response body when the caller aborts after response headers', async () => {
  const controller = new AbortController();
  const cancel = jest.fn();
  const body = new ReadableStream({ pull() {}, cancel });
  const fetch = jest.fn(async () => new Response(body));
  const pending = expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', fetch,
    signal: controller.signal, timeoutMs: 8_000, maxResponseBytes: 100 })).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await Promise.resolve(); await Promise.resolve();
  controller.abort();
  await pending;
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('stops an oversized stream without buffering the rest of the school response', async () => {
  const cancel = jest.fn();
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(60)); },
    cancel,
  }, { highWaterMark: 0 });
  await expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile',
    fetch: async () => new Response(body), timeoutMs: 8_000, maxResponseBytes: 100 }))
    .rejects.toThrow('Campus response is too large');
  expect(chunks).toBe(2);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('applies its deadline while a bounded response body stalls after headers', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  const body = new ReadableStream({ pull() {}, cancel });
  const pending = expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile',
    fetch: async () => new Response(body), timeoutMs: 100, maxResponseBytes: 100 }))
    .rejects.toMatchObject({ code: 'ETIMEDOUT', message: 'Campus request timed out' });
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('discards a response from an injected fetch that resolves after cancellation', async () => {
  const controller = new AbortController();
  let finish;
  const fetch = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const pending = expect(sendWithCampusFetch({ url: 'https://tronclass.pu.edu.tw/api/profile', fetch,
    signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
  controller.abort();
  finish(new Response('private-late-body'));
  await pending;
});

test('alt relay stays off unless url, secret and exact hosts are all set', () => {
  expect(readPuEdgeRelayAltConfig({})).toBeNull();
  process.env.PU_EDGE_RELAY_ALT_URL = 'https://alt.example';
  process.env.PU_EDGE_RELAY_ALT_SECRET = 'alt-secret';
  expect(readPuEdgeRelayAltConfig()).toBeNull();
  process.env.PU_EDGE_RELAY_ALT_HOSTS = 'alcat.pu.edu.tw, *.pu.edu.tw, mypu.pu.edu.tw';
  expect(readPuEdgeRelayAltConfig()).toEqual({
    url: 'https://alt.example',
    secret: 'alt-secret',
    hosts: ['alcat.pu.edu.tw', 'mypu.pu.edu.tw'],
  });
  expect(parseRelayAltHosts('alcat.pu.edu.tw., www.alcat.pu.edu.tw')).toEqual([
    'alcat.pu.edu.tw',
    'www.alcat.pu.edu.tw',
  ]);
  expect(hostMatchesRelayAltHosts('www.alcat.pu.edu.tw', ['alcat.pu.edu.tw'])).toBe(false);
  expect(hostMatchesRelayAltHosts('alcat.pu.edu.tw.', ['alcat.pu.edu.tw'])).toBe(true);
});

test('env-based alt relay signs listed hosts to the alt URL and keeps others on primary', async () => {
  const logs = [];
  const info = jest.spyOn(console, 'info').mockImplementation((message) => logs.push(String(message)));
  const seen = [];
  const relayFetch = createCjsRelayFetch(
    {
      url: 'https://pu-edge-relay.example.workers.dev',
      secret: 'unit-test-secret',
      alt: {
        url: 'https://alt-relay.example.supabase.co/functions/v1/pu-edge-relay',
        secret: 'unit-test-alt-secret',
        hosts: ['alcat.pu.edu.tw', 'mypu.pu.edu.tw'],
      },
    },
    async (url, init) => {
      seen.push({ url, target: new Headers(init.headers).get(RELAY_TARGET_HEADER) });
      return new Response('ok', { headers: { 'x-pu-relay-colo': 'supabase-ap-northeast-1' } });
    },
    () => 1_700_000_000_000,
    () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  );

  await sendWithCampusFetch({
    url: 'https://alcat.pu.edu.tw./index_check.php',
    method: 'GET',
    fetch: relayFetch,
  });
  await sendWithCampusFetch({
    url: 'https://identity.pu.edu.tw/auth',
    method: 'GET',
    fetch: relayFetch,
  });
  await sendWithCampusFetch({
    url: 'https://www.alcat.pu.edu.tw/',
    method: 'GET',
    fetch: relayFetch,
  });

  expect(seen[0]).toEqual({
    url: 'https://alt-relay.example.supabase.co/functions/v1/pu-edge-relay',
    target: 'https://alcat.pu.edu.tw/index_check.php',
  });
  expect(seen[1]).toEqual({
    url: 'https://pu-edge-relay.example.workers.dev',
    target: 'https://identity.pu.edu.tw/auth',
  });
  expect(seen[2]).toEqual({
    url: 'https://pu-edge-relay.example.workers.dev',
    target: 'https://www.alcat.pu.edu.tw/',
  });
  expect(JSON.parse(logs[0])).toMatchObject({ host: 'alcat.pu.edu.tw', via: 'alt' });
  expect(JSON.parse(logs[1])).not.toHaveProperty('via');
  const alcatHeaders = await (async () => {
    const fetchImpl = jest.fn(async (_url, _init) => {
      return new Response('ok');
    });
    const signed = createCjsRelayFetch(
      {
        url: 'https://pu-edge-relay.example.workers.dev',
        secret: 'unit-test-secret',
        alt: {
          url: 'https://alt-relay.example.supabase.co/functions/v1/pu-edge-relay',
          secret: 'unit-test-alt-secret',
          hosts: ['alcat.pu.edu.tw'],
        },
      },
      fetchImpl,
      () => 1_700_000_000_000,
      () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    await signed('https://alcat.pu.edu.tw/index_check.php', { method: 'GET' });
    return new Headers(fetchImpl.mock.calls[0][1].headers);
  })();
  expect(alcatHeaders.get(RELAY_SIGN_HEADER)).toBe(
    signRelayRequest('unit-test-alt-secret', {
      timestamp: '1700000000',
      nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      method: 'GET',
      target: 'https://alcat.pu.edu.tw/index_check.php',
      bodySha256: EMPTY_BODY_SHA256,
      cookie: '',
      contentType: '',
    }),
  );
  info.mockRestore();
});

test('relay log replaces numeric path ids so student ids are not logged', async () => {
  const logs = [];
  const info = jest.spyOn(console, 'info').mockImplementation((message) => logs.push(String(message)));
  const relayFetch = createCjsRelayFetch(
    { url: 'https://pu-edge-relay.example.workers.dev', secret: 'unit-test-secret' },
    async () => new Response('ok'),
    () => 1_700_000_000_000,
    () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  );
  await sendWithCampusFetch({
    url: 'https://tronclass.pu.edu.tw/api/course/123/student/456789/submissions',
    method: 'GET',
    fetch: relayFetch,
  });
  const entry = JSON.parse(logs[0]);
  expect(entry.path).toBe('/api/course/:id/student/:id/submissions');
  expect(logs[0]).not.toContain('456789');
  info.mockRestore();
});
