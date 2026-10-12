import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./verify-nuni-course-api.mjs', import.meta.url));
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

for (const url of [
  'postgresql://production.example.test:5432/campus_nuni_course_acceptance',
  'postgresql://localhost:5432/campus_nuni_course_acceptance',
  'postgresql://127.0.0.1:5432/another_database',
  'postgresql://127.0.0.1/campus_nuni_course_acceptance',
  'postgresql://127.0.0.1:5432/campus_nuni_course_acceptance?host=production.example.test',
  'postgresql://127.0.0.1:5432/campus_nuni_course_acceptance#unexpected',
  'https://127.0.0.1:5432/campus_nuni_course_acceptance',
]) {
  test(`rejects a non-isolated database URL before reading source or importing the provider: ${url}`, () => {
    const result = run(['--source', '/unused-source', '--database-url', url]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AssertionError/);
    // The nonexistent source path would fail differently if this reached Git/imports.
    assert.doesNotMatch(result.stderr, /ENOENT|Cannot find module|Failed to connect/);
  });
}
