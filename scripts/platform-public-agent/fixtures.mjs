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
    if (
      sql.startsWith('UPDATE platform_public_agent_operations') &&
      sql.includes('execution_token_hash=$5')
    )
      return 'finalize-operation';
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
        row.execution_token_hash = values[14];
        row.result_json = null;
        row.failure_code = null;
        assert.match(row.execution_token_hash, /^[a-f0-9]{64}$/u);
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
    if (action === 'finalize-operation') {
      assert.match(
        sql,
        /execution_token_hash=\$5 AND status='running' AND expires_at>clock_timestamp\(\) RETURNING id/u,
      );
      const row = [...this.data.operations.values()].find(
        (item) =>
          item.id === values[0] &&
          item.platform_account_id === values[1] &&
          item.session_hash === values[2] &&
          item.payload_hash === values[3] &&
          item.execution_token_hash === values[4] &&
          item.status === 'running' &&
          new Date(item.expires_at).getTime() > this.now,
      );
      if (!row) return rows([]);
      row.status = values[5];
      row.result_json = values[6] === null ? null : JSON.parse(values[6]);
      row.failure_code = values[7];
      return rows([{ id: row.id }]);
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
  const options = {
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
  };
  const admission = new PlatformPublicAdmission(options);
  return { ...f, authorization, admission, source, register, options };
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

export {
  PlatformPublicAgentLedger,
  FREE_MODEL,
  FREE_PROVIDER,
  policy,
  hash,
  key,
  dbFailure,
  TransactionFixture,
  fixture,
  binding,
  lookup,
  rejectsCode,
  quotas,
  admissionFixture,
  publicRequest,
  requestLookup,
};

export const publicOperation = (value) => {
  const operation = { ...value };
  delete operation.executionToken;
  return operation;
};
