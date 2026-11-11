/** Child process for the owned Unix-socket acceptance cluster; no DB URL or ambient PG config. */
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const folder = process.env.CAMPUS_AGENT_PG_FOLDER;
assert.ok(folder);
assert.match(folder, new RegExp(`^${realpathSync('/tmp')}/c1pg-[A-Za-z0-9]+$`, 'u'));
assert.equal(realpathSync(folder), folder);
assert.equal(lstatSync(folder).mode & 0o777, 0o700);
assert.equal(lstatSync(join(folder, 'socket')).mode & 0o777, 0o700);
assert.equal(process.env.C1_TEST_PARENT, String(process.ppid));
assert.equal(
  readFileSync(join(folder, 'owner'), 'utf8').trim(),
  process.env.CAMPUS_AGENT_PG_PARENT,
);
const compiled = process.env.CAMPUS_AGENT_PG_COMPILED;
assert.ok(compiled);
assert.equal(realpathSync(compiled), realpathSync(join(folder, 'compiled')));
const { PlatformPublicAgentLedger } = await import(pathToFileURL(join(compiled, 'ledger.js')).href);
const { Pool } = await import('pg');
const pool = new Pool({
  host: join(folder, 'socket'),
  port: 55432,
  database: 'postgres',
  user: 'campus_synthetic',
  ssl: false,
});
const db = {
  async transaction(run, options) {
    assert.equal(options?.isolationLevel, 'read committed');
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const ledger = new PlatformPublicAgentLedger(db, {
    providerBudgetKey: 'synthetic-free',
    providerDailyLimit: 1000,
    accountDailyLimit: 1000,
  });
  const before = await ledger.status(input.actor, input.scope);
  const after = await ledger.reconcileNoDispatch(input.actor, {
    ...input.scope,
    operationId: input.operationId,
  });
  process.stdout.write(JSON.stringify({ before, after }));
} finally {
  await pool.end();
}
