import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers';
import process from 'node:process';
import { admissionFixture, quotas, rejectsCode } from './fixtures.mjs';
const load = (name) =>
  import(pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, `${name}.js`)).href);
const { PlatformPublicTaskService } = await load('service');
const { createGroqNavigationPlanner } = await load('groq-navigation-plan');
const catalog = () => ({
  schoolId: 'pu',
  updatedAt: '2026-10-19',
  label: '測試來源',
  places: [
    {
      id: 'gate',
      name: '校門',
      lat: 24,
      lng: 120,
      sourceUrl: 'https://www.openstreetmap.org/way/1',
    },
    {
      id: 'library',
      name: '圖書館',
      lat: 24.1,
      lng: 120.1,
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    },
  ],
});
function fixture(overrides = {}) {
  const f = admissionFixture(),
    source = { value: catalog() },
    seen = [];
  const readPublicCatalog = async () => {
    await source.beforeRead?.();
    return globalThis.structuredClone(source.value);
  };
  const fetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return new globalThis.Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ kind: 'route', fromId: 'gate', toId: 'library' }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const groqPlan = createGroqNavigationPlanner({
    enabled: true,
    fetch,
    readPublicCatalog,
    ...overrides,
  });
  const service = new PlatformPublicTaskService({
    accounts: f.options.accounts,
    ledger: f.ledger,
    readPublicCatalog,
    groqPlan,
    clock: () => f.db.now,
  });
  const prepare = () =>
    service.prepareGroq(f.authorization, {
      schoolId: 'pu',
      query: '從入口走去圖書館',
      requestId: 'groq_flow_001',
    });
  const execute = async () => {
    const p = await prepare();
    const c = await service.confirm(f.authorization, { approved: true, request: p.request });
    const result = await service.execute(f.authorization, {
      confirmationId: c.confirmationId,
      request: p.request,
    });
    return { p, c, result };
  };
  return { ...f, service, source, seen, prepare, execute };
}
test('provider disclosure and first approval precede a single model plan; second approval binds exact open operation', async () => {
  const f = fixture(),
    p = await f.prepare();
  assert.equal(p.provider, 'groq');
  assert.equal(p.model, 'openai/gpt-oss-120b');
  assert.ok(p.dataScope.includes('公開地點名稱與 ID'));
  assert.equal(f.seen.length, 0);
  await rejectsCode(
    f.service.confirm(f.authorization, { approved: false, request: p.request }),
    'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
  );
  assert.equal(f.seen.length, 0);
  const c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  assert.equal(f.seen.length, 0);
  const body = { confirmationId: c.confirmationId, request: p.request };
  const result = await f.service.execute(f.authorization, body);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.result.receipt, {
    kind: 'navigation-plan',
    fromId: 'gate',
    toId: 'library',
    fromName: '校門',
    toName: '圖書館',
  });
  assert.equal(f.seen.length, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
  const forwarded = JSON.stringify(f.seen[0].body);
  assert.equal(forwarded.includes(f.authorization), false);
  assert.equal(forwarded.includes('lat'), false);
  assert.equal(forwarded.includes('校門'), true);
  assert.deepEqual(await f.service.execute(f.authorization, body), result);
  assert.equal(f.seen.length, 1);
  const route = {
    approved: true,
    operationId: result.operationId,
    request: p.request,
    fromId: 'gate',
    toId: 'library',
  };
  await rejectsCode(
    f.service.route(f.authorization, { ...route, approved: false }),
    'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
  );
  await rejectsCode(
    f.service.route(f.authorization, { ...route, fromId: 'library', toId: 'gate' }),
    'PUBLIC_AGENT_INVALID_RESULT',
  );
  const verified = await f.service.route(f.authorization, route);
  const url = new globalThis.URL(verified.receipt.url);
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('origin'), '24,120');
  assert.equal(url.searchParams.get('destination'), '24.1,120.1');
  await f.service.ack(f.authorization, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
    operationId: result.operationId,
    approved: true,
  });
  await rejectsCode(f.service.route(f.authorization, route), 'PUBLIC_AGENT_OPERATION_NOT_FOUND');
  await rejectsCode(f.service.read(f.authorization, p.request), 'PUBLIC_AGENT_OPERATION_NOT_FOUND');
  await rejectsCode(f.service.execute(f.authorization, body), 'PUBLIC_AGENT_OPERATION_NOT_FOUND');
});
test('source change and cross account/session prevent reuse of the original suggestion', async () => {
  const f = fixture(),
    { p, result } = await f.execute();
  const route = {
    approved: true,
    operationId: result.operationId,
    request: p.request,
    fromId: 'gate',
    toId: 'library',
  };
  const other = f.register(f.db.actor(), 'b');
  await assert.rejects(f.service.route(other, route));
  const newSession = f.register(f.db.anotherSession(f.actor), 'c');
  await assert.rejects(f.service.route(newSession, route));
  f.source.value.places[1].lat += 0.02;
  await rejectsCode(f.service.route(f.authorization, route), 'PUBLIC_AGENT_SOURCE_CHANGED');
  assert.equal(f.seen.length, 1);
});
test('model quota refusal is terminal failed, never success or silent fallback', async () => {
  const f = fixture({
    fetch: async () =>
      new globalThis.Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const p = await f.prepare();
  const c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  const failed = await f.service.execute(f.authorization, {
    confirmationId: c.confirmationId,
    request: p.request,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureCode, 'FREE_QUOTA_UNAVAILABLE');
  const state = await f.service.status(f.authorization, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
  });
  assert.equal(state.status, 'failed');
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('timeout after admission stays unknown even when the model returns late', async () => {
  let release,
    called = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    timeoutMs: 20,
    fetch: async () => {
      called++;
      await wait;
      return new globalThis.Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: '{"kind":"route","fromId":"gate","toId":"library"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const p = await f.prepare(),
    c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  await rejectsCode(
    f.service.execute(f.authorization, { confirmationId: c.confirmationId, request: p.request }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  release();
  await new Promise((resolve) => setImmediate(resolve));
  const state = await f.service.status(f.authorization, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
  });
  assert.equal(state.status, 'unknown');
  assert.equal(called, 1);
  await rejectsCode(
    f.service.ack(f.authorization, {
      task: 'public-campus-navigation',
      schoolId: 'pu',
      operationId: state.operationId,
      approved: true,
    }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
});

test('definitive unclear and malformed provider responses become explicit failures requiring acknowledgement', async () => {
  const answers = [
    {
      content: JSON.stringify({ kind: 'unclear', fromId: null, toId: null }),
      failure: 'DESTINATION_UNCLEAR',
    },
    {
      content: '{"kind":"route","fromId":"gate","fromId":"library","toId":"library"}',
      failure: 'INVALID_PROVIDER_RESPONSE',
    },
  ];
  for (const answer of answers) {
    let calls = 0;
    const f = fixture({
      fetch: async () => {
        calls++;
        return new globalThis.Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { role: 'assistant', content: answer.content } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const p = await f.prepare(),
      c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
    const failed = await f.service.execute(f.authorization, {
      confirmationId: c.confirmationId,
      request: p.request,
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureCode, answer.failure);
    assert.equal(calls, 1);
    const again = await f.service.execute(f.authorization, {
      confirmationId: c.confirmationId,
      request: p.request,
    });
    assert.equal(again.status, 'failed');
    assert.equal(calls, 1);
    assert.deepEqual(quotas(f.db), [1, 1]);
    const blocked = await f.service.prepareGroq(f.authorization, {
      schoolId: 'pu',
      query: '從入口走去圖書館',
      requestId: 'another_request_01',
    });
    await rejectsCode(
      f.service.confirm(f.authorization, { approved: true, request: blocked.request }),
      'PUBLIC_AGENT_OPEN_OPERATION',
    );
    assert.equal(
      (
        await f.service.ack(f.authorization, {
          task: 'public-campus-navigation',
          schoolId: 'pu',
          operationId: failed.operationId,
          approved: true,
        })
      ).status,
      'acknowledged',
    );
  }
});
test('a lost failure commit acknowledgement remains unknown to caller and cannot double debit', async () => {
  let f;
  f = fixture({
    fetch: async () => {
      f.db.loseCommitAck = true;
      return new globalThis.Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const p = await f.prepare(),
    c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  await rejectsCode(
    f.service.execute(f.authorization, { confirmationId: c.confirmationId, request: p.request }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  const state = await f.service.status(f.authorization, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
  });
  assert.equal(state.status, 'failed');
  assert.deepEqual(quotas(f.db), [1, 1]);
  const restarted = f.make();
  const replay = await restarted.status(f.actor, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
  });
  assert.deepEqual(replay, state);
  const next = await f.service.prepareGroq(f.authorization, {
    schoolId: 'pu',
    query: '從入口走去圖書館',
    requestId: 'after_lost_ack_01',
  });
  await rejectsCode(
    f.service.confirm(f.authorization, { approved: true, request: next.request }),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
});

test('Groq stays unavailable when the server has not selected an executor', async () => {
  const f = admissionFixture();
  const service = new PlatformPublicTaskService({
    accounts: f.options.accounts,
    ledger: f.ledger,
    readPublicCatalog: async () => catalog(),
  });
  await rejectsCode(
    service.prepareGroq(f.authorization, {
      schoolId: 'pu',
      query: '從入口走去圖書館',
      requestId: 'disabled_groq_01',
    }),
    'PUBLIC_AGENT_EXECUTOR_UNAVAILABLE',
  );
});

test('edited confirmation and stale source cannot dispatch to Groq', async () => {
  const f = fixture(),
    p = await f.prepare();
  const edited = globalThis.structuredClone(p.request);
  edited.data.query = '另外一個地點';
  await assert.rejects(f.service.confirm(f.authorization, { approved: true, request: edited }));
  const extra = globalThis.structuredClone(p.request);
  extra.data.consent.model = 'other';
  await assert.rejects(f.service.confirm(f.authorization, { approved: true, request: extra }));
  const old = globalThis.structuredClone(p.request);
  delete old.data.consent.model;
  await assert.rejects(f.service.confirm(f.authorization, { approved: true, request: old }));
  assert.equal(p.request.data.consent.model, p.model);
  f.source.value.places[0].lat += 0.001;
  await rejectsCode(
    f.service.confirm(f.authorization, { approved: true, request: p.request }),
    'PUBLIC_AGENT_SOURCE_CHANGED',
  );
  assert.equal(f.seen.length, 0);
  assert.deepEqual(quotas(f.db), []);
});

test('the caller cannot substitute a different query or session after confirmation', async () => {
  const f = fixture(),
    p = await f.prepare(),
    c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  const edited = globalThis.structuredClone(p.request);
  edited.data.query = edited.data.consent.query = '不同的地點';
  await assert.rejects(
    f.service.execute(f.authorization, { confirmationId: c.confirmationId, request: edited }),
  );
  const other = f.register(f.db.actor(), 'b');
  await assert.rejects(
    f.service.execute(other, { confirmationId: c.confirmationId, request: p.request }),
  );
  assert.equal(f.seen.length, 0);
  assert.deepEqual(quotas(f.db), []);
});

test('session revoked during final public-source read stops outbound call before fetch', async () => {
  const f = fixture();
  let reads = 0,
    revoked = false;
  const resolve = f.options.accounts.resolveSession;
  f.options.accounts.resolveSession = async (auth) => {
    if (revoked) throw Object.assign(new Error('revoked'), { code: 'PLATFORM_SESSION_INVALID' });
    return resolve(auth);
  };
  f.source.beforeRead = async () => {
    reads++;
    if (reads === 6) revoked = true;
  };
  const p = await f.prepare(),
    c = await f.service.confirm(f.authorization, { approved: true, request: p.request });
  await assert.rejects(
    f.service.execute(f.authorization, { confirmationId: c.confirmationId, request: p.request }),
  );
  assert.equal(revoked, true);
  assert.equal(f.seen.length, 0);
  revoked = false;
  const state = await f.service.status(f.authorization, {
    task: 'public-campus-navigation',
    schoolId: 'pu',
  });
  assert.ok(['unknown', 'pending'].includes(state.status));
});
