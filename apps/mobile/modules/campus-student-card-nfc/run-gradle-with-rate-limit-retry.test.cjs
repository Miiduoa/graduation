/* global require, __dirname, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads CommonJS tooling. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const script = join(__dirname, 'run-gradle-with-rate-limit-retry.sh');
const rateLimit = "Could not GET 'https://repo.maven.apache.org/maven2/example.pom'. Received status code 429 from server: Too Many Requests";

function run(first, second = first) {
  const dir = mkdtempSync(join(tmpdir(), 'nfc-gradle-retry-'));
  try {
    const state = join(dir, 'calls');
    const delays = join(dir, 'delays');
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$DELAYS"\n', { mode: 0o755 });
    const fake = `const fs = require('node:fs');
const [state, first, second, marker] = process.argv.slice(1);
if (marker !== 'argument with spaces') process.exit(99);
const attempt = fs.existsSync(state) ? 2 : 1;
fs.appendFileSync(state, 'call\\n');
const result = JSON.parse(attempt === 1 ? first : second);
console.error(result.output);
process.exit(result.status);`;
    const result = spawnSync('bash', [script, process.execPath, '-e', fake, state,
      JSON.stringify(first), JSON.stringify(second), 'argument with spaces'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DELAYS: delays, TMPDIR: dir },
      timeout: 5000,
    });
    assert.ifError(result.error);
    const files = readdirSync(dir).sort();
    const waited = files.includes('delays');
    assert.deepEqual(files, waited ? ['calls', 'delays', 'sleep'] : ['calls', 'sleep']);
    return { status: result.status, calls: readFileSync(state, 'utf8').trim().split('\n').length,
      delays: waited ? readFileSync(delays, 'utf8').trim() : '', output: result.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('successful builds run once even if output mentions a rate limit', () => {
  const result = run({ status: 0, output: rateLimit });
  assert.equal(result.status, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.delays, '');
});

test('Maven Central 429 retries once and preserves successful output', () => {
  const result = run({ status: 1, output: rateLimit }, { status: 0, output: 'BUILD SUCCESSFUL' });
  assert.equal(result.status, 0);
  assert.equal(result.calls, 2);
  assert.equal(result.delays, '20');
  assert.ok(result.output.includes(rateLimit));
  assert.ok(result.output.includes('BUILD SUCCESSFUL'));
});

test('persistent rate limit stops after two attempts with the last exit code', () => {
  const result = run({ status: 1, output: rateLimit }, { status: 7, output: rateLimit });
  assert.equal(result.status, 7);
  assert.equal(result.calls, 2);
  assert.equal(result.delays, '20');
});

test('unrelated HTTP errors, test failures and interrupted builds are not retried', () => {
  for (const first of [
    { status: 3, output: rateLimit.replace('repo.maven.apache.org', 'example.com') },
    { status: 4, output: rateLimit.replace('429', '503') },
    { status: 5, output: `${rateLimit}\nThere were failing tests` },
    { status: 6, output: `${rateLimit}\n> Task :testDebugUnitTest FAILED` },
    { status: 130, output: rateLimit },
    { status: 8, output: 'Compilation failed' },
  ]) {
    const result = run(first);
    assert.equal(result.status, first.status);
    assert.equal(result.calls, 1);
    assert.equal(result.delays, '');
  }
});
