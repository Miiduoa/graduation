import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function assertLauncherEnvironment(scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-'));
  const capture = path.join(dir, 'captured.json');
  const cleared = ['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_CONFIG', 'GOOGLE_CLOUD_PROJECT', 'NEXT_PUBLIC_FUNCTIONS_BASE_URL',
    'PLATFORM_GOOGLE_CLIENT_SECRET', 'CAMPUS_BACKEND', 'TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL',
    'FILE_STORAGE_BACKEND', 'NEXT_PUBLIC_FILE_STORAGE_BACKEND', 'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'DATABASE_URL', 'ASSIGNMENT_FILE_DATABASE_URL',
    'PLATFORM_ASSISTANT_DATABASE_URL', 'ASSIGNMENT_FILE_SIGNING_SECRET', 'ASSIGNMENT_FILE_STORE_DIR'];
  const disabled = ['TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED',
    'NEXT_PUBLIC_LMS_V2', 'NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS', 'NEXT_PUBLIC_ALLOW_LOCAL_MOCK_AUTH'];
  const enabled = ['TRONCLASS_RETENTION_ENABLED'];
  const names = [...cleared, ...disabled, ...enabled, 'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'TEST_HOST', 'WEB_PUBLIC_ORIGIN',
    'NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN', 'TRONCLASS_INTEGRATION_ENABLED'];
  try {
    // Capture only the controlled fixture variables at the first Node invocation
    // and stop before the launcher creates keys or starts a service.
    writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const fs = require('node:fs');
const names = ${JSON.stringify(names)};
fs.writeFileSync(process.env.TRONCLASS_LAUNCHER_CAPTURE,
  JSON.stringify(Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]))));
process.exit(73);
`, { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, TRONCLASS_LAUNCHER_CAPTURE: capture,
        ...Object.fromEntries(cleared.map((name) => [name, 'inherited-test-sentinel'])),
        ...Object.fromEntries(disabled.map((name) => [name, 'true'])),
        ...Object.fromEntries(enabled.map((name) => [name, 'false'])),
        TRONCLASS_INTEGRATION_ENABLED: 'true',
        ...scenario.env },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 73, result.stderr);
    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    for (const name of cleared) assert.equal(observed[name], null, name);
    for (const name of disabled) assert.equal(observed[name], 'false', name);
    for (const name of enabled) assert.equal(observed[name], 'true', name);
    assert.equal(observed.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19291');
    assert.equal(observed.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18291');
    assert.equal(observed.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-campus-one');
    assert.equal(observed.TEST_HOST, '127.0.0.1');
    assert.equal(observed.WEB_PUBLIC_ORIGIN, `http://127.0.0.1:${scenario.port ?? '3291'}`);
    assert.equal(observed.NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN, scenario.sameOrigin ?? null);
    assert.equal(observed.TRONCLASS_INTEGRATION_ENABLED, scenario.integration);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scenarios = [
  { name: 'local default', env: {}, integration: 'true' },
  { name: 'explicit loopback', env: { TEST_HOST: '127.0.0.1', HOST: 'localhost' }, integration: 'true' },
  { name: 'non-loopback TEST_HOST', env: { TEST_HOST: '0.0.0.0' }, integration: 'false' },
  { name: 'non-loopback HOST', env: { HOST: '192.0.2.1' }, integration: 'false' },
  { name: 'CI', env: { CI: 'true' }, integration: 'false' },
  { name: 'managed preview', env: { TRONCLASS_MANAGED_PREVIEW: '1', PORT: '4174' },
    integration: 'false', port: '4174', sameOrigin: 'true' },
  { name: 'hosted workspace', env: { CODESPACES: 'true' }, integration: 'false' },
];

for (const scenario of scenarios) {
  test(`launcher isolates stores and scopes integration to local use (${scenario.name})`, () => {
    assertLauncherEnvironment(scenario);
  });
}

test('launcher stores session keys in a private temporary directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-dir-'));
  const capture = path.join(dir, 'captured.json');
  try {
    writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('-e')) process.exit(0);
fs.writeFileSync(process.env.TRONCLASS_LAUNCHER_CAPTURE,
  JSON.stringify({ dir: process.env.TRONCLASS_RUNTIME_DIR ?? null }));
process.exit(73);
`, { mode: 0o700 });
    writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        TRONCLASS_LAUNCHER_CAPTURE: capture,
        TMPDIR: dir,
        HOME: dir,
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 73, result.stderr);
    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(typeof observed.dir, 'string');
    assert.match(observed.dir, /campus-tronclass-emulator\./);
    assert.notEqual(observed.dir, path.join(dir, `campus-tronclass-emulator-${process.getuid()}`));
    const info = statSync(observed.dir);
    assert.equal(info.mode & 0o777, 0o700);
    assert.equal(info.isDirectory(), true);
    assert.equal(lstatSync(observed.dir).isSymbolicLink(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher rejects a trailing slash on a symbolic link runtime directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-link-'));
  const target = path.join(dir, 'real');
  const link = path.join(dir, 'link');
  mkdirSync(target);
  symlinkSync(target, link);
  try {
    writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
if (process.argv.includes('-e')) process.exit(0);
process.exit(0);
`, { mode: 0o700 });
    writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        TMPDIR: dir,
        HOME: dir,
        TRONCLASS_RUNTIME_DIR: `${link}/`,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /symbolic link/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher refuses a symbolic link session key file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-key-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeFileSync(path.join(dir, 'outside.key'), 'x'.repeat(64));
  symlinkSync(path.join(dir, 'outside.key'), path.join(runtime, 'bff-session.key'));
  try {
    writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const args = process.argv;
if (args.includes('-e')) process.exit(0);
const dash = args.indexOf('-');
if (dash < 0) process.exit(1);
require('node:child_process').execFileSync(${JSON.stringify(process.execPath)}, args.slice(dash), { stdio: 'inherit' });
`, { mode: 0o700 });
    writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        TMPDIR: dir,
        HOME: dir,
        TRONCLASS_RUNTIME_DIR: runtime,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /symbolic link/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
