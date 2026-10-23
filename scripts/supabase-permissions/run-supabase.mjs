#!/usr/bin/env node
// Full local Supabase integration. Creates its own temporary project, never links
// a hosted project, and deletes only that project's disposable Docker volumes.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertLoopback, execute, here, migrations, newDefaultsSql, repo, requireSuites,
  runApiAssertions, runSqlAssertions, seedFixtures, sql, upgradeBase,
} from './harness.mjs';

if (process.argv.length !== 2) throw new Error('Usage: run-supabase.mjs (no remote-target options)');
requireSuites();
const binary = process.env.CAMPUS_TEST_SUPABASE || 'supabase';
const version = execute(binary, ['--version']).trim();
if (!/^2\.121\.0$/.test(version)) throw new Error(`Expected Supabase CLI 2.121.0; received ${version}`);
// Commands/options are also checked by the harness on every pinned-CLI run.
for (const command of [['start'], ['db', 'reset'], ['migration', 'up'], ['status'], ['stop']]) {
  execute(binary, [...command, '--help']);
}

const workdir = mkdtempSync(join(tmpdir(), 'campus-permissions-'));
const projectId = `campus-permissions-${process.pid}-${Date.now()}`;
const migrationDir = join(workdir, 'supabase', 'migrations');
const fixtureName = '20000101000000_test_data_api_defaults.sql';
const all = migrations();
const historical = all.filter((name) => name.slice(0, 14) <= upgradeBase);
const upgrades = all.filter((name) => name.slice(0, 14) > upgradeBase);
if (!historical.length || !upgrades.length) throw new Error('Expected historical and upgrade migrations');

function cli(args, display = false) {
  if (!workdir.startsWith(join(tmpdir(), 'campus-permissions-'))) throw new Error('Unsafe local workdir');
  if (existsSync(join(workdir, 'supabase', '.temp', 'project-ref'))) throw new Error('Test project must never be linked');
  return execute(binary, [...args, '--workdir', workdir, '--yes', '--agent', 'no'], { cwd: workdir, display });
}

function setTomlValue(contents, section, key, value) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^\\[${escape(section)}\\]\\s*$`, 'm').exec(contents);
  if (!header) return `${contents}\n[${section}]\n${key} = ${value}\n`;
  const start = header.index + header[0].length;
  const next = contents.slice(start).search(/^\[/m);
  const end = next < 0 ? contents.length : start + next;
  const oldSection = contents.slice(start, end);
  const pattern = new RegExp(`^${escape(key)}\\s*=.*$`, 'm');
  const newSection = pattern.test(oldSection)
    ? oldSection.replace(pattern, `${key} = ${value}`)
    : `${oldSection}\n${key} = ${value}\n`;
  return contents.slice(0, start) + newSection + contents.slice(end);
}

function config(autoExpose) {
  // Keep the real repository's database version, API schemas, auth settings and
  // all other application configuration so this test also catches config drift.
  // Only the temporary identity, local ports, scenario switch and nonessential
  // background services are overridden. No hosted project is ever linked.
  let contents = readFileSync(`${repo}/supabase/config.toml`, 'utf8');
  if (!/^project_id\s*=.*$/m.test(contents)) throw new Error('Repository config has no project_id');
  contents = contents.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  const overrides = [
    ['api', 'port', '54321'], ['api', 'auto_expose_new_tables', String(autoExpose)],
    ['db', 'port', '54322'], ['db', 'shadow_port', '54320'],
    ['db.pooler', 'enabled', 'false'], ['db.seed', 'enabled', 'false'],
    ['realtime', 'enabled', 'false'], ['studio', 'enabled', 'false'],
    ['local_smtp', 'enabled', 'false'], ['auth.email.smtp', 'enabled', 'false'],
    ['storage.image_transformation', 'enabled', 'false'], ['storage.vector', 'enabled', 'false'],
    ['edge_runtime', 'enabled', 'false'], ['analytics', 'enabled', 'false'],
  ];
  for (const [section, key, value] of overrides) contents = setTomlValue(contents, section, key, value);
  writeFileSync(join(workdir, 'supabase', 'config.toml'), contents);
}

function stageMigrations(names, defaults) {
  // This directory was created by this process, never the repository directory.
  rmSync(migrationDir, { recursive: true, force: true });
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(join(migrationDir, fixtureName), defaults);
  for (const name of names) copyFileSync(`${repo}/supabase/migrations/${name}`, join(migrationDir, name));
}

function localStatus() {
  const status = JSON.parse(cli(['status', '-o', 'json']));
  const databaseUrl = status.DB_URL;
  const apiBase = status.API_URL;
  const jwtSecret = status.JWT_SECRET;
  const db = assertLoopback(databaseUrl, ['postgres:', 'postgresql:']);
  const api = assertLoopback(apiBase, ['http:']);
  if (db.pathname !== '/postgres' || db.port !== '54322' || api.port !== '54321') {
    throw new Error('Supabase status did not point to this isolated local stack');
  }
  if (!readFileSync(join(workdir, 'supabase', 'config.toml'), 'utf8').includes(`project_id = "${projectId}"`)) {
    throw new Error('Temporary project identity changed');
  }
  return { databaseUrl, apiUrl: `${api.origin}/rest/v1`, jwtSecret, anonKey: status.ANON_KEY || status.PUBLISHABLE_KEY || '' };
}

async function verify({ seeded = false } = {}) {
  const status = localStatus();
  runSqlAssertions(status.databaseUrl);
  if (!seeded) seedFixtures(status.databaseUrl);
  sql(status.databaseUrl, { text: "notify pgrst, 'reload schema';" });
  await delay(500);
  await runApiAssertions(status);
}

let started = false;
try {
  cli(['init']);
  config(false);
  stageMigrations(all, newDefaultsSql());
  console.log('Start isolated Supabase PG15 stack with automatic Data API exposure disabled');
  started = true;
  cli(['start', '--exclude', 'studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit']);

  console.log('\nScenario: fresh Supabase CLI reset under opt-in grants');
  cli(['db', 'reset', '--local', '--no-seed']);
  await verify();
  console.log('PASS: fresh Supabase CLI reset');

  console.log('\nScenario: second Supabase CLI reset');
  cli(['db', 'reset', '--local', '--no-seed']);
  await verify();
  console.log('PASS: second Supabase CLI reset');

  console.log('\nScenario: legacy defaults and existing data upgraded to explicit grants');
  config(true);
  stageMigrations(historical, `-- Test-only legacy Supabase defaults.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`);
  cli(['db', 'reset', '--local', '--no-seed']);
  const before = localStatus();
  seedFixtures(before.databaseUrl);
  sql(before.databaseUrl, { text: newDefaultsSql() });
  sql(before.databaseUrl, { file: `${here}/assert-defaults.sql` });
  for (const name of upgrades) copyFileSync(`${repo}/supabase/migrations/${name}`, join(migrationDir, name));
  cli(['migration', 'up', '--local']);
  await verify({ seeded: true });
  console.log('PASS: legacy upgrade preserves existing data and API access');
  console.log('\nAll isolated Supabase scenarios passed. No hosted database was accessed.');
} finally {
  if (started) {
    // No --all: never stop another developer's local Supabase project.
    cli(['stop', '--project-id', projectId, '--no-backup']);
  }
  rmSync(workdir, { recursive: true, force: true });
}
