#!/usr/bin/env node
// Replays migrations against disposable PostgreSQL databases on a local server.
// For the real Supabase CLI reset workflow use run-supabase.mjs as well.
import {
  applyMigrations, assertLoopback, here, migrations, newDefaultsSql, requireSuites,
  runApiAssertions, runSqlAssertions, seedFixtures, sql, testJwtSecret, upgradeBase,
  withPostgrest,
} from './harness.mjs';

const args = process.argv.slice(2);
const sqlOnly = args.includes('--sql-only');
const selected = args.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] || 'all';
if (args.some((arg) => arg !== '--sql-only' && !/^--scenario=(all|fresh|upgrade|reset)$/.test(arg))) {
  throw new Error('Usage: run-local.mjs [--sql-only] [--scenario=all|fresh|upgrade|reset]');
}

const input = process.env.CAMPUS_TEST_DATABASE_URL;
if (!input) throw new Error('Set CAMPUS_TEST_DATABASE_URL to a disposable local PostgreSQL server');
const base = assertLoopback(input, ['postgres:', 'postgresql:']);
if (base.pathname !== '/campus_permissions_test' || decodeURIComponent(base.username) !== 'postgres') {
  throw new Error('Database URL must name campus_permissions_test and the local postgres test administrator');
}
requireSuites({ sqlOnly });

const admin = new URL(base);
admin.pathname = '/postgres';
const marker = 'Campus One disposable permission regression database';
const all = migrations();
const historical = all.filter((name) => name.slice(0, 14) <= upgradeBase);
const upgrades = all.filter((name) => name.slice(0, 14) > upgradeBase);
if (!historical.length || !upgrades.length) throw new Error('Expected both historical and permission upgrade migrations');

function recreate(name) {
  if (!/^campus_permissions_test_(fresh|upgrade|reset)$/.test(name)) throw new Error('Unsafe test database name');
  const existing = sql(admin.toString(), {
    text: `select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '${name}'`,
  });
  if (existing && existing.trim() !== marker) {
    throw new Error(`Refusing to replace ${name}: it was not created by this test harness`);
  }
  sql(admin.toString(), { text: `drop database if exists ${name} with (force);` });
  sql(admin.toString(), { text: `create database ${name} owner postgres template template0;` });
  sql(admin.toString(), { text: `comment on database ${name} is '${marker}';` });
  const target = new URL(base);
  target.pathname = `/${name}`;
  sql(target.toString(), { file: `${here}/bootstrap.sql` });
  return target.toString();
}

async function verify(url, { seeded = false } = {}) {
  runSqlAssertions(url);
  if (!seeded) seedFixtures(url);
  if (sqlOnly) {
    console.log('SQL-only run: HTTP/PostgREST tests were explicitly not run.');
  } else {
    await withPostgrest(url, (apiUrl) => runApiAssertions({ databaseUrl: url, apiUrl, jwtSecret: testJwtSecret }));
  }
}

for (const scenario of selected === 'all' ? ['fresh', 'upgrade', 'reset'] : [selected]) {
  console.log(`\nScenario: ${scenario}`);
  const url = recreate(`campus_permissions_test_${scenario}`);
  if (scenario === 'upgrade') {
    applyMigrations(url, historical);
    // Existing records must survive the grant migration and remain API-compatible.
    seedFixtures(url);
    sql(url, { text: newDefaultsSql() });
    sql(url, { file: `${here}/assert-defaults.sql` });
    applyMigrations(url, upgrades);
    await verify(url, { seeded: true });
  } else {
    sql(url, { text: newDefaultsSql() });
    sql(url, { file: `${here}/assert-defaults.sql` });
    applyMigrations(url, all);
    await verify(url);
    if (scenario === 'reset') {
      const resetUrl = recreate('campus_permissions_test_reset');
      sql(resetUrl, { text: newDefaultsSql() });
      applyMigrations(resetUrl, all);
      await verify(resetUrl);
    }
  }
  console.log(`PASS: ${scenario}`);
}
console.log('\nLocal PostgreSQL permission scenarios passed. This is not production acceptance.');
