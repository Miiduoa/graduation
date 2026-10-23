import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeLoopbackFetch } from './nuni-merchant-native-transport.mjs';

const origin = 'http://127.0.0.1:41001';
const route = '/v1/auth/platform/realms/campus/food/orders?limit=1';
const expected = {
  method: 'GET',
  path: route,
  authorization: 'Platform isolated-test-handle',
  status: 200,
};
const init = {
  method: 'GET',
  redirect: 'error',
  headers: { Authorization: expected.authorization },
};

test('native origin adaptation preserves the exact request and real response', async () => {
  const response = new Response('{"orders":[]}');
  const requests = [];
  const receipts = [];
  const fetch = nativeLoopbackFetch(
    origin,
    async (...args) => {
      requests.push(args);
      return response;
    },
    () => expected,
    (entry) => receipts.push(entry),
  );
  assert.equal(await fetch(`https://api.nuni.tw${route}`, init), response);
  assert.deepEqual(requests, [[`${origin}${route}`, init]]);
  assert.deepEqual(receipts, [{ method: 'GET', path: route.split('?')[0], status: 200 }]);
});

test('unrelated requests without credentials pass through unchanged', async () => {
  const response = new Response('public');
  const url = 'https://example.test/public';
  const fetch = nativeLoopbackFetch(
    origin,
    async (actual) => {
      assert.equal(actual, url);
      return response;
    },
    () => null,
    () => assert.fail('must not count unrelated traffic'),
  );
  assert.equal(await fetch(url), response);
});

for (const url of [
  'https://example.test/api',
  'https://api.nuni.tw/v1/public/schools',
  'http://127.0.0.1:41002/api',
]) {
  test(`credentials cannot be forwarded to an unrelated origin or production route: ${url}`, async () => {
    const fetch = nativeLoopbackFetch(
      origin,
      () => assert.fail('must not send credentials'),
      () => expected,
      () => {},
    );
    await assert.rejects(fetch(url, init), /credentials cannot leave the owned loopback API/);
    await assert.rejects(
      fetch(url, { headers: { Cookie: 'session=isolated-test' } }),
      /credentials cannot leave the owned loopback API/,
    );
  });
}

test('native method, path, actor and redirect mismatches stop before network access', async () => {
  const fetch = nativeLoopbackFetch(
    origin,
    () => assert.fail('must not send a mismatched request'),
    () => expected,
    () => {},
  );
  await assert.rejects(
    fetch(`https://api.nuni.tw${route}`, { ...init, method: 'POST' }),
    /method mismatch/,
  );
  await assert.rejects(
    fetch('https://api.nuni.tw/v1/auth/platform/food-order-realms', init),
    /path\/query mismatch/,
  );
  await assert.rejects(
    fetch(`https://api.nuni.tw${route}`, {
      ...init,
      headers: { Authorization: 'Platform other-actor' },
    }),
    /actor mismatch/,
  );
  await assert.rejects(
    fetch(`https://api.nuni.tw${route}`, { ...init, redirect: 'follow' }),
    /reject redirects/,
  );
});

test('the adapter refuses unexpected production requests and invalid loopback origins', async () => {
  const fetch = nativeLoopbackFetch(
    origin,
    () => assert.fail('must not call production'),
    () => null,
    () => {},
  );
  await assert.rejects(
    fetch(`https://api.nuni.tw${route}`, init),
    /Unexpected production API request/,
  );
  for (const target of [
    'https://api.nuni.tw',
    'http://localhost:41001',
    'http://127.0.0.1:41001/api',
    'http://127.0.0.1:41001?target=other',
  ]) {
    assert.throws(() =>
      nativeLoopbackFetch(
        target,
        () => {},
        () => null,
        () => {},
      ),
    );
  }
});
