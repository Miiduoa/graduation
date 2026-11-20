import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./verify-nuni-merchant-api.mjs', import.meta.url));
function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, DATABASE_URL: 'postgresql://production.example.test/campus' },
  });
}

test('refuses an ambient DATABASE_URL when no explicit database URL was supplied', () => {
  const result = run(['--source', '/unused-source']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --source .* --database-url/);
});

test('requires explicit food candidate selection before accessing source or database', () => {
  const result = run([
    '--source',
    '/unused-source',
    '--database-url',
    'postgresql://127.0.0.1:5432/campus_nuni_merchant_acceptance',
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --food-ordering-candidate explicitly/);
  assert.doesNotMatch(result.stderr, /ENOENT|Cannot find module|Failed to connect/);
});

test('source-only verification also requires explicit food candidate selection', () => {
  const result = run(['--source', '/unused-source', '--verify-source-only']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --food-ordering-candidate explicitly/);
  assert.doesNotMatch(result.stderr, /ENOENT|Cannot find module|Failed to connect/);
});

for (const incompatible of ['--serve', '--verify-source-only']) {
  test(`native transport acceptance rejects ${incompatible} before accessing source or database`, () => {
    const result = run(['--native-client', incompatible]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--native-client (cannot be combined|requires HTTP acceptance)/);
    assert.doesNotMatch(result.stderr, /ENOENT|Cannot find module|Failed to connect/);
  });
}

for (const url of [
  'postgresql://production.example.test:5432/campus_nuni_merchant_acceptance',
  'postgresql://localhost:5432/campus_nuni_merchant_acceptance',
  'postgresql://127.0.0.1:5432/another_database',
  'postgresql://127.0.0.1/campus_nuni_merchant_acceptance',
  'postgresql://127.0.0.1:5432/campus_nuni_merchant_acceptance?host=production.example.test',
  'postgresql://127.0.0.1:5432/campus_nuni_merchant_acceptance#unexpected',
  'https://127.0.0.1:5432/campus_nuni_merchant_acceptance',
]) {
  test(`rejects a non-isolated database URL before reading source or importing the provider: ${url}`, () => {
    const result = run(['--source', '/unused-source', '--database-url', url]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AssertionError/);
    // The nonexistent source path would fail differently if this reached Git/imports.
    assert.doesNotMatch(result.stderr, /ENOENT|Cannot find module|Failed to connect/);
  });
}
