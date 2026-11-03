import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const compiled = process.env.PLATFORM_AGENT_COMPILED;
assert.ok(compiled, 'Run the repository compile harness; no source or live database fallback.');
const { PlatformPublicAgentLedger } = await import(pathToFileURL(join(compiled, 'ledger.js')).href);
const { FREE_MODEL, FREE_PROVIDER } = await import(
  pathToFileURL(join(compiled, 'contract.js')).href
);
const { PlatformPublicAdmission } = await import(
  pathToFileURL(join(compiled, 'admission.js')).href
);
const policy = {
  providerBudgetKey: 'synthetic-shared-free-budget',
  providerDailyLimit: 10,
  accountDailyLimit: 5,
};
const hash = (text) => createHash('sha256').update(text).digest('hex');
const key = (...parts) => JSON.stringify(parts);
const dbFailure = (code) => Object.assign(new Error('synthetic database failure'), { code });

// A serialized, rollback-capable protocol fixture. It does not execute PostgreSQL SQL,
// prove its locking/isolation, or provide a production persistence implementation.
class TransactionFixture {
  constructor() {
    this.now = Date.parse('2026-11-03T00:00:00.000Z');
    this.data = {
      accounts: new Map(),
      credentials: new Map(),
      operatorAssignments: new Map(),
      sessions: new Map(),
      confirmations: new Map(),
      operations: new Map(),
      quota: new Map(),
    };
    this.tail = Promise.resolve();
    this.events = [];
    this.nextActor = 0;
    this.nextTransaction = 0;
    this.beforeAction = null;
    this.failAction = null;
    this.loseCommitAck = false;
  }
  actor() {
    const number = ++this.nextActor;
    const actor = {
      platformAccountId: `pa_00000000-0000-0000-0000-${String(number).padStart(12, '0')}`,
      credentialId: `pac_synthetic_${number}`,
      sessionHash: hash(`synthetic-session-${number}`),
      expiresAt: this.now + 3_600_000,
    };
    this.data.accounts.set(actor.platformAccountId, { state: 'active' });
    this.data.credentials.set(actor.credentialId, {
      account: actor.platformAccountId,
      state: 'active',
      method: 'google',
    });
    this.data.sessions.set(actor.sessionHash, {
      account: actor.platformAccountId,
      credential: actor.credentialId,
      expiresAt: actor.expiresAt,
    });
    return actor;
  }
  anotherSession(actor) {
    const next = { ...actor, sessionHash: hash(`synthetic-extra-${this.data.sessions.size}`) };
    this.data.sessions.set(next.sessionHash, {
      account: next.platformAccountId,
      credential: next.credentialId,
      expiresAt: next.expiresAt,
    });
    return next;
  }
  async transaction(run, options) {
    assert.equal(options?.isolationLevel, 'read committed');
    const prior = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    const before = globalThis.structuredClone(this.data),
      tx = ++this.nextTransaction;
    this.events.push({ tx, action: 'begin' });
    let result;
    try {
      result = await run({ query: (sql, values = []) => this.query(tx, sql, values) });
      this.events.push({ tx, action: 'commit' });
    } catch (error) {
      this.data = before;
      this.events.push({ tx, action: 'rollback' });
      release();
      throw error;
    }
    release();
    if (this.loseCommitAck) {
      this.loseCommitAck = false;
      throw new Error('synthetic lost commit response');
    }
    return result;
  }
  classify(sql) {
    if (/FROM platform_accounts\b/u.test(sql)) return 'account';
    if (/FROM platform_account_credentials\b/u.test(sql)) return 'credential';
    if (/FROM platform_account_sessions\b/u.test(sql)) return 'session';
    if (/FROM platform_operator_assignments\b/u.test(sql)) return 'operator-assignment';
    if (/pg_advisory_xact_lock/u.test(sql)) return 'lock';
    if (/ AS quota_day/u.test(sql)) return 'quota-day';
    if (/ AS at_capacity/u.test(sql)) return 'confirmation-capacity';
    for (const [name, table] of [
      ['confirmation', 'confirmations'],
      ['operation', 'operations'],
      ['quota', 'quota'],
    ]) {
      if (sql.startsWith(`SELECT `) && sql.includes(`FROM platform_public_agent_${table}`))
        return `read-${name}`;
      if (sql.startsWith(`INSERT INTO platform_public_agent_${table}`)) return `insert-${name}`;
      if (sql.startsWith(`UPDATE platform_public_agent_${table}`)) return `update-${name}`;
    }
    throw new Error('Unexpected SQL in bounded fixture');
  }
  async query(tx, source, values) {
    const sql = source.replace(/\s+/gu, ' ').trim(),
      action = this.classify(sql);
    this.events.push({ tx, action, values: globalThis.structuredClone(values) });
    await this.beforeAction?.(action, values);
    if (this.failAction === action) {
      this.failAction = null;
      throw dbFailure('SYNTHETIC_WRITE_FAILURE');
    }
    const rows = (list) => ({ rows: globalThis.structuredClone(list) });
    const live = (row) => ({ ...row, unexpired: new Date(row.expires_at).getTime() > this.now });
    if (action === 'account') {
      assert.match(sql, /state='active'.*FOR SHARE/u);
      return rows(this.data.accounts.get(values[0])?.state === 'active' ? [{ id: values[0] }] : []);
    }
    if (action === 'credential') {
      assert.match(sql, /platform_account_id=\$2.*state='active'.*FOR SHARE/u);
      const row = this.data.credentials.get(values[0]);
      return rows(
        row?.state === 'active' && row.account === values[1]
          ? [{ id: values[0], ...(sql.includes('method') ? { method: row.method } : {}) }]
          : [],
      );
    }
    if (action === 'operator-assignment') {
      assert.match(
        sql,
        /platform_account_id=\$1 AND role_key='platform-operator' AND state='active' FOR SHARE/u,
      );
      const row = this.data.operatorAssignments.get(values[0]);
      return rows(
        row?.role === 'platform-operator' && row.state === 'active'
          ? [{ platform_account_id: values[0] }]
          : [],
      );
    }
    if (action === 'session') {
      assert.match(
        sql,
        /platform_account_id=\$2 AND credential_id=\$3 AND expires_at>clock_timestamp\(\).*FOR SHARE/u,
      );
      const row = this.data.sessions.get(values[0]);
      return rows(
        row && row.account === values[1] && row.credential === values[2] && row.expiresAt > this.now
          ? [{ expires_at: new Date(row.expiresAt) }]
          : [],
      );
    }
    if (action === 'lock') return rows([]);
    if (action === 'quota-day') {
      assert.match(
        sql,
        /to_char\(clock_timestamp\(\) AT TIME ZONE 'UTC','YYYY-MM-DD'\) AS quota_day/u,
      );
      return rows([{ quota_day: new Date(this.now).toISOString().slice(0, 10) }]);
    }
    if (action === 'confirmation-capacity') {
      assert.match(sql, /count\(\*\) >= \$2/u);
      assert.match(sql, /WHERE platform_account_id=\$1$/u);
      assert.doesNotMatch(sql, /expires_at|consumed_at/u);
      const count = [...this.data.confirmations.values()].filter(
        (row) => row.platform_account_id === values[0],
      ).length;
      return rows([{ at_capacity: count >= values[1] }]);
    }
    if (action === 'read-confirmation') {
      assert.match(sql, /FOR UPDATE/u);
      assert.match(sql, /expires_at>clock_timestamp\(\)/u);
      const row = sql.includes('WHERE id=$1')
        ? [...this.data.confirmations.values()].find(
            (item) => item.id === values[0] && item.platform_account_id === values[1],
          )
        : this.data.confirmations.get(key(...values));
      return rows(row ? [live(row)] : []);
    }
    if (action === 'read-operation') {
      assert.match(sql, /FOR UPDATE/u);
      assert.match(sql, /expires_at>clock_timestamp\(\)/u);
      const row = this.data.operations.get(key(...values));
      return rows(row ? [live(row)] : []);
    }
    if (action === 'insert-confirmation' || action === 'insert-operation') {
      const [id, account, credential, session, task, request, school, payload, provider, model] =
        values;
      const row = {
        id,
        platform_account_id: account,
        credential_id: credential,
        session_hash: session,
        task,
        request_id: request,
        school_id: school,
        payload_hash: payload,
        provider,
        model,
      };
      const index = key(account, task, request);
      if (action === 'insert-confirmation') {
        assert.match(sql, /WHERE \$11::timestamptz>clock_timestamp\(\)/u);
        if (new Date(values[10]).getTime() <= this.now) return rows([]);
        if (this.data.confirmations.has(index)) throw dbFailure('23505');
        row.expires_at = new Date(Math.min(new Date(values[10]).getTime(), this.now + values[11]));
        row.consumed_at = null;
        this.data.confirmations.set(index, row);
      } else {
        assert.match(
          sql,
          /WHERE \$12::timestamptz>clock_timestamp\(\) AND \$13::timestamptz>clock_timestamp\(\)/u,
        );
        if (
          new Date(values[11]).getTime() <= this.now ||
          new Date(values[12]).getTime() <= this.now
        )
          return rows([]);
        if (this.data.operations.has(index)) throw dbFailure('23505');
        row.confirmation_id = values[10];
        row.status = 'running';
        row.expires_at = new Date(
          Math.min(
            new Date(values[11]).getTime(),
            new Date(values[12]).getTime(),
            this.now + values[13],
          ),
        );
        this.data.operations.set(index, row);
      }
      return rows([{ id, expires_at: row.expires_at }]);
    }
    if (action === 'update-confirmation') {
      assert.match(sql, /consumed_at IS NULL AND expires_at>clock_timestamp\(\) RETURNING id/u);
      const columns = [
        'id',
        'platform_account_id',
        'credential_id',
        'session_hash',
        'task',
        'request_id',
        'school_id',
        'payload_hash',
        'provider',
        'model',
      ];
      const row = [...this.data.confirmations.values()].find((item) =>
        columns.every((column, index) => item[column] === values[index]),
      );
      if (!row || row.consumed_at !== null || new Date(row.expires_at).getTime() <= this.now)
        return rows([]);
      row.consumed_at = new Date(this.now);
      return rows([{ id: row.id }]);
    }
    if (action === 'insert-quota') {
      assert.match(sql, /ON CONFLICT \(budget_kind,budget_key,window_start\) DO UPDATE/u);
      assert.match(sql, /WHERE platform_public_agent_quota.used<\$4 RETURNING used/u);
      const [kind, budget, account, limit, day] = values;
      const index = key(kind, budget, day),
        used = this.data.quota.get(index)?.used ?? 0;
      if (used >= limit) return rows([]);
      this.data.quota.set(index, { used: used + 1, account });
      return rows([{ used: used + 1 }]);
    }
    if (action === 'update-operation') {
      assert.match(sql, /platform_account_id=\$2 AND session_hash=\$3 AND payload_hash=\$4/u);
      assert.match(sql, /status='running'/u);
      const row = [...this.data.operations.values()].find(
        (item) =>
          item.id === values[0] &&
          item.platform_account_id === values[1] &&
          item.session_hash === values[2] &&
          item.payload_hash === values[3] &&
          item.status === 'running',
      );
      if (
        !row ||
        (sql.includes('expires_at<=clock_timestamp()') &&
          new Date(row.expires_at).getTime() > this.now)
      )
        return rows([]);
      row.status = 'unknown';
      return rows([{ id: row.id }]);
    }
    throw new Error('Unimplemented protocol action');
  }
}
function fixture(overrides = {}) {
  const db = new TransactionFixture(),
    actor = db.actor();
  const make = (extra = {}, clock = () => db.now) =>
    new PlatformPublicAgentLedger(db, { ...policy, ...overrides, ...extra }, clock);
  return { db, actor, ledger: make(), make };
}
const binding = (extra = {}) => ({
  task: 'public-campus-navigation',
  requestId: 'request_0001',
  schoolId: 'pu',
  payloadHash: hash('synthetic public navigation'),
  provider: FREE_PROVIDER,
  model: FREE_MODEL,
  ...extra,
});
const lookup = (b) => ({ task: b.task, requestId: b.requestId, schoolId: b.schoolId });
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const quotas = (db) => [...db.data.quota.values()].map((row) => row.used);

test('both public tasks admit platform actors without tenant, person, membership or Firebase', async () => {
  const f = fixture();
  for (const task of ['public-campus-navigation', 'campus-service-entry']) {
    const b = binding({ task }),
      confirmation = await f.ledger.confirm(f.actor, b);
    const claim = await f.ledger.claim(f.actor, b, confirmation.confirmationId);
    assert.equal(claim.status, 'claimed');
    assert.ok(claim.expiresAt > f.db.now);
    assert.deepEqual(await f.ledger.read(f.actor, lookup(b)), { ...claim, status: 'pending' });
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
    expired = binding({ requestId: 'request_0002' });
  const first = await f.ledger.confirm(f.actor, used);
  const operation = await f.ledger.claim(f.actor, used, first.confirmationId);
  await f.ledger.confirm(f.actor, expired);
  f.db.now += 21;
  await rejectsCode(
    f.ledger.confirm(f.actor, binding({ requestId: 'request_0003' })),
    'PUBLIC_AGENT_CONFIRMATION_CAPACITY',
  );
  await rejectsCode(f.ledger.confirm(f.actor, expired), 'PUBLIC_AGENT_CONFIRMATION_EXPIRED');
  assert.deepEqual(await f.ledger.claim(f.actor, used, first.confirmationId), {
    ...operation,
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
    ...first,
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
    () => f.ledger.markUnknown(other, b, op.operationId),
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
    assert.deepEqual(result, { ...op, status: 'unknown' });
    assert.equal([...f.db.data.operations.values()][0].status, 'unknown');
    assert.deepEqual(await f.make().claim(f.actor, b, c.confirmationId), {
      ...op,
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
    f.ledger.markUnknown(f.actor, binding({ payloadHash: hash('wrong') }), op.operationId),
    'PUBLIC_AGENT_REQUEST_CONFLICT',
  );
  await rejectsCode(
    f.ledger.markUnknown(f.actor, b, 'pago_00000000-0000-0000-0000-000000000000'),
    'PUBLIC_AGENT_OPERATION_NOT_FOUND',
  );
  assert.deepEqual(await f.ledger.markUnknown(f.actor, b, op.operationId), {
    ...op,
    status: 'unknown',
  });
  assert.equal((await f.ledger.markUnknown(f.actor, b, op.operationId)).status, 'unknown');
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('the final account budget slot admits one concurrent request and rolls back the other consume/provider debit', async () => {
  const f = fixture({ accountDailyLimit: 1 }),
    a = binding(),
    b = binding({ requestId: 'request_0002' });
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
      () => f.ledger.markUnknown(f.actor, b, op.operationId),
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

// Composition journeys use the real admission and ledger classes with synthetic
// session/source services and the serialized protocol fixture above, not a real DB or provider.
function admissionFixture(overrides = {}) {
  const f = fixture(overrides);
  const sessions = new Map();
  const source = { fingerprint: hash('synthetic public source'), calls: [], beforeRead: null };
  const register = (actor, letter) => {
    const handle = `ps_${letter.repeat(43)}`;
    const authorization = `Platform ${handle}`;
    f.db.data.sessions.delete(actor.sessionHash);
    actor.sessionHash = hash(handle);
    f.db.data.sessions.set(actor.sessionHash, {
      account: actor.platformAccountId,
      credential: actor.credentialId,
      expiresAt: actor.expiresAt,
    });
    sessions.set(authorization, {
      platformAccountId: actor.platformAccountId,
      credentialId: actor.credentialId,
      expiresAt: actor.expiresAt,
    });
    return authorization;
  };
  const authorization = register(f.actor, 'a');
  const admission = new PlatformPublicAdmission({
    ledger: f.ledger,
    accounts: {
      async resolveSession(value) {
        const actor = sessions.get(value);
        const credential = actor && f.db.data.credentials.get(actor.credentialId);
        const assignment = actor && f.db.data.operatorAssignments.get(actor.platformAccountId);
        if (
          !actor ||
          (credential?.method === 'password' &&
            (assignment?.role !== 'platform-operator' || assignment.state !== 'active'))
        )
          throw Object.assign(new Error('synthetic invalid session'), {
            code: 'PLATFORM_SESSION_INVALID',
          });
        return { ...actor };
      },
    },
    async readPublicSourceFingerprint(schoolId, query, signal) {
      await source.beforeRead?.();
      source.calls.push({ schoolId, query });
      assert.equal(signal.aborted, false);
      return source.fingerprint;
    },
  });
  return { ...f, authorization, admission, source, register };
}
function publicRequest(
  task = 'public-campus-navigation',
  schoolId = 'pu',
  requestId = 'composed_request_0001',
) {
  if (task === 'campus-service-entry') {
    const utterance = '我要找校園地圖';
    return {
      task,
      data: {
        schoolId,
        utterance,
        requestId,
        consent: {
          version: 1,
          purpose: task,
          provider: FREE_PROVIDER,
          model: FREE_MODEL,
          schoolId,
          utterance,
        },
      },
    };
  }
  const query = '從圖書館走到餐廳';
  return {
    task,
    data: {
      task,
      phase: 'execute',
      schoolId,
      query,
      requestId,
      consent: {
        provider: FREE_PROVIDER,
        version: 1,
        schoolId,
        query,
        fingerprint: hash('synthetic public source'),
      },
    },
  };
}
const requestLookup = (request) => ({
  task: request.task,
  schoolId: request.data.schoolId,
  requestId: request.data.requestId,
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
    assert.deepEqual(Object.keys(claim).sort(), ['expiresAt', 'operationId', 'status']);
    const pending = { ...claim, status: 'pending' };
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
  const unknown = { ...claim, status: 'unknown' };
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
    'PUBLIC_AGENT_REQUEST_CONFLICT',
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
    ...result,
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
