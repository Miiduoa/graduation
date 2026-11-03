import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';

const compiled = process.env.PLATFORM_AGENT_COMPILED;
if (!compiled) throw new Error('PLATFORM_AGENT_COMPILED must identify the compiled candidate.');
const { PlatformPublicAdmission } = await import(
  pathToFileURL(join(compiled, 'admission.js')).href
);
const { PublicAgentError } = await import(pathToFileURL(join(compiled, 'contract.js')).href);

// Synthetic handles only. No provider, database or production authentication is used.
const handle = `ps_${'a'.repeat(43)}`;
const authorization = `Platform ${handle}`;
const fingerprint = createHash('sha256').update('synthetic public POI revision').digest('hex');
const confirmationId = 'pagc_11111111-1111-4111-8111-111111111111';
const operationId = 'pago_22222222-2222-4222-8222-222222222222';
const actor = {
  platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
  credentialId: 'pc_fixture',
  expiresAt: 4_102_444_800_000,
};

function payload(kind = 'navigation', schoolId = 'pu', requestId = 'public_request_001') {
  if (kind === 'semantic') {
    const utterance = '我要找校園地圖';
    return {
      task: 'campus-service-entry',
      data: {
        schoolId,
        utterance,
        requestId,
        consent: {
          version: 1,
          purpose: 'campus-service-entry',
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          schoolId,
          utterance,
        },
      },
    };
  }
  const query = '從圖書館走到餐廳';
  return {
    task: 'public-campus-navigation',
    data: {
      task: 'public-campus-navigation',
      phase: 'execute',
      schoolId,
      query,
      requestId,
      consent: { provider: 'groq', version: 1, schoolId, query, fingerprint },
    },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness({ resolve, source, ledger = {}, timeoutMs = 1000 } = {}) {
  const calls = { session: [], source: [], confirm: [], claim: [], read: [] };
  const replies = {
    confirm: { confirmationId, expiresAt: 4_102_444_800_000 },
    claim: { status: 'claimed', operationId, expiresAt: 4_102_444_800_000 },
    read: { status: 'pending', operationId, expiresAt: 4_102_444_800_000 },
  };
  const options = {
    timeoutMs,
    accounts: {
      resolveSession: async (value) => {
        calls.session.push(value);
        return resolve ? resolve(value) : { ...actor };
      },
    },
    readPublicSourceFingerprint: async (...args) => {
      calls.source.push(args);
      return source ? source(...args) : fingerprint;
    },
    ledger: Object.fromEntries(
      ['confirm', 'claim', 'read'].map((method) => [
        method,
        async (...args) => {
          calls[method].push(args);
          return ledger[method] ? ledger[method](...args) : { ...replies[method] };
        },
      ]),
    ),
  };
  return { service: new PlatformPublicAdmission(options), calls, options, replies };
}
function invoke(h, method, request = payload(), signal) {
  const body = method === 'confirm' ? { approved: true, request } : { confirmationId, request };
  return h.service[method](authorization, body, signal);
}
function rejectsCode(promise, code) {
  return assert.rejects(
    promise,
    (error) => error instanceof PublicAgentError && error.code === code,
  );
}
function noLedger(calls) {
  assert.equal(calls.confirm.length + calls.claim.length + calls.read.length, 0);
}

for (const kind of ['navigation', 'semantic']) {
  for (const method of ['confirm', 'claim']) {
    test(`${method} ${kind}: verified session and public content reach only the requested admission step`, async () => {
      const h = harness();
      const request = payload(kind);
      const result = await invoke(h, method, request);
      assert.deepEqual(result, h.replies[method]);
      assert.equal(Object.hasOwn(result, 'completed'), false);
      assert.equal(Object.hasOwn(result, 'result'), false);
      assert.deepEqual(h.calls.session, [authorization]);
      assert.equal(h.calls[method].length, 1);
      assert.equal(h.calls[method === 'claim' ? 'confirm' : 'claim'].length, 0);
      assert.equal(h.calls.read.length, 0);
      const [verifiedActor, binding, confirmed] = h.calls[method][0];
      assert.deepEqual(verifiedActor, {
        ...actor,
        sessionHash: createHash('sha256').update(handle).digest('hex'),
      });
      assert.equal(binding.schoolId, 'pu');
      assert.equal(binding.task, request.task);
      assert.equal(binding.provider, 'groq');
      assert.equal(binding.model, 'openai/gpt-oss-120b');
      assert.equal(JSON.stringify(h.calls[method]).includes(handle), false);
      assert.equal(
        JSON.stringify(h.calls[method]).includes(request.data.query ?? request.data.utterance),
        false,
      );
      if (method === 'claim') assert.equal(confirmed, confirmationId);
      assert.equal(h.calls.source.length, kind === 'navigation' ? 1 : 0);
      if (kind === 'navigation') {
        const [school, query, signal] = h.calls.source[0];
        assert.equal(school, 'pu');
        assert.equal(query, request.data.query);
        assert.ok(signal instanceof globalThis.AbortSignal);
        assert.equal(h.calls.source[0].length, 3);
        assert.equal(JSON.stringify(h.calls.source).includes(handle), false);
        assert.equal(JSON.stringify(h.calls.source).includes(actor.platformAccountId), false);
      }
    });
  }
}

for (const approved of [false, 'true', 1, null]) {
  test(`approval ${JSON.stringify(approved)} does not resolve a session or reserve anything`, async () => {
    const h = harness();
    await rejectsCode(
      h.service.confirm(authorization, { approved, request: payload() }),
      'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
    );
    assert.equal(h.calls.session.length, 0);
    assert.equal(h.calls.source.length, 0);
    noLedger(h.calls);
  });
}

for (const [label, mutate] of [
  [
    'private task',
    (raw) => {
      raw.request.task = 'submitAssignment';
    },
  ],
  [
    'forged owner',
    (raw) => {
      raw.platformAccountId = actor.platformAccountId;
    },
  ],
  [
    'forged session revision',
    (raw) => {
      raw.request.data.revision = 5;
    },
  ],
  [
    'changed consent',
    (raw) => {
      raw.request.data.consent.query = '不同的要求';
    },
  ],
  [
    'extra private payload',
    (raw) => {
      raw.request.data.history = ['unapproved fixture'];
    },
  ],
]) {
  test(`rejects ${label} before session/source/ledger work`, async () => {
    const h = harness(),
      raw = { approved: true, request: payload() };
    mutate(raw);
    await rejectsCode(h.service.confirm(authorization, raw), 'PUBLIC_AGENT_INVALID_INPUT');
    assert.equal(h.calls.session.length, 0);
    assert.equal(h.calls.source.length, 0);
    noLedger(h.calls);
  });
}

test('does not invoke confirmation accessors or accept an inherited authorization envelope', async () => {
  const h = harness();
  let reads = 0;
  const accessor = { request: payload() };
  Object.defineProperty(accessor, 'approved', {
    get() {
      reads++;
      return true;
    },
  });
  await rejectsCode(h.service.confirm(authorization, accessor), 'PUBLIC_AGENT_INVALID_INPUT');
  const inherited = Object.assign(Object.create({ platformAccountId: actor.platformAccountId }), {
    approved: true,
    request: payload(),
  });
  await rejectsCode(h.service.confirm(authorization, inherited), 'PUBLIC_AGENT_INVALID_INPUT');
  assert.equal(reads, 0);
  assert.equal(h.calls.session.length, 0);
  noLedger(h.calls);
});

for (const value of [
  undefined,
  '',
  `Bearer ${handle}`,
  'Platform ps_short',
  `${authorization} extra`,
]) {
  test(`rejects malformed authentication ${String(value)} before resolving the session`, async () => {
    const h = harness();
    await rejectsCode(
      h.service.confirm(value, { approved: true, request: payload() }),
      'PUBLIC_AGENT_SESSION_INVALID',
    );
    assert.equal(h.calls.session.length, 0);
    assert.equal(h.calls.source.length, 0);
    noLedger(h.calls);
  });
}

for (const [label, failure, code] of [
  [
    'revoked session',
    Object.assign(new Error('synthetic revocation'), { code: 'PLATFORM_SESSION_INVALID' }),
    'PUBLIC_AGENT_SESSION_INVALID',
  ],
  [
    'unavailable session service',
    new Error('synthetic outage'),
    'PUBLIC_AGENT_SESSION_CHECK_UNAVAILABLE',
  ],
]) {
  test(`${label} is not treated as a guest or accepted identity`, async () => {
    const h = harness({
      resolve: async () => {
        throw failure;
      },
    });
    await rejectsCode(invoke(h, 'confirm'), code);
    assert.equal(h.calls.source.length, 0);
    noLedger(h.calls);
  });
}

for (const method of ['confirm', 'claim']) {
  test(`${method}: unavailable or changed source cannot reach the ledger`, async () => {
    for (const [source, code] of [
      [
        async () => {
          throw new Error('synthetic source outage');
        },
        'PUBLIC_AGENT_SOURCE_UNAVAILABLE',
      ],
      [
        async () => createHash('sha256').update('changed source').digest('hex'),
        'PUBLIC_AGENT_SOURCE_CHANGED',
      ],
      [async () => 'invalid revision', 'PUBLIC_AGENT_SOURCE_CHANGED'],
    ]) {
      const h = harness({ source });
      await rejectsCode(invoke(h, method), code);
      noLedger(h.calls);
    }
  });

  test(`${method}: cancel while public source is blocked stops before a ledger operation`, async () => {
    const started = deferred(),
      source = deferred(),
      controller = new globalThis.AbortController();
    const h = harness({
      source: (_school, _query, signal) => {
        started.resolve(signal);
        return source.promise;
      },
    });
    const pending = invoke(h, method, payload(), controller.signal);
    const signal = await started.promise;
    controller.abort();
    await rejectsCode(pending, 'PUBLIC_AGENT_CANCELLED');
    assert.equal(signal.aborted, true);
    source.resolve(fingerprint);
    await setImmediate();
    noLedger(h.calls);
  });

  test(`${method}: a source that ignores timeout cannot later reserve an operation`, async () => {
    const started = deferred(),
      source = deferred();
    const h = harness({
      timeoutMs: 20,
      source: (_school, _query, signal) => {
        started.resolve(signal);
        return source.promise;
      },
    });
    const pending = invoke(h, method);
    const rejection = rejectsCode(pending, 'PUBLIC_AGENT_TIMEOUT');
    const signal = await started.promise;
    await rejection;
    assert.equal(signal.aborted, true);
    source.resolve(fingerprint);
    await setImmediate();
    noLedger(h.calls);
  });

  test(`${method}: lost commit acknowledgement becomes unknown without an automatic retry`, async () => {
    const h = harness({
      ledger: {
        [method]: async () => {
          throw new Error('synthetic acknowledgement loss');
        },
      },
    });
    await rejectsCode(invoke(h, method), 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
    await setImmediate();
    assert.equal(h.calls[method].length, 1);
    assert.equal(h.calls[method === 'confirm' ? 'claim' : 'confirm'].length, 0);
  });

  test(`${method}: cancellation after persistence begins does not report success when it finishes late`, async () => {
    const started = deferred(),
      commit = deferred(),
      controller = new globalThis.AbortController();
    const h = harness({
      ledger: {
        [method]: () => {
          started.resolve();
          return commit.promise;
        },
      },
    });
    const pending = invoke(h, method, payload(), controller.signal);
    await started.promise;
    controller.abort();
    await rejectsCode(pending, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
    commit.resolve(h.replies[method]);
    await setImmediate();
    assert.equal(h.calls[method].length, 1);
  });

  test(`${method}: a timed-out commit remains unknown even if the ledger later acknowledges it`, async () => {
    const started = deferred(),
      commit = deferred();
    const h = harness({
      timeoutMs: 20,
      ledger: {
        [method]: () => {
          started.resolve();
          return commit.promise;
        },
      },
    });
    const pending = invoke(h, method);
    const rejection = rejectsCode(pending, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
    await started.promise;
    await rejection;
    commit.resolve(h.replies[method]);
    await setImmediate();
    assert.equal(h.calls[method].length, 1);
    assert.equal(h.calls[method === 'confirm' ? 'claim' : 'confirm'].length, 0);
  });
}

test('already canceled input performs no session, source or ledger work', async () => {
  const h = harness(),
    controller = new globalThis.AbortController();
  controller.abort();
  await rejectsCode(invoke(h, 'confirm', payload(), controller.signal), 'PUBLIC_AGENT_CANCELLED');
  assert.equal(h.calls.session.length, 0);
  assert.equal(h.calls.source.length, 0);
  noLedger(h.calls);
});

test('a late session resolution after cancellation cannot read a source or persist admission', async () => {
  const session = deferred(),
    started = deferred(),
    controller = new globalThis.AbortController();
  const h = harness({
    resolve: () => {
      started.resolve();
      return session.promise;
    },
  });
  const pending = invoke(h, 'confirm', payload(), controller.signal);
  await started.promise;
  controller.abort();
  await rejectsCode(pending, 'PUBLIC_AGENT_CANCELLED');
  session.resolve({ ...actor });
  await setImmediate();
  assert.equal(h.calls.session.length, 1);
  assert.equal(h.calls.source.length, 0);
  noLedger(h.calls);
});

test('a canceled old source cannot reserve under a subsequent school or account', async () => {
  const oldSource = deferred(),
    started = deferred(),
    controller = new globalThis.AbortController();
  const nextHandle = `ps_${'b'.repeat(43)}`;
  const nextAuthorization = `Platform ${nextHandle}`;
  const nextActor = {
    ...actor,
    platformAccountId: 'pa_44444444-4444-4444-8444-444444444444',
    credentialId: 'pc_new_fixture',
  };
  const h = harness({
    resolve: async (value) => ({ ...(value === nextAuthorization ? nextActor : actor) }),
    source: (school) => {
      if (school === 'pu') {
        started.resolve();
        return oldSource.promise;
      }
      return Promise.resolve(fingerprint);
    },
  });
  const old = invoke(
    h,
    'confirm',
    payload('navigation', 'pu', 'old_request_001'),
    controller.signal,
  );
  await started.promise;
  controller.abort();
  await rejectsCode(old, 'PUBLIC_AGENT_CANCELLED');
  await h.service.confirm(nextAuthorization, {
    approved: true,
    request: payload('navigation', 'ntu', 'new_request_002'),
  });
  oldSource.resolve(fingerprint);
  await setImmediate();
  assert.equal(h.calls.confirm.length, 1);
  assert.equal(h.calls.confirm[0][0].platformAccountId, nextActor.platformAccountId);
  assert.equal(
    h.calls.confirm[0][0].sessionHash,
    createHash('sha256').update(nextHandle).digest('hex'),
  );
  assert.deepEqual(h.calls.session, [authorization, nextAuthorization]);
  assert.equal(h.calls.confirm[0][1].schoolId, 'ntu');
  assert.equal(h.calls.confirm[0][1].requestId, 'new_request_002');
});

test('caller mutation during session resolution cannot replace approved text or school', async () => {
  const session = deferred(),
    started = deferred();
  const h = harness({
    resolve: () => {
      started.resolve();
      return session.promise;
    },
  });
  const raw = payload();
  const accepted = raw.data.query;
  const pending = invoke(h, 'confirm', raw);
  await started.promise;
  raw.data.schoolId = raw.data.consent.schoolId = 'ntu';
  raw.data.query = raw.data.consent.query = '後來的輸入';
  session.resolve({ ...actor });
  await pending;
  assert.deepEqual(h.calls.source[0].slice(0, 2), ['pu', accepted]);
  assert.equal(h.calls.confirm[0][1].schoolId, 'pu');
});

test('claim rechecks the current source after a successful confirmation', async () => {
  let revision = fingerprint;
  const h = harness({ source: async () => revision });
  await invoke(h, 'confirm');
  revision = createHash('sha256').update('a new public POI revision').digest('hex');
  await rejectsCode(invoke(h, 'claim'), 'PUBLIC_AGENT_SOURCE_CHANGED');
  assert.equal(h.calls.confirm.length, 1);
  assert.equal(h.calls.claim.length, 0);
  assert.equal(h.calls.source.length, 2);
});

test('a ledger revocation or quota rejection is preserved, not reported as an admitted task', async () => {
  for (const [code, statusCode] of [
    ['PUBLIC_AGENT_SESSION_EXPIRED', 401],
    ['PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE', 429],
  ]) {
    const h = harness({
      ledger: {
        claim: async () => {
          throw new PublicAgentError(code, statusCode);
        },
      },
    });
    await rejectsCode(invoke(h, 'claim'), code);
    assert.equal(h.calls.claim.length, 1);
  }
});

test('status reads re-resolve identity and pass school scope without confirming or claiming', async () => {
  const h = harness();
  const lookup = {
    task: 'public-campus-navigation',
    requestId: 'public_request_001',
    schoolId: 'pu',
  };
  const result = await h.service.read(authorization, lookup);
  assert.deepEqual(result, h.replies.read);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'operationId', 'status']);
  assert.equal(result.status, 'pending');
  assert.deepEqual(h.calls.read[0][1], lookup);
  assert.equal(h.calls.read[0][0].sessionHash, createHash('sha256').update(handle).digest('hex'));
  assert.equal(h.calls.session.length, 1);
  assert.equal(h.calls.source.length, 0);
  assert.equal(h.calls.confirm.length + h.calls.claim.length, 0);
  const changedSchool = { ...lookup, schoolId: 'ntu' };
  await h.service.read(authorization, changedSchool);
  assert.equal(h.calls.read[1][1].schoolId, 'ntu');
  assert.equal(h.calls.session.length, 2);
});

test('an unavailable status read does not infer completion or retry a claim', async () => {
  const h = harness({
    ledger: {
      read: async () => {
        throw new Error('synthetic store outage');
      },
    },
  });
  await rejectsCode(
    h.service.read(authorization, {
      task: 'campus-service-entry',
      requestId: 'public_request_001',
      schoolId: 'pu',
    }),
    'PUBLIC_AGENT_STATE_UNAVAILABLE',
  );
  assert.equal(h.calls.read.length, 1);
  assert.equal(h.calls.confirm.length + h.calls.claim.length, 0);
});

test('missing public source or admission dependencies fail closed before any call', () => {
  const h = harness();
  for (const options of [
    { ...h.options, readPublicSourceFingerprint: undefined },
    { ...h.options, accounts: {} },
    { ...h.options, ledger: { confirm: async () => ({}) } },
    { ...h.options, timeoutMs: 0 },
    { ...h.options, timeoutMs: 30_001 },
  ]) {
    assert.throws(
      () => new PlatformPublicAdmission(options),
      (error) => error instanceof PublicAgentError && error.code === 'PUBLIC_AGENT_NOT_CONFIGURED',
    );
  }
  assert.equal(h.calls.session.length, 0);
  assert.equal(h.calls.source.length, 0);
  noLedger(h.calls);
});
