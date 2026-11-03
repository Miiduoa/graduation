import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { AbortController, Response } = globalThis;

const { createGroqServerTransport } = await import(
  pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, 'groq-server-transport.js')).href
);
const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
const credential = 'synthetic-secret-never-a-real-key';
const init = () => ({
  method: 'POST',
  redirect: 'error',
  cache: 'no-store',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: '{}',
  signal: new AbortController().signal,
});
const beforeSend = async () => {};
const denied = (promise, code = 'PUBLIC_AGENT_PROVIDER_UNAVAILABLE') =>
  assert.rejects(promise, (error) => error.code === code && !String(error).includes(credential));

test('only exact endpoint and exact headers reach the injected transport', async () => {
  let calls = 0,
    checks = 0;
  const fetch = async (url, request) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    return new Response('{}', { status: 200 });
  };
  const transport = createGroqServerTransport({
    credential,
    fetch,
    freeOnlyGuard: async () => {
      checks++;
      return true;
    },
  });
  for (const url of [
    `${endpoint}.evil`,
    'https://apiXgroq.com/openai/v1/chat/completions',
    'http://api.groq.com/openai/v1/chat/completions',
    `${endpoint}?key=test`,
  ])
    await denied(transport(url, init(), beforeSend));
  for (const request of [
    { ...init(), method: 'GET' },
    { ...init(), redirect: 'follow' },
    { ...init(), cache: 'default' },
    { ...init(), headers: { ...init().headers, authorization: 'attacker' } },
  ])
    await denied(transport(endpoint, request, beforeSend));
  assert.equal(checks, 0);
  assert.equal(calls, 0);
  assert.equal((await transport(endpoint, init(), beforeSend)).status, 200);
  assert.equal(checks, 1);
  assert.equal(calls, 1);
});

test('missing or declined no-charge guard, cancellation, and errors fail closed without credential leakage', async () => {
  assert.throws(
    () => createGroqServerTransport({ credential, fetch: async () => new Response() }),
    { code: 'PUBLIC_AGENT_PROVIDER_UNAVAILABLE' },
  );
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw Error(credential);
  };
  for (const guard of [
    async () => false,
    async () => {
      throw Error(credential);
    },
  ]) {
    const transport = createGroqServerTransport({ credential, fetch, freeOnlyGuard: guard });
    await denied(transport(endpoint, init(), beforeSend));
  }
  assert.equal(calls, 0);
  const signal = new AbortController();
  signal.abort();
  const transport = createGroqServerTransport({
    credential,
    fetch,
    freeOnlyGuard: async () => true,
  });
  await denied(
    transport(endpoint, { ...init(), signal: signal.signal }, beforeSend),
    'PUBLIC_AGENT_PROVIDER_CANCELLED',
  );
  assert.equal(calls, 0);
  await denied(transport(endpoint, init(), beforeSend));
  assert.equal(calls, 1);
});

test('session is revalidated after the potentially delayed guard and before sending', async () => {
  const events = [];
  const transport = createGroqServerTransport({
    credential,
    fetch: async () => {
      events.push('fetch');
      return new Response('{}');
    },
    freeOnlyGuard: async () => {
      events.push('guard');
      await Promise.resolve();
      return true;
    },
  });
  await assert.rejects(
    transport(endpoint, init(), async () => {
      events.push('session');
      throw Object.assign(new Error('revoked'), { code: 'SYNTHETIC_REVOKED' });
    }),
    { code: 'SYNTHETIC_REVOKED' },
  );
  assert.deepEqual(events, ['guard', 'session']);
  events.length = 0;
  await transport(endpoint, init(), async () => {
    events.push('session');
  });
  assert.deepEqual(events, ['guard', 'session', 'fetch']);
});
