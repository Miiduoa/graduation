// Run only from prepare-pinned-host.py's disposable source. All identities are synthetic.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app';
import { createDatabase } from '../database';

const secret = 'synthetic-attendance-secret-over-thirty-two-characters';
const options = {
  auth: {
    mode: 'demo' as const,
    sessionSecret: 'synthetic-session-secret-over-thirty-two-characters',
  },
  attendanceCodeSecret: secret,
};
const folder = process.env.C1_HOST_PG_FOLDER;
if (folder) {
  assert.match(folder, new RegExp(`^${realpathSync('/tmp')}/c1host-[A-Za-z0-9]+$`, 'u'));
  assert.equal(realpathSync(folder), folder);
  assert.equal(lstatSync(folder).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(folder, 'socket')).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(folder, 'owner'), 'utf8').trim(), String(process.ppid));
}
const db = await createDatabase({
  attendanceCodeSecret: secret,
  ...(folder
    ? {
        runtimeConfig: {
          kind: 'postgres' as const,
          url: `postgresql://campus_synthetic@${encodeURIComponent(join(folder, 'socket'))}:55433/postgres`,
          pool: { ssl: false as const },
          applicationName: 'isolated-host-test',
          tlsMode: 'disable' as const,
        },
      }
    : {}),
});
try {
  const disabled = await createApp(db, options);
  const disabledResult = await disabled.inject({
    method: 'POST',
    url: '/v1/auth/platform/public-agent/preview',
    payload: {},
  });
  assert.notEqual(disabledResult.statusCode, 200);
  await disabled.close();
  const account = `pa_${randomUUID()}`,
    credential = `pac_${randomUUID()}`;
  const token = `ps_${'A'.repeat(43)}`;
  await db.query(`INSERT INTO platform_accounts (id,display_name) VALUES ($1,'合成帳號')`, [
    account,
  ]);
  await db.query(
    `INSERT INTO platform_account_credentials (id,platform_account_id,method,provider_issuer,provider_subject,verified_at,last_authenticated_at) VALUES ($1,$2,'google','https://accounts.google.com','synthetic-subject',now(),now())`,
    [credential, account],
  );
  await db.query(
    `INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')`,
    [createHash('sha256').update(token).digest('hex'), account, credential],
  );
  let providerCalls = 0,
    freeChecks = 0,
    quotaDenied = false;
  const syntheticKey = 'synthetic-groq-credential-do-not-use';
  let guardHook: () => Promise<boolean> = async () => true;
  const groqFetch: typeof fetch = async (url, request) => {
    providerCalls++;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(request?.redirect, 'error');
    assert.equal(new Headers(request?.headers).get('authorization'), `Bearer ${syntheticKey}`);
    const sent = String(request?.body);
    assert.equal(sent.includes(token), false);
    assert.equal(sent.includes(syntheticKey), false);
    assert.equal(sent.includes('主顧樓'), true);
    if (quotaDenied) return new Response('{}', { status: 429 });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ kind: 'route', fromId: 'pu-zhugu', toId: 'pu-library' }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const groqApp = await createApp(db, {
    ...options,
    publicAgentCandidate: {
      enabled: true,
      policy: { providerBudgetKey: 'synthetic-free', providerDailyLimit: 10, accountDailyLimit: 5 },
      groqCandidate: {
        credential: syntheticKey,
        fetch: groqFetch,
        freeOnlyGuard: async () => {
          freeChecks++;
          return guardHook();
        },
      },
    },
  });
  try {
    const call = (action: string, payload: Record<string, unknown>, sessionToken = token) =>
      groqApp.inject({
        method: 'POST',
        url: `/v1/auth/platform/public-agent/${action}`,
        headers: { authorization: `Platform ${sessionToken}` },
        payload,
      });
    const task = { schoolId: 'pu', query: '從主顧樓到蓋夏圖書館', requestId: 'synthetic_groq_01' };
    const prepared = await call('prepareGroq', task);
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.equal(prepared.json().provider, 'groq');
    assert.equal(providerCalls, 0);
    assert.equal(
      (await call('confirm', { approved: false, request: prepared.json().request })).statusCode,
      409,
    );
    assert.equal(providerCalls, 0);
    const confirmed = await call('confirm', { approved: true, request: prepared.json().request });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(providerCalls, 0);
    const body = {
      confirmationId: confirmed.json().confirmationId,
      request: prepared.json().request,
    };
    const executed = await call('execute', body);
    assert.equal(executed.statusCode, 200, executed.body);
    assert.equal(executed.json().status, 'completed');
    assert.equal(providerCalls, 1);
    assert.equal(freeChecks, 1);
    assert.equal((await call('execute', body)).json().operationId, executed.json().operationId);
    assert.equal(providerCalls, 1);
    const route = {
      request: prepared.json().request,
      operationId: executed.json().operationId,
      fromId: 'pu-zhugu',
      toId: 'pu-library',
    };
    assert.equal((await call('route', { ...route, approved: false })).statusCode, 409);
    const opened = await call('route', { ...route, approved: true });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(new URL(opened.json().receipt.url).hostname, 'www.google.com');
    assert.equal(
      (
        await call('ack', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
          operationId: executed.json().operationId,
          approved: true,
        })
      ).statusCode,
      200,
    );
    quotaDenied = true;
    const retry = await call('prepareGroq', { ...task, requestId: 'synthetic_groq_02' });
    const approval = await call('confirm', { approved: true, request: retry.json().request });
    const refused = await call('execute', {
      confirmationId: approval.json().confirmationId,
      request: retry.json().request,
    });
    assert.equal(refused.json().status, 'failed');
    assert.equal(refused.json().failureCode, 'FREE_QUOTA_UNAVAILABLE');
    assert.equal(providerCalls, 2);
    assert.equal(
      (
        await call('ack', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
          operationId: refused.json().operationId,
          approved: true,
        })
      ).statusCode,
      200,
    );
    const otherAccount = `pa_${randomUUID()}`;
    const otherCredential = `pac_${randomUUID()}`;
    const otherToken = `ps_${'B'.repeat(43)}`;
    await db.query(`INSERT INTO platform_accounts (id,display_name) VALUES ($1,'另一個合成帳號')`, [
      otherAccount,
    ]);
    await db.query(
      `INSERT INTO platform_account_credentials (id,platform_account_id,method,provider_issuer,provider_subject,verified_at,last_authenticated_at) VALUES ($1,$2,'google','https://accounts.google.com','synthetic-other-subject',now(),now())`,
      [otherCredential, otherAccount],
    );
    await db.query(
      `INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [createHash('sha256').update(otherToken).digest('hex'), otherAccount, otherCredential],
    );
    const otherPrepared = await call(
      'prepareGroq',
      { ...task, requestId: 'synthetic_groq_03' },
      otherToken,
    );
    const otherApproved = await call(
      'confirm',
      { approved: true, request: otherPrepared.json().request },
      otherToken,
    );
    let releaseGuard!: () => void;
    let guardEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      guardEntered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });
    guardHook = async () => {
      guardEntered();
      await held;
      return true;
    };
    const pending = Promise.resolve(
      call(
        'execute',
        {
          confirmationId: otherApproved.json().confirmationId,
          request: otherPrepared.json().request,
        },
        otherToken,
      ),
    );
    await entered;
    await db.query(
      `UPDATE platform_account_sessions SET expires_at=now() WHERE platform_account_id=$1`,
      [otherAccount],
    );
    releaseGuard();
    const cancelled = await pending;
    assert.notEqual(cancelled.statusCode, 200);
    assert.equal(providerCalls, 2);
    assert.equal(cancelled.body.includes(syntheticKey), false);
  } finally {
    await groqApp.close();
  }
  const app = await createApp(db, {
    ...options,
    publicAgentCandidate: {
      enabled: true,
      policy: { providerBudgetKey: 'synthetic-free', providerDailyLimit: 10, accountDailyLimit: 5 },
    },
  });
  try {
    const headers = { authorization: `Platform ${token}` };
    const call = (
      action: string,
      payload: Record<string, unknown>,
      extra: Record<string, string> = {},
    ) =>
      app.inject({
        method: 'POST',
        url: `/v1/auth/platform/public-agent/${action}`,
        headers: { ...headers, ...extra },
        payload,
      });
    const body = { schoolId: 'pu', query: '從主顧樓到蓋夏圖書館', requestId: 'synthetic_host_01' };
    const quotaBefore = await db.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM platform_public_agent_quota',
    );
    const capability = await call('capability', { schoolId: 'pu' });
    assert.equal(capability.statusCode, 200, capability.body);
    assert.equal(capability.headers['cache-control'], 'no-store');
    assert.deepEqual(capability.json().modes, ['deterministic']);
    assert.equal(capability.json().schoolId, 'pu');
    assert.equal(capability.json().source.date, '2026-10-19');
    const unknown = await call('capability', { schoolId: 'other' });
    assert.deepEqual(unknown.json(), { schoolId: 'other', modes: [], source: null });
    assert.equal(
      (await call('capability', { schoolId: 'pu' }, { origin: 'https://example.invalid' }))
        .statusCode,
      403,
    );
    assert.equal(
      (await call('capability', { schoolId: 'pu' }, { authorization: 'Platform invalid' }))
        .statusCode,
      401,
    );
    const quotaAfter = await db.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM platform_public_agent_quota',
    );
    assert.equal(quotaBefore.rows[0]?.total, 0);
    assert.equal(quotaAfter.rows[0]?.total, 0);
    assert.equal(
      (await call('preview', body, { origin: 'https://example.invalid' })).statusCode,
      403,
    );
    assert.equal(
      (await call('preview', body, { authorization: 'Platform invalid' })).statusCode,
      401,
    );
    const protectedResult = await app.inject({ method: 'GET', url: '/v1/bootstrap', headers });
    assert.equal(protectedResult.statusCode, 401);
    const p = await call('preview', body);
    assert.equal(p.statusCode, 200, p.body);
    assert.equal(p.json().execution, 'deterministic');
    assert.equal(p.headers['cache-control'], 'no-store');
    assert.equal(p.json().receipt.sourceDate, '2026-10-19');
    assert.equal(new URL(p.json().receipt.from.sourceUrl).hostname, 'www.openstreetmap.org');
    assert.equal(new URL(p.json().receipt.to.sourceUrl).hostname, 'www.openstreetmap.org');
    assert.equal((await call('preview', { ...body, schoolId: 'other' })).statusCode, 503);
    assert.equal((await call('prepareGroq', body)).statusCode, 503);
    const denied = await call('confirm', { approved: false, request: p.json().request });
    assert.equal(denied.statusCode, 409);
    const c = await call('confirm', { approved: true, request: p.json().request });
    assert.equal(c.statusCode, 200, c.body);
    const executeBody = { confirmationId: c.json().confirmationId, request: p.json().request };
    const e = await call('execute', executeBody);
    assert.equal(e.statusCode, 200, e.body);
    assert.equal(e.json().status, 'completed');
    const replay = await call('execute', executeBody);
    assert.equal(replay.json().operationId, e.json().operationId);
    const originalQuery = db.query.bind(db);
    db.query = async (...args: Parameters<typeof db.query>) => {
      if (args[0].includes('FROM platform_account_sessions session'))
        throw new Error('SYNTHETIC_LOG_CANARY_8cd2');
      return originalQuery(...args);
    };
    assert.equal((await call('preview', body)).statusCode, 503);
    db.query = originalQuery;
    await db.query(
      `UPDATE platform_account_sessions SET expires_at=now() WHERE platform_account_id=$1`,
      [account],
    );
    assert.equal(
      (await call('status', { task: 'public-campus-navigation', schoolId: 'pu' })).statusCode,
      401,
    );
    const oversized = await call('preview', { text: 'x'.repeat(9000) });
    assert.equal(oversized.statusCode, 413);
    let limited = false;
    for (let i = 0; i < 40; i++)
      if ((await call('preview', body)).statusCode === 429) limited = true;
    assert.equal(limited, true);
    console.log(
      'Pinned host: disabled default, real platform session, public source, origin/host guard, confirmation, deterministic route, duplicate, revocation, body and rate limits passed.',
    );
  } finally {
    await app.close();
  }
} finally {
  await db.close();
}
