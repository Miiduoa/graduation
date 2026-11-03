import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { AbortController, Response } = globalThis;

const {
  createGroqServerTransport,
  createFreeAssuranceAttempt,
  isFreeAssuranceDenied,
  consumeFreeAssuranceDenied,
} = await import(
  pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, 'groq-server-transport.js')).href
);
const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
const operationId = 'pago_11111111-1111-1111-1111-111111111111';
const otherOperation = 'pago_22222222-2222-2222-2222-222222222222';
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
const invoke = (transport, url, request, before = beforeSend) =>
  transport(url, request, before, createFreeAssuranceAttempt(request.signal, operationId));
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
    await denied(invoke(transport, url, init()));
  for (const request of [
    { ...init(), method: 'GET' },
    { ...init(), redirect: 'follow' },
    { ...init(), cache: 'default' },
    { ...init(), headers: { ...init().headers, authorization: 'attacker' } },
  ])
    await denied(invoke(transport, endpoint, request));
  assert.equal(checks, 0);
  assert.equal(calls, 0);
  assert.equal((await invoke(transport, endpoint, init())).status, 200);
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
  const refused = createGroqServerTransport({
    credential,
    fetch,
    freeOnlyGuard: async () => false,
  });
  const request = init(),
    attempt = createFreeAssuranceAttempt(request.signal, operationId);
  let proof;
  try {
    await refused(endpoint, request, beforeSend, attempt);
  } catch (error) {
    proof = error;
  }
  assert.equal(isFreeAssuranceDenied(proof, attempt), true);
  assert.equal(
    isFreeAssuranceDenied(proof, createFreeAssuranceAttempt(init().signal, otherOperation)),
    false,
  );
  await denied(refused(endpoint, request, beforeSend, attempt));
  assert.equal(consumeFreeAssuranceDenied(proof, attempt, otherOperation), false);
  assert.equal(consumeFreeAssuranceDenied(proof, attempt, operationId), true);
  assert.equal(consumeFreeAssuranceDenied(proof, attempt, operationId), false);
  assert.equal(String(proof).includes(credential), false);
  const broken = createGroqServerTransport({
    credential,
    fetch,
    freeOnlyGuard: async () => {
      throw Error(credential);
    },
  });
  await denied(invoke(broken, endpoint, init()));
  assert.equal(calls, 0);
  const signal = new AbortController();
  signal.abort();
  const transport = createGroqServerTransport({
    credential,
    fetch,
    freeOnlyGuard: async () => true,
  });
  await denied(
    invoke(transport, endpoint, { ...init(), signal: signal.signal }),
    'PUBLIC_AGENT_PROVIDER_CANCELLED',
  );
  assert.equal(calls, 0);
  await denied(invoke(transport, endpoint, init()));
  assert.equal(calls, 1);
});
test('a denial proof is unusable after its execution or request signal aborts', async () => {
  for (const abortRequest of [false, true]) {
    const execution = new AbortController(),
      request = new AbortController();
    const attempt = createFreeAssuranceAttempt(execution.signal, operationId);
    const transport = createGroqServerTransport({
      credential,
      fetch: async () => {
        throw new Error('unexpected');
      },
      freeOnlyGuard: async () => false,
    });
    let proof;
    try {
      await transport(endpoint, { ...init(), signal: request.signal }, beforeSend, attempt);
    } catch (error) {
      proof = error;
    }
    assert.equal(isFreeAssuranceDenied(proof, attempt), true);
    (abortRequest ? request : execution).abort();
    assert.equal(isFreeAssuranceDenied(proof, attempt), false);
    assert.equal(consumeFreeAssuranceDenied(proof, attempt, operationId), false);
  }
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
    invoke(transport, endpoint, init(), async () => {
      events.push('session');
      throw Object.assign(new Error('revoked'), { code: 'SYNTHETIC_REVOKED' });
    }),
    { code: 'SYNTHETIC_REVOKED' },
  );
  assert.deepEqual(events, ['guard', 'session']);
  events.length = 0;
  await invoke(transport, endpoint, init(), async () => {
    events.push('session');
  });
  assert.deepEqual(events, ['guard', 'session', 'fetch']);
});
