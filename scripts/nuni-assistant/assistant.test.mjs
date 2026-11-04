import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, fixtureHandle, modules } from './harness.mjs';
const headers = { authorization: 'Platform ' + fixtureHandle };
const prefix = '/v1/auth/platform/assistant/';
const actor = { account: 'a', sessionHash: 's', ip: '127.0.0.1' };
test('preview → ask → second confirmation → public entry through Fastify', async () => {
  const { app, state } = await createFixture();
  try {
    const preview = await app.inject({
      method: 'POST',
      url: prefix + 'preview',
      headers,
      payload: {
        schoolId: 'pu',
        question: '王小明 S123456789 private@example.test Bearer abc.def.ghi 圖書館怎麼走',
      },
    });
    assert.equal(preview.statusCode, 200);
    const p = preview.json();
    assert.equal(p.intent, 'map');
    assert.doesNotMatch(preview.body, /王小明|S123456789|private@|abc.def/);
    const payload = {
      schoolId: 'pu',
      intent: p.intent,
      confirmation: p.confirmation,
      consent: true,
    };
    const changed = await app.inject({
      method: 'POST',
      url: prefix + 'ask',
      headers,
      payload: { ...payload, schoolId: 'nthu' },
    });
    assert.equal(changed.statusCode, 409);
    const ask = await app.inject({ method: 'POST', url: prefix + 'ask', headers, payload });
    assert.equal(ask.statusCode, 200);
    const route = await app.inject({
      method: 'POST',
      url: prefix + 'route',
      headers,
      payload: { ...payload, confirmation: ask.json().confirmation },
    });
    assert.equal(route.statusCode, 200);
    assert.equal(route.json().href, '/map?schoolId=pu');
    for (const action of ['execute', 'enqueue']) {
      const denied = await app.inject({
        method: 'POST',
        url: prefix + action,
        headers,
        payload: { toolName: 'proposeOrder', permissions: { createOrder: true } },
      });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.json().error.code, 'ASSISTANT_WRITE_UNAVAILABLE');
    }
    const wrongSchool = await app.inject({
      method: 'POST',
      url: prefix + 'preview',
      headers,
      payload: { schoolId: 'nthu', intent: 'pu-library' },
    });
    assert.equal(wrongSchool.statusCode, 422);
    const unknownSchool = await app.inject({
      method: 'POST',
      url: prefix + 'preview',
      headers,
      payload: { schoolId: 'unknown', intent: 'map' },
    });
    assert.equal(unknownSchool.statusCode, 422);
    state.active = false;
    assert.equal(
      (await app.inject({ method: 'POST', url: prefix + 'ask', headers, payload })).statusCode,
      401,
    );
    state.active = true;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: prefix + 'preview',
          headers,
          payload: { schoolId: 'pu', intent: 'map', uid: 'forged' },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: prefix + 'preview',
          headers,
          payload: { schoolId: 'pu', question: 'x'.repeat(9000) },
        })
      ).statusCode,
      413,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: prefix + 'unknown', headers, payload: {} }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
test('real rate-limit plugin executes; default flag and production fake fail closed', async () => {
  const { app, state } = await createFixture();
  try {
    for (let i = 0; i < 30; i++)
      assert.equal((await app.inject({ url: prefix + 'capability', headers })).statusCode, 200);
    const denied = await app.inject({ url: prefix + 'capability', headers });
    assert.equal(denied.statusCode, 429);
    assert.ok(denied.headers['retry-after']);
    assert.equal(state.resolutions, 30);
  } finally {
    await app.close();
  }
  const off = await createFixture({ enabled: false });
  try {
    assert.equal((await off.app.inject({ url: prefix + 'capability', headers })).statusCode, 404);
  } finally {
    await off.app.close();
  }
  await assert.rejects(createFixture({ production: true }), /FAKE_PROVIDER_FORBIDDEN/);
});
test('complete provider request contains only allowlisted public data; no network for fake', async () => {
  const m = await modules();
  let captured;
  const service = new m.AssistantService({
    name: 'capture',
    model: 'v1',
    ready: true,
    async ask(input) {
      captured = JSON.stringify(input);
      return { intent: input.intent };
    },
  });
  const p = await service.run(
    'preview',
    {
      schoolId: 'pu',
      question: '王小明 S123456789 private@example.test eyJabc.def.ghi Bearer secret 圖書館',
    },
    actor,
  );
  await service.run(
    'ask',
    { schoolId: 'pu', intent: p.intent, confirmation: p.confirmation, consent: true },
    actor,
  );
  assert.doesNotMatch(captured, /王小明|S123456789|private@|eyJ|Bearer|secret|session|schoolId/);
  assert.deepEqual(JSON.parse(captured), {
    intent: 'map',
    sources: [{ id: 'map', label: '校園地圖', summary: '從校園地圖搜尋公開地點並查看位置。' }],
  });
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network forbidden');
  };
  try {
    process.env.NODE_ENV = 'test';
    assert.deepEqual(await m.fakeProvider().ask({ intent: 'map', sources: [] }), { intent: 'map' });
  } finally {
    globalThis.fetch = previous;
  }
  assert.equal(Object.keys(m.effectivePermissions()).length, 12);
  assert.ok(Object.values(m.effectivePermissions()).every((v) => v === false));
  for (const mode of ['schema', 'tool', '429', 'timeout']) {
    const s = new m.AssistantService(m.fakeProvider(mode));
    const p = await s.run('preview', { schoolId: 'pu', intent: 'map' }, actor);
    await assert.rejects(
      s.run(
        'ask',
        { schoolId: 'pu', intent: 'map', consent: true, confirmation: p.confirmation },
        actor,
      ),
    );
  }
});
test('confirmation expiry, session scope, per-account quotas and zero queue concurrency', async () => {
  const m = await modules();
  let now = 1000;
  const tokens = new m.Confirmations(Buffer.alloc(32, 1), () => now);
  const token = tokens.sign({ a: 1 });
  assert.throws(() => tokens.verify(token, { a: 2 }));
  now += 300001;
  assert.throws(() => tokens.verify(token, { a: 1 }));
  const s = new m.AssistantService(m.fakeProvider());
  const p = await s.run('preview', { schoolId: 'pu', intent: 'map' }, actor);
  const input = { schoolId: 'pu', intent: 'map', confirmation: p.confirmation, consent: true };
  await assert.rejects(s.run('ask', input, { ...actor, sessionHash: 'another' }));
  for (let i = 0; i < 5; i++) await s.run('ask', input, actor);
  await assert.rejects(s.run('ask', input, actor), /RATE_LIMITED/);
  let quotaNow = 1000;
  const hourly = new m.AssistantService(m.fakeProvider(), () => quotaNow);
  for (let round = 0; round < 4; round++) {
    const p = await hourly.run('preview', { schoolId: 'pu', intent: 'map' }, actor);
    for (let i = 0; i < 5; i++)
      await hourly.run('ask', { ...input, confirmation: p.confirmation }, actor);
    quotaNow += 61000;
  }
  const hp = await hourly.run('preview', { schoolId: 'pu', intent: 'map' }, actor);
  await assert.rejects(
    hourly.run('ask', { ...input, confirmation: hp.confirmation }, actor),
    /RATE_LIMITED/,
  );
  let release;
  const busy = new m.AssistantService({
    name: 'test',
    model: 'v1',
    ready: true,
    ask: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const b = await busy.run('preview', { schoolId: 'pu', intent: 'map' }, actor);
  const request = { ...input, confirmation: b.confirmation };
  const first = busy.run('ask', request, actor);
  await assert.rejects(busy.run('ask', request, actor), /PROVIDER_BUSY/);
  release({ intent: 'map' });
  await first;
});
test('Groq errors do not retry; fixed destination and output schema', async () => {
  const m = await modules();
  const previous = globalThis.fetch;
  delete process.env.GROQ_API_KEY;
  const input = { intent: 'map', sources: [] };
  try {
    assert.equal(m.groqProvider().ready, false);
    await assert.rejects(m.groqProvider().ask(input), /PROVIDER_UNAVAILABLE/);
    process.env.GROQ_API_KEY = 'synthetic-test-value';
    for (const status of [401, 429, 500]) {
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(init.redirect, 'error');
        assert.equal(JSON.parse(init.body).max_tokens, 64);
        return new Response('{}', { status });
      };
      await assert.rejects(m.groqProvider().ask(input));
      assert.equal(calls, 1);
    }
    globalThis.fetch = async () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    await assert.rejects(m.groqProvider().ask(input), /PROVIDER_TIMEOUT/);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"intent":"map"}', tool_calls: [{}] } }],
        }),
      );
    await assert.rejects(m.groqProvider().ask(input), /PROVIDER_INVALID_RESPONSE/);
  } finally {
    globalThis.fetch = previous;
    delete process.env.GROQ_API_KEY;
  }
});
