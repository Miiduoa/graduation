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
