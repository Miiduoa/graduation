#!/usr/bin/env node
import process from 'node:process';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const [option, directory, ...extra] = process.argv.slice(2);
assert(option === '--checkout' && directory && (extra.length === 0 || (extra.length === 1 && extra[0] === '--postgres')),
  'Usage: node scripts/test-platform-lost-found-runtime.mjs --checkout /absolute/path/to/verified-candidate [--postgres]');
const postgres = extra[0] === '--postgres';
let databaseUrl;
if (postgres) {
  assert(process.env.LOST_FOUND_TEST_DATABASE_URL, 'PostgreSQL mode requires an explicit owned test database URL');
  const url = new URL(process.env.LOST_FOUND_TEST_DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(url.protocol));
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback test databases are permitted');
  assert.equal(url.pathname, '/platform_lost_found_test');
  assert(url.port && !url.search && !url.hash, 'Explicit isolated port required, with no URL options');
  databaseUrl = url.href;
}
const root = resolve(import.meta.dirname, '..');
const checkout = resolve(directory);
const verification = spawnSync('python3', [join(root, 'deploy/nuni-api/lost-found/prepare.py'),
  '--verify-only', '--checkout', checkout], { cwd: root, stdio: 'inherit' });
if (verification.error) throw verification.error;
assert.equal(verification.status, 0, 'Exact candidate verification must pass before importing runtime code');

const requireRuntime = createRequire(join(checkout, 'apps/api/package.json'));
const isolatedEnvironment = { PATH: process.env.PATH, NODE_ENV: 'test',
  NODE_OPTIONS: '--max-old-space-size=384', GOMAXPROCS: '2', GOMEMLIMIT: '256MiB' };
const build = spawnSync(process.execPath, [join(dirname(requireRuntime.resolve('tsup')), 'cli-default.js')], {
  cwd: join(checkout, 'apps/api'), stdio: 'inherit', env: isolatedEnvironment,
});
if (build.error) throw build.error;
assert.equal(build.status, 0, 'The pinned complete API bundle must build before HTTP tests');
const dist = join(checkout, 'apps/api/dist');
cpSync(join(checkout, 'apps/api/src/schema.sql'), join(dist, 'schema.sql'));
cpSync(join(checkout, 'apps/api/src/migrations'), join(dist, 'migrations'), { recursive: true });
const artifacts = readdirSync(dist);
const appEntries = artifacts.filter(name => /^app-[A-Z0-9]+\.js$/.test(name));
const databaseEntries = artifacts.filter(name => {
  if (!/^chunk-[A-Z0-9]+\.js$/.test(name)) return false;
  const contents = readFileSync(join(dist, name), 'utf8');
  return /\bcreateDatabase\b/.test(contents.slice(contents.lastIndexOf('\nexport {')));
});
assert.equal(appEntries.length, 1, 'Expected the actual createApp output from the pinned API build');
assert.equal(databaseEntries.length, 1, 'Expected the actual createDatabase output from the pinned API build');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
  '--test-reporter=tap', join(root, 'scripts/platform-lost-found/runtime.test.mjs')], {
  cwd: checkout,
  stdio: 'inherit',
  // No product connection strings, provider credentials or deployment flags are
  // inherited. PostgreSQL requires the explicit, bounded fixture URL above;
  // otherwise the test creates an in-memory PGlite database.
  env: { ...isolatedEnvironment, LOST_FOUND_RUNTIME_CHECKOUT: checkout,
    ...(databaseUrl ? { LOST_FOUND_RUNTIME_DATABASE_URL: databaseUrl } : {}),
    LOST_FOUND_RUNTIME_APP: join(dist, appEntries[0]), LOST_FOUND_RUNTIME_DATABASE: join(dist, databaseEntries[0]) },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
