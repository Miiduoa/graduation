const { createHmac } = require('node:crypto');
const {
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  createCjsRelayFetch,
  isAllowedRelayTarget,
  readPuEdgeRelayConfig,
  sendWithCampusFetch,
  setCampusHttpFetch,
  signRelayRequest,
} = require('./puCampusTransport');

const GOLDEN_SIGN = 'e62e22b5464464754b36735ef948b92c0dc504f367f5c749344a2b2f61ef6a82';

afterEach(() => {
  setCampusHttpFetch(null);
  delete process.env.PU_EDGE_RELAY_URL;
  delete process.env.PU_EDGE_RELAY_SECRET;
});

test('CJS HMAC matches the shared golden vector', () => {
  expect(
    signRelayRequest('test-relay-secret', '1700000000', 'POST', 'https://alcat.pu.edu.tw/index_check.php'),
  ).toBe(GOLDEN_SIGN);
  expect(
    createHmac('sha256', 'test-relay-secret')
      .update('1700000000\nPOST\nhttps://alcat.pu.edu.tw/index_check.php', 'utf8')
      .digest('hex'),
  ).toBe(GOLDEN_SIGN);
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

test('allowlist accepts nested pu.edu.tw and rejects lookalikes', () => {
  const allow = ['*.pu.edu.tw'];
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw/index_check.php', allow)).toBe(true);
  expect(isAllowedRelayTarget('https://webpacx.lib.pu.edu.tw/', allow)).toBe(true);
  expect(isAllowedRelayTarget('https://identity.pu.edu.tw/auth', allow)).toBe(true);
  expect(isAllowedRelayTarget('http://alcat.pu.edu.tw/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw:8443/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://alcat.pu.edu.tw.evil.test/', allow)).toBe(false);
  expect(isAllowedRelayTarget('https://notpu.edu.tw/', allow)).toBe(false);
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

test('env-based relay signs requests to the worker URL', async () => {
  const relayFetch = createCjsRelayFetch(
    { url: 'https://pu-edge-relay.example.workers.dev', secret: 'unit-test-secret' },
    async (url, init) => {
      expect(url).toBe('https://pu-edge-relay.example.workers.dev');
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      const headers = new Headers(init.headers);
      expect(headers.get(RELAY_TARGET_HEADER)).toBe('https://tronclass.pu.edu.tw/api/profile');
      expect(headers.get(RELAY_SIGN_HEADER)).toBe(
        signRelayRequest(
          'unit-test-secret',
          headers.get(RELAY_TS_HEADER),
          'GET',
          'https://tronclass.pu.edu.tw/api/profile',
        ),
      );
      return new Response('ok');
    },
    () => 1_700_000_000_000,
  );
  const result = await sendWithCampusFetch({
    url: 'https://tronclass.pu.edu.tw/api/profile',
    method: 'GET',
    fetch: relayFetch,
  });
  expect(result.body).toBe('ok');
});

test('without injection or env, sendWithCampusFetch leaves https.request in charge', async () => {
  await expect(sendWithCampusFetch({ url: 'https://alcat.pu.edu.tw/' })).resolves.toBeNull();
});
