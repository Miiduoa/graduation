import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout } from 'node:timers';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { admissionFixture, quotas } from './fixtures.mjs';
const { registerPlatformPublicTaskRoutes, isPlatformPublicTaskRoute } = await import(
  pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, 'fastify-candidate.js')).href
);
const prefix = '/v1/auth/platform/public-agent';
const catalog = () => ({
  schoolId: 'pu',
  updatedAt: '2026-10-19',
  label: '合成公開目錄',
  places: [
    { id: 'a', name: '甲樓', lat: 24, lng: 120, sourceUrl: 'https://www.openstreetmap.org/way/1' },
    {
      id: 'b',
      name: '乙館',
      lat: 24.1,
      lng: 120.1,
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    },
  ],
});
function fixture(extra = {}) {
  const f = admissionFixture();
  f.db.now = Date.now();
  f.actor.expiresAt = f.db.now + 3600000;
  const authorization = f.register(f.actor, 'a');
  const routes = new Map(),
    options = {
      enabled: true,
      db: f.db,
      accounts: f.options.accounts,
      policy: { providerBudgetKey: 'test-public', providerDailyLimit: 10, accountDailyLimit: 5 },
      readPublicCatalog: async () => catalog(),
      ...extra,
    };
  const app = {
    post(path, settings, handler) {
      assert.equal(routes.has(path), false);
      routes.set(path, { settings, handler });
    },
  };
  registerPlatformPublicTaskRoutes(app, options);
  async function call(action, body, headers = {}, overrideUrl, flags = {}) {
    const raw = new EventEmitter(),
      replyRaw = new EventEmitter();
    replyRaw.writableEnded = Boolean(flags.writableEnded);
    replyRaw.destroyed = Boolean(flags.destroyed);
    raw.aborted = Boolean(flags.aborted);
    const response = { status: 200, headers: {}, body: null };
    const reply = {
      raw: replyRaw,
      header(name, value) {
        response.headers[name.toLowerCase()] = value;
        return this;
      },
      code(status) {
        response.status = status;
        return this;
      },
      send(value) {
        response.body = value;
        replyRaw.writableEnded = true;
        return response;
      },
    };
    const request = {
      url: overrideUrl ?? `${prefix}/${action}`,
      headers: { authorization, 'content-type': 'application/json', ...headers },
      body,
      raw,
    };
    const route = routes.get(`${prefix}/${action}`);
    assert.ok(route);
    return await route.handler(request, reply);
  }
  return { ...f, authorization, options, routes, app, call };
}
test('disabled by default and exact public-route predicate does not alter any host guard', () => {
  const f = fixture();
  const entries = new Map();
  registerPlatformPublicTaskRoutes(
    { post: (p, o, h) => entries.set(p, { o, h }) },
    { ...f.options, enabled: false },
  );
  assert.equal(entries.size, 0);
  for (const action of ['preview', 'confirm', 'execute', 'read', 'status', 'ack']) {
    assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/${action}`, true), true);
    assert.equal(isPlatformPublicTaskRoute('GET', `${prefix}/${action}`, true), false);
    assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/${action}/extra`, true), false);
  }
  assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/execute?extra=1`, true), false);
  assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/executeevil`, true), false);
  for (const value of f.routes.values()) {
    assert.equal(value.settings.bodyLimit, 8192);
    assert.equal(value.settings.config.rateLimit.max, 30);
  }
});
test('Fastify-shaped handler composes true ledger and admission around synthetic platform session and trusted public source', async () => {
  const f = fixture();
  const p = await f.call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'fastify_route_01',
  });
  assert.equal(p.status, 200);
  assert.equal(p.body.execution, 'deterministic');
  assert.equal(p.headers['cache-control'], 'no-store');
  const c = await f.call('confirm', { approved: true, request: p.body.request });
  assert.equal(c.status, 200);
  const e = await f.call('execute', {
    confirmationId: c.body.confirmationId,
    request: p.body.request,
  });
  assert.equal(e.status, 200);
  assert.equal(e.body.status, 'completed');
  assert.equal(JSON.stringify(e.body).includes('executionToken'), false);
  assert.deepEqual(quotas(f.db), [1, 1]);
  const again = await f.call('execute', {
    confirmationId: c.body.confirmationId,
    request: p.body.request,
  });
  assert.equal(again.status, 200);
  assert.deepEqual(quotas(f.db), [1, 1]);
  const state = await f.call('status', { task: 'public-campus-navigation', schoolId: 'pu' });
  assert.deepEqual(state.body, { status: 'completed', operationId: e.body.operationId });
  const ack = await f.call('ack', {
    task: 'public-campus-navigation',
    schoolId: 'pu',
    operationId: e.body.operationId,
    approved: true,
  });
  assert.equal(ack.body.status, 'acknowledged');
  assert.equal(
    (await f.call('status', { task: 'public-campus-navigation', schoolId: 'pu' })).body,
    null,
  );
});
test('direct browser origin, fetch metadata, unsupported content type and absent platform handle fail before data access', async () => {
  const f = fixture();
  const body = { schoolId: 'pu', query: '從甲樓到乙館', requestId: 'fastify_bad_01' };
  assert.equal((await f.call('preview', body, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.call('preview', body, { 'sec-fetch-site': 'same-origin' })).status, 403);
  assert.equal((await f.call('preview', body, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await f.call('preview', body, { authorization: undefined })).status, 401);
  assert.equal(f.db.data.confirmations.size, 0);
  assert.deepEqual(quotas(f.db), []);
});
test('extra client-provided identity and false approval fail closed without claim or quota', async () => {
  const f = fixture();
  const p = await f.call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'fastify_bad_02',
    platformAccountId: 'fake',
  });
  assert.equal(p.status, 422);
  const good = await f.call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'fastify_good_02',
  });
  assert.equal(
    (await f.call('confirm', { approved: false, request: good.body.request })).body.code,
    'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
  );
  assert.equal(f.db.data.operations.size, 0);
  assert.deepEqual(quotas(f.db), []);
});
test('a public source changed after preview rejects confirmation without side effects', async () => {
  let source = catalog();
  const f = fixture({ readPublicCatalog: async () => source });
  const p = await f.call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'fastify_source_1',
  });
  source = catalog();
  source.places[1].lat += 0.01;
  const r = await f.call('confirm', { approved: true, request: p.body.request });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'PUBLIC_AGENT_SOURCE_CHANGED');
  assert.equal(f.db.data.confirmations.size, 0);
  assert.deepEqual(quotas(f.db), []);
});
test('stalled session resolver times out before any execution and late resolution cannot start task', async () => {
  let resolve,
    calls = 0;
  const f = fixture({
    timeoutMs: 10,
    accounts: {
      resolveSession: () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    },
  });
  const result = await f.call('preview', {
    schoolId: 'pu',
    query: '從甲樓到乙館',
    requestId: 'fastify_stall_1',
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'PUBLIC_AGENT_TIMEOUT');
  resolve({
    platformAccountId: f.actor.platformAccountId,
    credentialId: f.actor.credentialId,
    expiresAt: f.actor.expiresAt,
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  assert.equal(f.db.data.confirmations.size, 0);
});
test('session resolver infrastructure failure and invalid session return bounded error without leaking cause', async () => {
  for (const [err, code, status] of [
    [
      Object.assign(new Error('private'), { code: 'PLATFORM_SESSION_INVALID' }),
      'PUBLIC_AGENT_SESSION_INVALID',
      401,
    ],
    [new Error('private'), 'PUBLIC_AGENT_STATE_UNAVAILABLE', 503],
  ]) {
    const f = fixture({
      accounts: {
        resolveSession: async () => {
          throw err;
        },
      },
    });
    const r = await f.call('status', { task: 'public-campus-navigation', schoolId: 'pu' });
    assert.equal(r.status, status);
    assert.equal(r.body.code, code);
    assert.equal(JSON.stringify(r).includes('private'), false);
  }
});

test('query parameters cannot expand an exact route or trigger state', async () => {
  const f = fixture();
  const r = await f.call(
    'status',
    { task: 'public-campus-navigation', schoolId: 'pu' },
    {},
    `${prefix}/status?account=other`,
  );
  assert.equal(r.status, 403);
  assert.equal(f.db.data.confirmations.size, 0);
});
test('changing account while reading public source cannot deliver the previous identity response', async () => {
  const base = admissionFixture();
  base.db.now = Date.now();
  base.actor.expiresAt = base.db.now + 3600000;
  const authorization = base.register(base.actor, 'a');
  let count = 0;
  const accounts = {
    resolveSession: async (value) => {
      const actor = await base.options.accounts.resolveSession(value);
      count++;
      return count >= 3
        ? { ...actor, platformAccountId: 'pa_00000000-0000-0000-0000-999999999999' }
        : actor;
    },
  };
  const f = fixture({ db: base.db, accounts });
  const result = await f.call(
    'preview',
    { schoolId: 'pu', query: '從甲樓到乙館', requestId: 'switch_actor_01' },
    { authorization },
  );
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'PUBLIC_AGENT_SESSION_INVALID');
  assert.equal(result.body.receipt, undefined);
});
test('lost confirmation response is outcome unknown and does not replay after resolver deadline', async () => {
  const base = admissionFixture();
  base.db.now = Date.now();
  base.actor.expiresAt = base.db.now + 3600000;
  const authorization = base.register(base.actor, 'a');
  let count = 0,
    resolve;
  const accounts = {
    resolveSession: async (value) => {
      count++;
      if (count === 3)
        return new Promise((r) => {
          resolve = r;
        });
      return base.options.accounts.resolveSession(value);
    },
  };
  const f = fixture({ db: base.db, accounts, timeoutMs: 15 });
  const previewFixture = fixture({ db: base.db, accounts: base.options.accounts });
  const p = await previewFixture.call(
    'preview',
    { schoolId: 'pu', query: '從甲樓到乙館', requestId: 'lost_confirm_01' },
    { authorization },
  );
  const result = await f.call(
    'confirm',
    { approved: true, request: p.body.request },
    { authorization },
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
  assert.equal(base.db.data.confirmations.size, 1);
  resolve({
    platformAccountId: base.actor.platformAccountId,
    credentialId: base.actor.credentialId,
    expiresAt: base.actor.expiresAt,
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(count, 3);
  assert.equal(base.db.data.confirmations.size, 1);
  assert.deepEqual(quotas(base.db), []);
});

test('requests aborted or destroyed before registration fail closed without resolving session or reading source', async () => {
  for (const flags of [{ aborted: true }, { destroyed: true }, { writableEnded: true }]) {
    let calls = 0,
      reads = 0;
    const f = fixture({
      accounts: {
        resolveSession: async () => {
          calls++;
          throw new Error('must not execute');
        },
      },
      readPublicCatalog: async () => {
        reads++;
        return catalog();
      },
    });
    const r = await f.call(
      'preview',
      { schoolId: 'pu', query: '從甲樓到乙館', requestId: 'initial_abort_01' },
      {},
      undefined,
      flags,
    );
    assert.equal(r.body.code, 'PUBLIC_AGENT_CANCELLED');
    assert.equal(calls, 0);
    assert.equal(reads, 0);
    assert.deepEqual(quotas(f.db), []);
  }
});
test('route predicate is disabled by default even for an otherwise valid path', () => {
  assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/preview`), false);
  assert.equal(isPlatformPublicTaskRoute('POST', `${prefix}/preview`, true), true);
});

test('malformed or expired session projection fails closed before public source access', async () => {
  for (const value of [
    {},
    {
      platformAccountId: 'pa_00000000-0000-4000-8000-000000000001',
      credentialId: 'valid',
      expiresAt: 0,
    },
  ]) {
    let reads = 0;
    const f = fixture({
      accounts: { resolveSession: async () => value },
      readPublicCatalog: async () => {
        reads++;
        return catalog();
      },
    });
    const r = await f.call('preview', {
      schoolId: 'pu',
      query: '從甲樓到乙館',
      requestId: 'invalid_actor_01',
    });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'PUBLIC_AGENT_SESSION_CHECK_UNAVAILABLE');
    assert.equal(reads, 0);
    assert.deepEqual(quotas(f.db), []);
  }
});

test('malformed session recheck after a committed confirmation reports unknown', async () => {
  const base = admissionFixture();
  base.db.now = Date.now();
  base.actor.expiresAt = base.db.now + 3600000;
  const authorization = base.register(base.actor, 'a');
  let count = 0;
  const accounts = {
    resolveSession: async (value) => {
      count++;
      if (count === 3) return {};
      return base.options.accounts.resolveSession(value);
    },
  };
  const f = fixture({ db: base.db, accounts });
  const previewFixture = fixture({ db: base.db, accounts: base.options.accounts });
  const p = await previewFixture.call(
    'preview',
    { schoolId: 'pu', query: '從甲樓到乙館', requestId: 'invalid_recheck_01' },
    { authorization },
  );
  const r = await f.call('confirm', { approved: true, request: p.body.request }, { authorization });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
  assert.equal(base.db.data.confirmations.size, 1);
  assert.deepEqual(quotas(base.db), []);
});

test('capability uses the trusted catalog, distinguishes unsupported and unavailable, and never executes', async () => {
  let providerCalls = 0;
  const f = fixture({
    readPublicCatalog: async (school) => (school === 'pu' ? catalog() : null),
    freeTierVerified: true,
    groqPlan: async () => {
      providerCalls++;
      throw new Error('must not execute');
    },
  });
  const known = await f.call('capability', { schoolId: 'pu' });
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, {
    schoolId: 'pu',
    modes: ['deterministic'],
    source: { date: '2026-10-19', label: '合成公開目錄' },
  });
  assert.equal(known.headers['cache-control'], 'no-store');
  const unknown = await f.call('capability', { schoolId: 'other' });
  assert.deepEqual(unknown.body, { schoolId: 'other', modes: [], source: null });
  assert.equal((await f.call('capability', { schoolId: 'pu', accountId: 'bad' })).status, 422);
  assert.equal(
    (await f.call('capability', { schoolId: 'pu' }, { origin: 'https://evil.invalid' })).status,
    403,
  );
  assert.equal(
    (await f.call('capability', { schoolId: 'pu' }, { authorization: undefined })).status,
    401,
  );
  assert.equal(providerCalls, 0);
  assert.deepEqual(quotas(f.db), []);
  const unavailable = fixture({
    readPublicCatalog: async () => {
      throw new Error('storage failure');
    },
  });
  const result = await unavailable.call('capability', { schoolId: 'pu' });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'PUBLIC_AGENT_SOURCE_UNAVAILABLE');
});

test('capability offers no mode for an ambiguous catalog and does not expose an unconfigured provider', async () => {
  const f = fixture();
  assert.deepEqual((await f.call('capability', { schoolId: 'pu' })).body.modes, ['deterministic']);
  const ambiguous = catalog();
  ambiguous.places[1].name = ambiguous.places[0].name;
  const limited = fixture({ readPublicCatalog: async () => ambiguous });
  assert.deepEqual((await limited.call('capability', { schoolId: 'pu' })).body.modes, []);
});
