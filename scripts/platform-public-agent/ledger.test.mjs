import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlatformPublicAgentLedger,
  policy,
  hash,
  TransactionFixture,
  fixture,
  binding,
  lookup,
  rejectsCode,
  quotas,
  admissionFixture,
  publicRequest,
  requestLookup,
  FREE_MODEL,
  FREE_PROVIDER,
  publicOperation,
} from './fixtures.mjs';

const resultFor = (f, b = binding()) => ({
  task: b.task,
  schoolId: b.schoolId,
  sourceFingerprint: hash('public source'),
  checkedAt: f.db.now,
  receipt: {
    from: { id: 'library', name: '圖書館' },
    to: { id: 'cafeteria', name: '餐廳' },
    distanceMeters: 120,
  },
});
async function claimedFixture(overrides = {}, change = {}, startDispatch = true) {
  const f = fixture(overrides),
    b = binding(change),
    confirmation = await f.ledger.confirm(f.actor, b);
  const claim = await f.ledger.claim(f.actor, b, confirmation.confirmationId);
  assert.equal(claim.status, 'claimed');
  if (startDispatch)
    await f.ledger.beginDispatch(f.actor, b, claim.operationId, claim.executionToken);
  return { ...f, b, confirmation, claim };
}

test('both public tasks admit platform actors without tenant, person, membership or Firebase', async () => {
  const f = fixture();
  for (const task of ['public-campus-navigation', 'campus-service-entry']) {
    const b = binding({ task }),
      confirmation = await f.ledger.confirm(f.actor, b);
    const claim = await f.ledger.claim(f.actor, b, confirmation.confirmationId);
    assert.equal(claim.status, 'claimed');
    assert.ok(claim.expiresAt > f.db.now);
    assert.deepEqual(await f.ledger.read(f.actor, lookup(b)), {
      ...publicOperation(claim),
      status: 'pending',
    });
  }
  assert.deepEqual(quotas(f.db), [2, 2]);
});
test('confirm is idempotent and does not reserve quota or an operation', async () => {
  const f = fixture(),
    b = binding(),
    first = await f.ledger.confirm(f.actor, b);
  assert.deepEqual(await f.ledger.confirm(f.actor, b), first);
  assert.equal(f.db.data.confirmations.size, 1);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
});
test('confirmation capacity blocks new request IDs but preserves replay without a capacity read', async () => {
  const f = fixture({ maxConfirmationsPerAccount: 1 }),
    b = binding();
  const first = await f.ledger.confirm(f.actor, b);
  await assert.rejects(f.ledger.confirm(f.actor, binding({ requestId: 'request_0002' })), {
    code: 'PUBLIC_AGENT_CONFIRMATION_CAPACITY',
    statusCode: 429,
  });
  const replayStart = f.db.events.length;
  assert.deepEqual(await f.make().confirm(f.actor, b), first);
  assert.equal(
    f.db.events.slice(replayStart).some((event) => event.action === 'confirmation-capacity'),
    false,
  );
  assert.equal(f.db.data.confirmations.size, 1);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
});
test('consumed and expired confirmations both count, while another account keeps its own capacity', async () => {
  const f = fixture({ maxConfirmationsPerAccount: 2, confirmationTtlMs: 20, operationTtlMs: 10 });
  const used = binding(),
    expired = binding({ requestId: 'request_0002', schoolId: 'other' });
  const first = await f.ledger.confirm(f.actor, used);
  const operation = await f.ledger.claim(f.actor, used, first.confirmationId);
  await f.ledger.confirm(f.actor, expired);
  f.db.now += 21;
  await rejectsCode(
    f.ledger.confirm(f.actor, binding({ requestId: 'request_0003', schoolId: 'other' })),
    'PUBLIC_AGENT_CONFIRMATION_CAPACITY',
  );
  await rejectsCode(f.ledger.confirm(f.actor, expired), 'PUBLIC_AGENT_CONFIRMATION_EXPIRED');
  assert.deepEqual(await f.ledger.claim(f.actor, used, first.confirmationId), {
    ...publicOperation(operation),
    status: 'unknown',
  });
  const other = f.db.actor();
  assert.ok((await f.ledger.confirm(other, used)).confirmationId);
  assert.equal(f.db.data.confirmations.size, 3);
  assert.equal(f.db.data.operations.size, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('two instances competing for the final confirmation slot retain only one binding in the transaction fixture', async () => {
  const f = fixture({ maxConfirmationsPerAccount: 1 });
  const results = await Promise.allSettled([
    f.ledger.confirm(f.actor, binding()),
    f.make().confirm(f.actor, binding({ requestId: 'request_0002' })),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'PUBLIC_AGENT_CONFIRMATION_CAPACITY');
  assert.equal(f.db.data.confirmations.size, 1);
  assert.equal(f.db.data.quota.size, 0);
  for (const event of f.db.events.filter((item) => item.action === 'confirmation-capacity')) {
    const prior = f.db.events.slice(0, f.db.events.indexOf(event));
    assert.ok(
      prior.some(
        (item) =>
          item.tx === event.tx &&
          item.action === 'lock' &&
          item.values[0] === `public-agent:account:${f.actor.platformAccountId}`,
      ),
    );
  }
});
test('a rolled-back confirmation insert leaves capacity available for the next request', async () => {
  const f = fixture({ maxConfirmationsPerAccount: 1 });
  f.db.failAction = 'insert-confirmation';
  await rejectsCode(f.ledger.confirm(f.actor, binding()), 'SYNTHETIC_WRITE_FAILURE');
  assert.equal(f.db.data.confirmations.size, 0);
  const next = binding({ requestId: 'request_0002' });
  const confirmation = await f.make().confirm(f.actor, next);
  assert.deepEqual(await f.ledger.confirm(f.actor, next), confirmation);
  assert.equal(f.db.data.confirmations.size, 1);
  assert.equal(f.db.data.quota.size, 0);
});
test('two ledger instances sharing the transaction fixture claim once and replay pending', async () => {
  const f = fixture(),
    b = binding(),
    confirmation = await f.ledger.confirm(f.actor, b),
    other = f.make();
  const result = await Promise.all([
    f.ledger.claim(f.actor, b, confirmation.confirmationId),
    other.claim(f.actor, b, confirmation.confirmationId),
  ]);
  assert.deepEqual(result.map((item) => item.status).sort(), ['claimed', 'pending']);
  assert.equal(result[0].operationId, result[1].operationId);
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('a restarted ledger reads and replays the stored operation, without consuming again', async () => {
  const f = fixture(),
    b = binding(),
    confirmation = await f.ledger.confirm(f.actor, b);
  const first = await f.ledger.claim(f.actor, b, confirmation.confirmationId);
  assert.deepEqual(await f.make().claim(f.actor, b, confirmation.confirmationId), {
    ...publicOperation(first),
    status: 'pending',
  });
  assert.deepEqual(quotas(f.db), [1, 1]);
});
for (const change of [{ payloadHash: hash('other text') }, { schoolId: 'ntu' }]) {
  test(`same request ID rejects changed ${Object.keys(change)[0]}`, async () => {
    const f = fixture(),
      b = binding(),
      c = await f.ledger.confirm(f.actor, b);
    await f.ledger.claim(f.actor, b, c.confirmationId);
    await rejectsCode(f.ledger.confirm(f.actor, binding(change)), 'PUBLIC_AGENT_REQUEST_CONFLICT');
    await rejectsCode(
      f.ledger.claim(f.actor, binding(change), c.confirmationId),
      'PUBLIC_AGENT_REQUEST_CONFLICT',
    );
    assert.deepEqual(quotas(f.db), [1, 1]);
  });
}
test('a confirmation cannot authorize a new request key or a different task', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  for (const change of [{ requestId: 'request_0002' }, { task: 'campus-service-entry' }])
    await rejectsCode(
      f.ledger.claim(f.actor, binding(change), c.confirmationId),
      'PUBLIC_AGENT_REQUEST_CONFLICT',
    );
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
});
test('a different valid session cannot confirm, claim, read or mark the original operation', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  const op = await f.ledger.claim(f.actor, b, c.confirmationId),
    other = f.db.anotherSession(f.actor);
  for (const call of [
    () => f.ledger.confirm(other, b),
    () => f.ledger.claim(other, b, c.confirmationId),
    () => f.ledger.read(other, lookup(b)),
    () => f.ledger.markUnknown(other, b, op.operationId, op.executionToken),
  ])
    await rejectsCode(call(), 'PUBLIC_AGENT_REQUEST_CONFLICT');
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('a different valid credential in the same account does not inherit confirmation', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  const other = {
    ...f.actor,
    credentialId: 'pac_other',
    sessionHash: hash('synthetic-other-credential-session'),
  };
  f.db.data.credentials.set(other.credentialId, {
    account: other.platformAccountId,
    state: 'active',
    method: 'google',
  });
  f.db.data.sessions.set(other.sessionHash, {
    account: other.platformAccountId,
    credential: other.credentialId,
    expiresAt: other.expiresAt,
  });
  await rejectsCode(f.ledger.claim(other, b, c.confirmationId), 'PUBLIC_AGENT_REQUEST_CONFLICT');
});
test('account isolation and selected-school read isolation hold without membership inference', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b),
    other = f.db.actor();
  await f.ledger.claim(f.actor, b, c.confirmationId);
  assert.equal(await f.ledger.read(other, lookup(b)), null);
  await rejectsCode(
    f.ledger.claim(other, b, c.confirmationId),
    'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
  );
  await rejectsCode(
    f.ledger.read(f.actor, { ...lookup(b), schoolId: 'ntu' }),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
});
test('expired unclaimed confirmation is not reissued or admitted', async () => {
  const f = fixture({ confirmationTtlMs: 10 }),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.now += 10;
  await rejectsCode(f.ledger.confirm(f.actor, b), 'PUBLIC_AGENT_CONFIRMATION_EXPIRED');
  await rejectsCode(
    f.ledger.claim(f.actor, b, c.confirmationId),
    'PUBLIC_AGENT_CONFIRMATION_EXPIRED',
  );
  assert.equal(f.db.data.quota.size, 0);
  assert.equal(f.db.data.operations.size, 0);
});
for (const method of ['claim', 'read'])
  test(`${method} persists expired running as unknown without re-admission`, async () => {
    const f = fixture({ confirmationTtlMs: 10, operationTtlMs: 5 }),
      b = binding(),
      c = await f.ledger.confirm(f.actor, b);
    const op = await f.ledger.claim(f.actor, b, c.confirmationId);
    f.db.now += 20;
    const result =
      method === 'claim'
        ? await f.ledger.claim(f.actor, b, c.confirmationId)
        : await f.ledger.read(f.actor, lookup(b));
    assert.deepEqual(result, { ...publicOperation(op), status: 'unknown' });
    assert.equal([...f.db.data.operations.values()][0].status, 'unknown');
    assert.deepEqual(await f.make().claim(f.actor, b, c.confirmationId), {
      ...publicOperation(op),
      status: 'unknown',
    });
    assert.deepEqual(quotas(f.db), [1, 1]);
  });
test('markUnknown is owner/content/session-bound and cannot introduce a new operation', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b),
    op = await f.ledger.claim(f.actor, b, c.confirmationId);
  await rejectsCode(
    f.ledger.markUnknown(
      f.actor,
      binding({ payloadHash: hash('wrong') }),
      op.operationId,
      op.executionToken,
    ),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  await rejectsCode(
    f.ledger.markUnknown(
      f.actor,
      b,
      'pago_00000000-0000-0000-0000-000000000000',
      op.executionToken,
    ),
    'PUBLIC_AGENT_OPERATION_NOT_FOUND',
  );
  assert.deepEqual(await f.ledger.markUnknown(f.actor, b, op.operationId, op.executionToken), {
    ...publicOperation(op),
    status: 'unknown',
  });
  assert.equal(
    (await f.ledger.markUnknown(f.actor, b, op.operationId, op.executionToken)).status,
    'unknown',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('the final account budget slot admits one concurrent request and rolls back the other consume/provider debit', async () => {
  const f = fixture({ accountDailyLimit: 1 }),
    a = binding(),
    b = binding({ requestId: 'request_0002', schoolId: 'other' });
  const [ca, cb] = await Promise.all([f.ledger.confirm(f.actor, a), f.ledger.confirm(f.actor, b)]);
  const result = await Promise.allSettled([
    f.ledger.claim(f.actor, a, ca.confirmationId),
    f.make().claim(f.actor, b, cb.confirmationId),
  ]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    result.find((item) => item.status === 'rejected').reason.code,
    'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
  assert.equal(f.db.data.operations.size, 1);
  assert.equal(
    [...f.db.data.confirmations.values()].filter((row) => row.consumed_at === null).length,
    1,
  );
});
test('the server provider budget is shared across distinct accounts and ledger instances', async () => {
  const f = fixture({ providerDailyLimit: 1 }),
    b = binding(),
    other = f.db.actor();
  const ca = await f.ledger.confirm(f.actor, b),
    cb = await f.ledger.confirm(other, b);
  const result = await Promise.allSettled([
    f.ledger.claim(f.actor, b, ca.confirmationId),
    f.make().claim(other, b, cb.confirmationId),
  ]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    result.find((item) => item.status === 'rejected').reason.code,
    'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE',
  );
  assert.equal(f.db.data.operations.size, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('database failure after consume and both debits rolls the entire transaction back', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.failAction = 'insert-operation';
  await assert.rejects(f.ledger.claim(f.actor, b, c.confirmationId), /synthetic database failure/u);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
  assert.equal([...f.db.data.confirmations.values()][0].consumed_at, null);
  assert.equal((await f.ledger.claim(f.actor, b, c.confirmationId)).status, 'claimed');
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('a lost commit response leaves an observable operation and replay never reserves again', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.loseCommitAck = true;
  await assert.rejects(
    f.ledger.claim(f.actor, b, c.confirmationId),
    /synthetic lost commit response/u,
  );
  assert.equal((await f.make().read(f.actor, lookup(b))).status, 'pending');
  assert.equal((await f.make().claim(f.actor, b, c.confirmationId)).status, 'pending');
  assert.deepEqual(quotas(f.db), [1, 1]);
});
for (const revoke of ['account', 'credential', 'session'])
  test(`${revoke} revocation denies every ledger operation`, async () => {
    const f = fixture(),
      b = binding(),
      c = await f.ledger.confirm(f.actor, b),
      op = await f.ledger.claim(f.actor, b, c.confirmationId);
    if (revoke === 'account') f.db.data.accounts.get(f.actor.platformAccountId).state = 'suspended';
    if (revoke === 'credential') f.db.data.credentials.get(f.actor.credentialId).state = 'disabled';
    if (revoke === 'session') f.db.data.sessions.delete(f.actor.sessionHash);
    for (const call of [
      () => f.ledger.confirm(f.actor, b),
      () => f.ledger.claim(f.actor, b, c.confirmationId),
      () => f.ledger.read(f.actor, lookup(b)),
      () => f.ledger.markUnknown(f.actor, b, op.operationId, op.executionToken),
    ])
      await rejectsCode(call(), 'PUBLIC_AGENT_SESSION_EXPIRED');
    assert.deepEqual(quotas(f.db), [1, 1]);
  });
test('database session expiry is authoritative even when the optional local clock is behind', async () => {
  const f = fixture(),
    b = binding();
  f.db.data.sessions.get(f.actor.sessionHash).expiresAt = f.db.now - 1;
  await rejectsCode(
    f.make({}, () => f.db.now - 60_000).confirm(f.actor, b),
    'PUBLIC_AGENT_SESSION_EXPIRED',
  );
});
test('a session expiring while the advisory lock waits is rechecked before any admission', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.beforeAction = (action) => {
    if (action === 'lock') f.db.now = f.actor.expiresAt + 1;
  };
  await rejectsCode(f.ledger.claim(f.actor, b, c.confirmationId), 'PUBLIC_AGENT_SESSION_EXPIRED');
  assert.equal(f.db.data.quota.size, 0);
  assert.equal(f.db.data.operations.size, 0);
});
test('confirmation expiry while waiting uses fresh database time, not transaction-start time', async () => {
  const f = fixture({ confirmationTtlMs: 10 }),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.beforeAction = (action) => {
    if (action === 'lock') f.db.now += 10;
  };
  await rejectsCode(
    f.ledger.claim(f.actor, b, c.confirmationId),
    'PUBLIC_AGENT_CONFIRMATION_EXPIRED',
  );
  assert.equal(f.db.data.quota.size, 0);
});
test('expiry between debit and operation insertion rolls back all admission writes', async () => {
  const f = fixture({ confirmationTtlMs: 10 }),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.beforeAction = (action) => {
    if (action === 'insert-operation') f.db.now += 10;
  };
  await rejectsCode(f.ledger.claim(f.actor, b, c.confirmationId), 'PUBLIC_AGENT_ADMISSION_EXPIRED');
  assert.equal(f.db.data.quota.size, 0);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal([...f.db.data.confirmations.values()][0].consumed_at, null);
});
test('both daily debits use one database UTC window even across midnight', async () => {
  const f = fixture(),
    b = binding();
  f.db.now = Date.parse('2026-11-03T23:59:59.990Z');
  f.actor.expiresAt = f.db.now + 3_600_000;
  f.db.data.sessions.get(f.actor.sessionHash).expiresAt = f.actor.expiresAt;
  const c = await f.ledger.confirm(f.actor, b);
  let first = true;
  f.db.beforeAction = (action) => {
    if (action === 'insert-quota' && first) {
      first = false;
      f.db.now += 20;
    }
  };
  await f.ledger.claim(f.actor, b, c.confirmationId);
  assert.ok([...f.db.data.quota.keys()].every((value) => JSON.parse(value)[2] === '2026-11-03'));
});
test('claim protocol locks identity first, then global budget and account, before consuming', async () => {
  const f = fixture(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b);
  f.db.events = [];
  await f.ledger.claim(f.actor, b, c.confirmationId);
  assert.deepEqual(
    f.db.events.slice(0, 7).map((event) => event.action),
    ['begin', 'account', 'credential', 'session', 'lock', 'lock', 'session'],
  );
  const locks = f.db.events
    .filter((event) => event.action === 'lock')
    .map((event) => event.values[0]);
  assert.deepEqual(locks, [
    `public-agent:provider:${policy.providerBudgetKey}`,
    `public-agent:account:${f.actor.platformAccountId}`,
  ]);
  assert.ok(
    f.db.events.findIndex((event) => event.action === 'read-operation') <
      f.db.events.findIndex((event) => event.action === 'update-confirmation'),
  );
});
test('mutable caller actor and binding are snapshotted before the first await', async () => {
  const f = fixture(),
    actor = { ...f.actor },
    b = binding();
  const pending = f.ledger.confirm(actor, b);
  actor.sessionHash = hash('changed');
  b.schoolId = 'ntu';
  b.payloadHash = hash('changed');
  await pending;
  const row = [...f.db.data.confirmations.values()][0];
  assert.equal(row.session_hash, f.actor.sessionHash);
  assert.equal(row.school_id, 'pu');
  assert.equal(row.payload_hash, binding().payloadHash);
});
test('invalid policy fails closed instead of silently accepting unlimited budgets', () => {
  const db = new TransactionFixture();
  for (const change of [
    { providerBudgetKey: '' },
    { providerDailyLimit: 0 },
    { accountDailyLimit: Infinity },
    { accountDailyLimit: 10_001 },
    { maxConfirmationsPerAccount: 0 },
    { maxConfirmationsPerAccount: 10_001 },
    { maxConfirmationsPerAccount: 1.5 },
    { maxConfirmationsPerAccount: null },
    { maxConfirmationsPerAccount: '1' },
    { confirmationTtlMs: 0 },
    { operationTtlMs: 30_001 },
  ])
    assert.throws(() => new PlatformPublicAgentLedger(db, { ...policy, ...change }), {
      code: 'PUBLIC_AGENT_CONFIGURATION_REQUIRED',
    });
});
test('ledger rejects injected fields, malformed bindings and expired local actor before SQL', async () => {
  const f = fixture();
  for (const change of [
    { task: 'read-grades' },
    { model: 'paid-model' },
    { provider: 'other' },
    { uid: 'injected' },
    { requestId: 'short' },
    { schoolId: '../other' },
    { payloadHash: 'not-a-hash' },
  ])
    await rejectsCode(f.ledger.confirm(f.actor, binding(change)), 'PUBLIC_AGENT_INVALID_INPUT');
  await rejectsCode(
    f.ledger.confirm({ ...f.actor, expiresAt: f.db.now }, binding()),
    'PUBLIC_AGENT_SESSION_EXPIRED',
  );
  assert.equal(f.db.events.length, 0);
});

for (const task of ['campus-service-entry', 'public-campus-navigation']) {
  test(`composed ${task}: confirmation, claim, status and replay share one operation and quota debit`, async () => {
    const f = admissionFixture(),
      request = publicRequest(task);
    const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
    assert.equal(f.db.data.operations.size, 0);
    const claim = await f.admission.claim(f.authorization, {
      confirmationId: confirmation.confirmationId,
      request,
    });
    assert.equal(claim.status, 'claimed');
    assert.deepEqual(Object.keys(claim).sort(), [
      'executionToken',
      'expiresAt',
      'operationId',
      'status',
    ]);
    const pending = { ...publicOperation(claim), status: 'pending' };
    assert.deepEqual(await f.admission.read(f.authorization, requestLookup(request)), pending);
    assert.deepEqual(
      await f.admission.claim(f.authorization, {
        confirmationId: confirmation.confirmationId,
        request,
      }),
      pending,
    );
    assert.equal(f.db.data.operations.size, 1);
    assert.deepEqual(quotas(f.db), [1, 1]);
    const row = [...f.db.data.operations.values()][0];
    assert.equal(row.session_hash, f.actor.sessionHash);
    assert.equal(row.provider, FREE_PROVIDER);
    assert.equal(row.model, FREE_MODEL);
    assert.equal(f.source.calls.length, task === 'public-campus-navigation' ? 3 : 0);
  });
}

test('composed expiry persists unknown and cannot turn a repeated admission into a fresh claim', async () => {
  const f = admissionFixture({ confirmationTtlMs: 20, operationTtlMs: 10 }),
    request = publicRequest();
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  const claim = await f.admission.claim(f.authorization, {
    confirmationId: confirmation.confirmationId,
    request,
  });
  f.db.now += 21;
  const unknown = { ...publicOperation(claim), status: 'unknown' };
  assert.deepEqual(await f.admission.read(f.authorization, requestLookup(request)), unknown);
  assert.deepEqual(
    await f.admission.claim(f.authorization, {
      confirmationId: confirmation.confirmationId,
      request,
    }),
    unknown,
  );
  await rejectsCode(
    f.admission.claim(f.authorization, {
      confirmationId: confirmation.confirmationId,
      request: publicRequest('public-campus-navigation', 'pu', 'composed_request_0002'),
    }),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  assert.equal(f.db.data.operations.size, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('composed account and school boundaries cannot reuse another approved operation', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  await f.admission.claim(f.authorization, {
    confirmationId: confirmation.confirmationId,
    request,
  });
  const otherAuthorization = f.register(f.db.actor(), 'b');
  await rejectsCode(
    f.admission.claim(otherAuthorization, { confirmationId: confirmation.confirmationId, request }),
    'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
  );
  assert.equal(await f.admission.read(otherAuthorization, requestLookup(request)), null);
  const changedSchool = publicRequest('public-campus-navigation', 'ntu');
  await rejectsCode(
    f.admission.claim(f.authorization, {
      confirmationId: confirmation.confirmationId,
      request: changedSchool,
    }),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  await rejectsCode(
    f.admission.read(f.authorization, requestLookup(changedSchool)),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  assert.equal(f.db.data.operations.size, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('composed missing commit acknowledgement reports unknown, then status recovers pending without resending', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  f.db.loseCommitAck = true;
  await rejectsCode(
    f.admission.claim(f.authorization, { confirmationId: confirmation.confirmationId, request }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  const row = [...f.db.data.operations.values()][0];
  assert.ok(row);
  assert.deepEqual(await f.admission.read(f.authorization, requestLookup(request)), {
    status: 'pending',
    operationId: row.id,
    expiresAt: new Date(row.expires_at).getTime(),
  });
  assert.equal(f.db.events.filter((event) => event.action === 'insert-operation').length, 1);
  assert.equal(f.db.events.filter((event) => event.action === 'update-confirmation').length, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('composed source change after confirmation rejects before any consume or quota debit', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  const eventCount = f.db.events.length;
  f.source.fingerprint = hash('changed synthetic public source');
  await rejectsCode(
    f.admission.claim(f.authorization, { confirmationId: confirmation.confirmationId, request }),
    'PUBLIC_AGENT_SOURCE_CHANGED',
  );
  assert.equal(f.db.events.length, eventCount);
  assert.equal([...f.db.data.confirmations.values()][0].consumed_at, null);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
  assert.equal(await f.admission.read(f.authorization, requestLookup(request)), null);
});

test('composed password role revocation after resolution denies admission before consuming or charging', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  f.db.data.credentials.get(f.actor.credentialId).method = 'password';
  f.db.data.operatorAssignments.set(f.actor.platformAccountId, {
    role: 'platform-operator',
    state: 'active',
  });
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  // The resolver has accepted this password session before the public source is read.
  // Revoking the assignment alone does not delete the still-valid session row.
  f.source.beforeRead = () => {
    f.db.data.operatorAssignments.get(f.actor.platformAccountId).state = 'revoked';
  };
  await rejectsCode(
    f.admission.claim(f.authorization, { confirmationId: confirmation.confirmationId, request }),
    'PUBLIC_AGENT_SESSION_EXPIRED',
  );
  assert.equal(f.db.data.sessions.has(f.actor.sessionHash), true);
  assert.equal(f.db.data.confirmations.values().next().value.consumed_at, null);
  assert.equal(f.db.data.operations.size, 0);
  assert.equal(f.db.data.quota.size, 0);
});

test('composed ordinary OAuth session works without an operator assignment or assignment read', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  const result = await f.admission.claim(f.authorization, {
    confirmationId: confirmation.confirmationId,
    request,
  });
  assert.equal(result.status, 'claimed');
  assert.equal(f.db.data.operatorAssignments.size, 0);
  assert.equal(
    f.db.events.some((event) => event.action === 'operator-assignment'),
    false,
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('composed active password session locks its assignment between credential and session', async () => {
  const f = admissionFixture(),
    request = publicRequest();
  f.db.data.credentials.get(f.actor.credentialId).method = 'password';
  f.db.data.operatorAssignments.set(f.actor.platformAccountId, {
    role: 'platform-operator',
    state: 'active',
  });
  const confirmation = await f.admission.confirm(f.authorization, { approved: true, request });
  const result = await f.admission.claim(f.authorization, {
    confirmationId: confirmation.confirmationId,
    request,
  });
  assert.deepEqual(await f.admission.read(f.authorization, requestLookup(request)), {
    ...publicOperation(result),
    status: 'pending',
  });
  for (const begin of f.db.events.filter((event) => event.action === 'begin')) {
    assert.deepEqual(
      f.db.events
        .filter((event) => event.tx === begin.tx)
        .slice(1, 5)
        .map((event) => event.action),
      ['account', 'credential', 'operator-assignment', 'session'],
    );
  }
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('missing credential method cannot bypass the password assignment check', async () => {
  for (const method of [undefined, null, '']) {
    const f = fixture();
    f.db.data.credentials.get(f.actor.credentialId).method = method;
    await rejectsCode(f.ledger.confirm(f.actor, binding()), 'PUBLIC_AGENT_STORE_INVALID');
    assert.equal(f.db.data.confirmations.size, 0);
    assert.equal(f.db.data.operations.size, 0);
    assert.equal(f.db.data.quota.size, 0);
  }
});

test('only the first claim returns an execution capability; the stored token is hashed', async () => {
  const f = await claimedFixture();
  assert.match(f.claim.executionToken, /^[A-Za-z0-9_-]{43}$/u);
  const row = [...f.db.data.operations.values()][0];
  assert.equal(row.execution_token_hash, hash(f.claim.executionToken));
  for (const value of [
    await f.ledger.read(f.actor, lookup(f.b)),
    await f.ledger.readBound(f.actor, f.b),
    await f.make().claim(f.actor, f.b, f.confirmation.confirmationId),
  ]) {
    assert.equal(Object.hasOwn(value, 'executionToken'), false);
    assert.equal(Object.hasOwn(value, 'execution_token_hash'), false);
  }
  assert.equal(
    JSON.stringify([...f.db.data.operations.values()]).includes(f.claim.executionToken),
    false,
  );
  await rejectsCode(
    f.ledger.complete(f.actor, f.b, f.claim.operationId, 'x'.repeat(43), resultFor(f)),
    'PUBLIC_AGENT_EXECUTION_LEASE_INVALID',
  );
  await rejectsCode(
    f.ledger.markUnknown(f.actor, f.b, f.claim.operationId, undefined),
    'PUBLIC_AGENT_EXECUTION_LEASE_INVALID',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('completed result survives the execution deadline, stays bound to the original request and never exposes a lease', async () => {
  const f = await claimedFixture({ operationTtlMs: 5 });
  const expected = { ...publicOperation(f.claim), status: 'completed', result: resultFor(f) };
  assert.deepEqual(
    await f.ledger.complete(
      f.actor,
      f.b,
      f.claim.operationId,
      f.claim.executionToken,
      resultFor(f),
    ),
    expected,
  );
  f.db.now += 10;
  assert.deepEqual(await f.make().readBound(f.actor, f.b), expected);
  assert.deepEqual(await f.ledger.claim(f.actor, f.b, f.confirmation.confirmationId), expected);
  await rejectsCode(
    f.ledger.readBound(f.actor, binding({ payloadHash: hash('different query') })),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  await rejectsCode(
    f.ledger.readBound(f.actor, binding({ schoolId: 'ntu' })),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

for (const method of ['complete', 'fail'])
  test(`${method}: expiry between locked read and final CAS commits unknown`, async () => {
    const f = await claimedFixture({ operationTtlMs: 5 });
    f.db.beforeAction = (action) => {
      if (action === 'finalize-operation') f.db.now += 5;
    };
    const extra = method === 'complete' ? resultFor(f) : 'EXECUTION_FAILED';
    const observed = await f.ledger[method](
      f.actor,
      f.b,
      f.claim.operationId,
      f.claim.executionToken,
      extra,
    );
    assert.deepEqual(observed, { ...publicOperation(f.claim), status: 'unknown' });
    assert.equal([...f.db.data.operations.values()][0].status, 'unknown');
    assert.equal([...f.db.data.operations.values()][0].result_json, null);
    assert.equal(f.db.events.at(-1).action, 'commit');
    assert.equal(
      (
        await f.ledger.complete(
          f.actor,
          f.b,
          f.claim.operationId,
          f.claim.executionToken,
          resultFor(f),
        )
      ).status,
      'unknown',
    );
    assert.deepEqual(quotas(f.db), [1, 1]);
  });

test('a single terminal transition wins concurrent finalize attempts without overwriting the receipt', async () => {
  const f = await claimedFixture(),
    result = resultFor(f);
  const values = await Promise.all([
    f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, result),
    f.make().fail(f.actor, f.b, f.claim.operationId, f.claim.executionToken, 'EXECUTION_FAILED'),
    f.make().markUnknown(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
  ]);
  assert.ok(values.every((value) => value.status === 'completed'));
  assert.deepEqual(values[0].result, result);
  assert.equal(f.db.events.filter((event) => event.action === 'finalize-operation').length, 1);
  const changed = resultFor(f);
  changed.receipt.distanceMeters = 999;
  assert.deepEqual(
    (await f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, changed))
      .result,
    result,
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('failed and unknown remain terminal without refund or a new claim', async () => {
  for (const status of ['failed', 'unknown']) {
    const f = await claimedFixture();
    const ended =
      status === 'failed'
        ? await f.ledger.fail(
            f.actor,
            f.b,
            f.claim.operationId,
            f.claim.executionToken,
            'SOURCE_CHANGED',
          )
        : await f.ledger.markUnknown(f.actor, f.b, f.claim.operationId, f.claim.executionToken);
    assert.equal(ended.status, status);
    if (status === 'failed') assert.equal(ended.failureCode, 'SOURCE_CHANGED');
    assert.deepEqual(
      await f.ledger.complete(
        f.actor,
        f.b,
        f.claim.operationId,
        f.claim.executionToken,
        resultFor(f),
      ),
      ended,
    );
    assert.deepEqual(await f.make().claim(f.actor, f.b, f.confirmation.confirmationId), ended);
    assert.deepEqual(await f.ledger.readBound(f.actor, f.b), ended);
    assert.deepEqual(quotas(f.db), [1, 1]);
  }
});

test('result validation snapshots nested data before awaiting and returns detached read objects', async () => {
  const f = await claimedFixture(),
    input = resultFor(f),
    expected = globalThis.structuredClone(input);
  const pending = f.ledger.complete(
    f.actor,
    f.b,
    f.claim.operationId,
    f.claim.executionToken,
    input,
  );
  input.receipt.from.name = 'changed while waiting';
  assert.deepEqual((await pending).result, expected);
  const firstRead = await f.ledger.readBound(f.actor, f.b);
  firstRead.result.receipt.from.name = 'mutated delivered view';
  assert.deepEqual((await f.ledger.readBound(f.actor, f.b)).result, expected);
});

test('invalid or unbounded JSON cannot enter a completed row, and failure text is restricted', async () => {
  const f = await claimedFixture();
  let reads = 0;
  const getter = {};
  Object.defineProperty(getter, 'name', {
    get() {
      reads++;
      return 'bad';
    },
    enumerable: true,
  });
  const cyclic = {};
  cyclic.self = cyclic;
  for (const receipt of [
    getter,
    cyclic,
    { value: Infinity },
    { value: undefined },
    { value: 'x'.repeat(2049) },
    { value: Array(65).fill(0) },
    new Date(),
    { value: Object.create({ inherited: true }) },
    Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [String(index), '漢'.repeat(2000)]),
    ),
  ]) {
    await assert.rejects(
      f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, {
        ...resultFor(f),
        receipt,
      }),
    );
  }
  await rejectsCode(
    f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, {
      ...resultFor(f),
      schoolId: 'ntu',
    }),
    'PUBLIC_AGENT_INVALID_RESULT',
  );
  await rejectsCode(
    f.ledger.fail(
      f.actor,
      f.b,
      f.claim.operationId,
      f.claim.executionToken,
      'raw provider exception',
    ),
    'PUBLIC_AGENT_INVALID_RESULT',
  );
  assert.equal(reads, 0);
  assert.equal([...f.db.data.operations.values()][0].status, 'running');
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('lost completion acknowledgement is recoverable by read and cannot be overwritten with unknown', async () => {
  const f = await claimedFixture(),
    result = resultFor(f);
  f.db.loseCommitAck = true;
  await assert.rejects(
    f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, result),
    /lost commit response/u,
  );
  const stored = await f.make().readBound(f.actor, f.b);
  assert.equal(stored.status, 'completed');
  assert.deepEqual(stored.result, result);
  assert.deepEqual(
    await f.ledger.markUnknown(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
    stored,
  );
  assert.equal(f.db.events.filter((event) => event.action === 'finalize-operation').length, 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('finalization rechecks session, owner and content while retaining the already used quota', async () => {
  const f = await claimedFixture(),
    other = f.db.anotherSession(f.actor);
  await rejectsCode(
    f.ledger.complete(other, f.b, f.claim.operationId, f.claim.executionToken, resultFor(f)),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  await rejectsCode(
    f.ledger.complete(
      f.actor,
      binding({ payloadHash: hash('changed') }),
      f.claim.operationId,
      f.claim.executionToken,
      resultFor(f),
    ),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  f.db.data.sessions.delete(f.actor.sessionHash);
  await rejectsCode(
    f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, resultFor(f)),
    'PUBLIC_AGENT_SESSION_EXPIRED',
  );
  assert.equal([...f.db.data.operations.values()][0].status, 'running');
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('only navigation accepts the deterministic execution pair and it retains its configured budget identity', async () => {
  const f = await claimedFixture(
    { providerBudgetKey: 'synthetic-deterministic-budget' },
    { provider: 'deterministic', model: 'public-poi-exact-match-v1' },
  );
  assert.equal(
    (
      await f.ledger.complete(
        f.actor,
        f.b,
        f.claim.operationId,
        f.claim.executionToken,
        resultFor(f, f.b),
      )
    ).status,
    'completed',
  );
  for (const change of [
    { task: 'campus-service-entry' },
    { model: FREE_MODEL },
    { provider: FREE_PROVIDER },
  ])
    await rejectsCode(
      f.ledger.confirm(f.actor, { ...f.b, requestId: 'other_request_001', ...change }),
      'PUBLIC_AGENT_INVALID_INPUT',
    );
  assert.ok(
    [...f.db.data.quota.keys()].some(
      (value) => JSON.parse(value)[1] === 'synthetic-deterministic-budget',
    ),
  );
});

test('reload and fresh session expose only scoped unresolved status and block new request/source/payload', async () => {
  const f = await claimedFixture(),
    renewed = f.db.anotherSession(f.actor),
    scope = { task: f.b.task, schoolId: f.b.schoolId };
  const expected = { status: 'pending', operationId: f.claim.operationId };
  assert.deepEqual(await f.make().status(renewed, scope), expected);
  assert.deepEqual(Object.keys(expected).sort(), ['operationId', 'status']);
  await rejectsCode(
    f
      .make()
      .confirm(
        renewed,
        binding({ requestId: 'fresh_request_1', payloadHash: hash('changed source and query') }),
      ),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  await rejectsCode(f.make().readBound(renewed, f.b), 'PUBLIC_AGENT_REQUEST_CONFLICT');
  await rejectsCode(
    f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: true }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  f.db.now += 31_000;
  assert.deepEqual(await f.make().status(renewed, scope), { ...expected, status: 'unknown' });
  await rejectsCode(
    f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: true }),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('completed outcome after lost response blocks fresh intent until explicit ack, and old ack never affects new operation', async () => {
  const f = await claimedFixture(),
    renewed = f.db.anotherSession(f.actor),
    scope = { task: f.b.task, schoolId: f.b.schoolId };
  await f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, resultFor(f));
  assert.deepEqual(await f.make().status(renewed, scope), {
    status: 'completed',
    operationId: f.claim.operationId,
  });
  const newer = binding({ requestId: 'fresh_request_2', payloadHash: hash('changed data') });
  await rejectsCode(f.make().confirm(renewed, newer), 'PUBLIC_AGENT_OPEN_OPERATION');
  await rejectsCode(
    f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: false }),
    'PUBLIC_AGENT_INVALID_INPUT',
  );
  f.db.loseCommitAck = true;
  await assert.rejects(
    f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: true }),
    /lost commit/u,
  );
  assert.equal(await f.make().status(renewed, scope), null);
  const c = await f.make().confirm(renewed, newer),
    next = await f.make().claim(renewed, newer, c.confirmationId);
  assert.equal(next.status, 'claimed');
  assert.deepEqual(
    await f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: true }),
    { status: 'acknowledged', operationId: f.claim.operationId },
  );
  assert.deepEqual(await f.make().status(renewed, scope), {
    status: 'pending',
    operationId: next.operationId,
  });
  assert.deepEqual(quotas(f.db), [2, 2]);
});
test('two prior confirmations racing claim permit one operation and roll back other quota and consume', async () => {
  const f = fixture(),
    a = binding(),
    b = binding({ requestId: 'concurrent_request_2', payloadHash: hash('distinct source') });
  const [ca, cb] = await Promise.all([f.ledger.confirm(f.actor, a), f.make().confirm(f.actor, b)]);
  const claims = await Promise.allSettled([
    f.ledger.claim(f.actor, a, ca.confirmationId),
    f.make().claim(f.actor, b, cb.confirmationId),
  ]);
  assert.equal(claims.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    claims.find((x) => x.status === 'rejected').reason.code,
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  assert.equal(f.db.data.operations.size, 1);
  assert.equal(
    [...f.db.data.confirmations.values()].filter((x) => x.consumed_at === null).length,
    1,
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('recovery status and acknowledgement reject other account, other school and revoked new session without revealing values', async () => {
  const f = await claimedFixture(),
    other = f.db.actor(),
    renewed = f.db.anotherSession(f.actor),
    scope = { task: f.b.task, schoolId: f.b.schoolId };
  assert.equal(await f.make().status(other, scope), null);
  assert.equal(await f.make().status(renewed, { ...scope, schoolId: 'other' }), null);
  for (const [actor, schoolId] of [
    [other, scope.schoolId],
    [renewed, 'other'],
  ])
    await rejectsCode(
      f.make().ack(actor, { ...scope, schoolId, operationId: f.claim.operationId, approved: true }),
      'PUBLIC_AGENT_OPERATION_NOT_FOUND',
    );
  f.db.data.sessions.delete(renewed.sessionHash);
  await rejectsCode(f.make().status(renewed, scope), 'PUBLIC_AGENT_SESSION_EXPIRED');
  await rejectsCode(
    f.make().ack(renewed, { ...scope, operationId: f.claim.operationId, approved: true }),
    'PUBLIC_AGENT_SESSION_EXPIRED',
  );
});
test('failed operation requires explicit acknowledgement while unrelated school and task remain independent', async () => {
  const f = await claimedFixture(),
    scope = { task: f.b.task, schoolId: f.b.schoolId };
  await f.ledger.fail(f.actor, f.b, f.claim.operationId, f.claim.executionToken, 'INVALID_RESULT');
  assert.deepEqual(await f.ledger.status(f.actor, scope), {
    status: 'failed',
    operationId: f.claim.operationId,
  });
  await rejectsCode(
    f.ledger.confirm(f.actor, binding({ requestId: 'retry_failure_1' })),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  assert.ok(
    (await f.ledger.confirm(f.actor, binding({ schoolId: 'other', requestId: 'other_school_1' })))
      .confirmationId,
  );
  assert.ok(
    (
      await f.ledger.confirm(
        f.actor,
        binding({ task: 'campus-service-entry', requestId: 'other_task_001' }),
      )
    ).confirmationId,
  );
  assert.equal(
    (await f.ledger.ack(f.actor, { ...scope, operationId: f.claim.operationId, approved: true }))
      .status,
    'acknowledged',
  );
  assert.ok(
    (await f.ledger.confirm(f.actor, binding({ requestId: 'retry_failure_1' }))).confirmationId,
  );
});

test('a preexisting other confirmation is blocked after scope claim but the original confirmation remains bound', async () => {
  const f = fixture(),
    a = binding(),
    b = binding({ requestId: 'preexisting_confirm_2' });
  const ca = await f.ledger.confirm(f.actor, a),
    cb = await f.ledger.confirm(f.actor, b);
  const first = await f.ledger.claim(f.actor, a, ca.confirmationId);
  assert.equal(first.status, 'claimed');
  await rejectsCode(f.ledger.confirm(f.actor, b), 'PUBLIC_AGENT_OPEN_OPERATION');
  assert.deepEqual(await f.ledger.confirm(f.actor, a), ca);
  await rejectsCode(f.ledger.claim(f.actor, b, cb.confirmationId), 'PUBLIC_AGENT_OPEN_OPERATION');
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('duplicate open rows in a corrupt or unindexed store fail closed instead of hiding an outcome', async () => {
  const f = await claimedFixture();
  const original = [...f.db.data.operations.values()][0];
  f.db.data.operations.set('synthetic_duplicate', {
    ...original,
    id: 'pago_11111111-1111-4111-8111-111111111111',
    request_id: 'synthetic_duplicate',
  });
  const scope = { task: f.b.task, schoolId: f.b.schoolId };
  await rejectsCode(f.ledger.status(f.actor, scope), 'PUBLIC_AGENT_STORE_INVALID');
  await rejectsCode(
    f.ledger.confirm(f.actor, binding({ requestId: 'fresh_request_3' })),
    'PUBLIC_AGENT_STORE_INVALID',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('executor fence is mandatory for completed and failed outcomes, and begins only once', async () => {
  const f = await claimedFixture({}, {}, false);
  await rejectsCode(
    f.ledger.complete(f.actor, f.b, f.claim.operationId, f.claim.executionToken, resultFor(f)),
    'PUBLIC_AGENT_DISPATCH_NOT_STARTED',
  );
  await rejectsCode(
    f.ledger.fail(f.actor, f.b, f.claim.operationId, f.claim.executionToken, 'EXECUTION_FAILED'),
    'PUBLIC_AGENT_DISPATCH_NOT_STARTED',
  );
  await rejectsCode(
    f.ledger.fail(f.actor, f.b, f.claim.operationId, f.claim.executionToken, 'NOT_DISPATCHED'),
    'PUBLIC_AGENT_INVALID_RESULT',
  );
  const attempts = await Promise.allSettled([
    f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
    f.make().beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    attempts.find((item) => item.status === 'rejected').reason.code,
    'PUBLIC_AGENT_DISPATCH_ALREADY_STARTED',
  );
  assert.equal(
    (
      await f.ledger.complete(
        f.actor,
        f.b,
        f.claim.operationId,
        f.claim.executionToken,
        resultFor(f),
      )
    ).status,
    'completed',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('expired no-dispatch can be reconciled by the same account new session but not auto acknowledged or refunded', async () => {
  const f = await claimedFixture({ operationTtlMs: 5 }, {}, false);
  const next = f.db.anotherSession(f.actor),
    scope = { task: f.b.task, schoolId: f.b.schoolId, operationId: f.claim.operationId };
  await rejectsCode(f.ledger.reconcileNoDispatch(next, scope), 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
  f.db.now += 6;
  assert.deepEqual(await f.make().reconcileNoDispatch(next, scope), {
    status: 'failed',
    operationId: f.claim.operationId,
  });
  assert.deepEqual(await f.make().reconcileNoDispatch(next, scope), {
    status: 'failed',
    operationId: f.claim.operationId,
  });
  assert.equal((await f.ledger.readBound(f.actor, f.b)).failureCode, 'NOT_DISPATCHED');
  assert.equal((await f.ledger.status(next, scopeFor(f))).status, 'failed');
  await rejectsCode(
    f.ledger.confirm(next, binding({ requestId: 'no_retry_1234' })),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  assert.deepEqual(quotas(f.db), [1, 1]);
  await f.ledger.ack(next, { ...scope, approved: true });
  assert.ok(
    (await f.ledger.confirm(next, binding({ requestId: 'allowed_after_ack_1' }))).confirmationId,
  );
});
function scopeFor(f) {
  return { task: f.b.task, schoolId: f.b.schoolId };
}

test('a dispatch marker, lost begin commit acknowledgement, or foreign scope can never prove no execution', async () => {
  const f = await claimedFixture({}, {}, false),
    next = f.db.anotherSession(f.actor);
  const scope = { task: f.b.task, schoolId: f.b.schoolId, operationId: f.claim.operationId };
  const other = f.db.actor();
  await rejectsCode(f.ledger.reconcileNoDispatch(other, scope), 'PUBLIC_AGENT_OPERATION_NOT_FOUND');
  await rejectsCode(
    f.ledger.reconcileNoDispatch(next, { ...scope, schoolId: 'other' }),
    'PUBLIC_AGENT_OPERATION_NOT_FOUND',
  );
  await rejectsCode(
    f.ledger.reconcileNoDispatch(next, { ...scope, notSent: true }),
    'PUBLIC_AGENT_INVALID_INPUT',
  );
  f.db.loseCommitAck = true;
  await assert.rejects(
    f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
    /lost commit/u,
  );
  assert.ok([...f.db.data.operations.values()][0].dispatch_started_at);
  f.db.now += 31_000;
  await rejectsCode(f.ledger.reconcileNoDispatch(next, scope), 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
  await rejectsCode(
    f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
    'PUBLIC_AGENT_OUTCOME_UNKNOWN',
  );
  assert.equal((await f.ledger.status(next, scopeFor(f))).status, 'unknown');
  assert.deepEqual(quotas(f.db), [1, 1]);
});

test('expired begin versus reconcile is serialized and never dispatches after reconciliation', async () => {
  const f = await claimedFixture({ operationTtlMs: 5 }, {}, false),
    next = f.db.anotherSession(f.actor);
  f.db.now += 6;
  const scope = { task: f.b.task, schoolId: f.b.schoolId, operationId: f.claim.operationId };
  const [begin, reconciled] = await Promise.allSettled([
    f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
    f.make().reconcileNoDispatch(next, scope),
  ]);
  assert.equal(begin.status, 'rejected');
  assert.equal(begin.reason.code, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
  assert.equal(reconciled.status, 'fulfilled');
  assert.equal(reconciled.value.status, 'failed');
  assert.equal([...f.db.data.operations.values()][0].dispatch_started_at, null);
});

test('missing, legacy or invalid dispatch fence version fails closed for every operation', async () => {
  for (const value of [undefined, null, 0, 2, '1']) {
    const f = await claimedFixture({ operationTtlMs: 5 }, {}, false),
      row = [...f.db.data.operations.values()][0];
    row.dispatch_fence_version = value;
    f.db.now += 6;
    const scope = { task: f.b.task, schoolId: f.b.schoolId, operationId: f.claim.operationId };
    await rejectsCode(f.ledger.status(f.actor, scopeFor(f)), 'PUBLIC_AGENT_STORE_INVALID');
    await rejectsCode(
      f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
      'PUBLIC_AGENT_STORE_INVALID',
    );
    await rejectsCode(f.ledger.reconcileNoDispatch(f.actor, scope), 'PUBLIC_AGENT_STORE_INVALID');
    await rejectsCode(
      f.ledger.markUnknown(f.actor, f.b, f.claim.operationId, f.claim.executionToken),
      'PUBLIC_AGENT_STORE_INVALID',
    );
    await rejectsCode(
      f.ledger.ack(f.actor, { ...scope, approved: true }),
      'PUBLIC_AGENT_STORE_INVALID',
    );
    assert.equal(row.dispatch_started_at, null);
  }
});

for (const code of ['FREE_QUOTA_UNAVAILABLE', 'DESTINATION_UNCLEAR', 'INVALID_PROVIDER_RESPONSE']) {
  test(`explicit ${code} can only be recorded after the dispatch fence`, async () => {
    const f = await claimedFixture({}, {}, false);
    await rejectsCode(
      f.ledger.fail(f.actor, f.b, f.claim.operationId, f.claim.executionToken, code),
      'PUBLIC_AGENT_DISPATCH_NOT_STARTED',
    );
    await f.ledger.beginDispatch(f.actor, f.b, f.claim.operationId, f.claim.executionToken);
    const result = await f.ledger.fail(
      f.actor,
      f.b,
      f.claim.operationId,
      f.claim.executionToken,
      code,
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, code);
    assert.deepEqual(quotas(f.db), [1, 1]);
  });
}
