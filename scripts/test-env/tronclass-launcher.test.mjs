import assert from 'node:assert/strict';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const python = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();

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
if (process.argv.length === 4 && process.argv[2] === '-' &&
  process.argv[3].startsWith(process.env.TMPDIR + '/campus-tronclass-emulator.')) {
  const { status } = require('node:child_process').spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(status ?? 1);
}
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

test('launcher rejects a runtime directory replaced during fchmod', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-runtime-swap-'));
  const runtime = path.join(dir, 'runtime');
  const moved = path.join(dir, 'moved');
  const replacement = path.join(dir, 'replacement');
  try {
    mkdirSync(runtime, { mode: 0o755 });
    mkdirSync(replacement, { mode: 0o755 });
    // Run the real verifier with a deterministic rename at the fchmod boundary.
    writeFileSync(path.join(dir, 'python3'), `#!${python}
import os
import sys

target = sys.argv[-1]
sys.argv = ["-", target]
real_fchmod = os.fchmod

def swap_and_chmod(fd, mode):
    os.rename(target, ${JSON.stringify(moved)})
    os.rename(${JSON.stringify(replacement)}, target)
    real_fchmod(fd, mode)

os.fchmod = swap_and_chmod
exec(compile(sys.stdin.read(), "runtime verifier", "exec"))
`, { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TRONCLASS_RUNTIME_DIR: runtime,
        TRONCLASS_SIGNAL_SELFTEST: '1',
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /replaced directory/);
    assert.doesNotMatch(result.stdout, /RUN_ID=/);
    assert.equal(statSync(moved).mode & 0o777, 0o700);
    assert.equal(statSync(runtime).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(runtime), []);
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

test('launcher rejects a symbolic-link component written as link/.', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-dot-'));
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
        TRONCLASS_RUNTIME_DIR: `${link}/.`,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /symbolic link/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher rejects a runtime path whose intermediate component is a symbolic link', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-mid-'));
  const real = path.join(dir, 'real');
  const link = path.join(dir, 'link');
  mkdirSync(path.join(real, 'runtime'), { recursive: true, mode: 0o700 });
  symlinkSync(real, link);
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
        TRONCLASS_RUNTIME_DIR: path.join(link, 'runtime'),
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /symbolic link/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher resolves a relative runtime directory against the repository root', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-rel-'));
  const expected = path.join(dir, 'runtime');
  mkdirSync(expected, { mode: 0o700 });
  const relative = path.relative(repoRoot, expected);
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
        TRONCLASS_RUNTIME_DIR: relative,
      },
    });
    assert.equal(result.status, 73, result.stderr);
    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(observed.dir, expected);
    assert.equal(path.isAbsolute(observed.dir), true);
    assert.equal(path.isAbsolute(relative), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeForwardingNodeStub(dir) {
  writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const args = process.argv;
if (args.includes('-e')) process.exit(0);
const dash = args.indexOf('-');
if (dash < 0) process.exit(73);
require('node:child_process').execFileSync(${JSON.stringify(process.execPath)}, args.slice(dash), { stdio: 'inherit' });
`, { mode: 0o700 });
  writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
}

function writeSessionKey(file, mode = 0o600) {
  writeFileSync(file, 'x'.repeat(64), { mode });
}

test('launcher does not glob a literal * path component against the working tree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-glob-'));
  const real = path.join(dir, 'real');
  mkdirSync(path.join(real, 'runtime'), { recursive: true, mode: 0o700 });
  const star = path.join(dir, '*');
  symlinkSync(real, star);
  const runtime = path.join(star, 'runtime');
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
        TRONCLASS_RUNTIME_DIR: runtime,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /symbolic link/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher reuses an existing session key only when it is a private regular file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-reuse-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'));
  writeSessionKey(path.join(runtime, 'tronclass-session.key'));
  try {
    writeForwardingNodeStub(dir);
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        TMPDIR: dir,
        HOME: dir,
        TRONCLASS_RUNTIME_DIR: runtime,
      },
    });
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /session key|hard-linked|another user|not mode 0600|non-regular/i);
    assert.equal(readFileSync(path.join(runtime, 'bff-session.key'), 'utf8'), 'x'.repeat(64));
    assert.equal(statSync(path.join(runtime, 'bff-session.key')).mode & 0o777, 0o600);
    assert.equal(lstatSync(path.join(runtime, 'bff-session.key')).nlink, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher exports the validated descriptor when the runtime path is replaced', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-key-replacement-'));
  const runtime = path.join(dir, 'runtime');
  const replacement = path.join(dir, 'replacement');
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(replacement, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'));
  writeSessionKey(path.join(replacement, 'tronclass-session.key'));
  writeFileSync(path.join(replacement, 'bff-session.key'), 'y'.repeat(64), { mode: 0o644 });
  try {
    const preload = path.join(dir, 'replace.cjs');
    writeFileSync(preload, `
const fs = require('node:fs');
const runtime = process.env.TRONCLASS_RUNTIME_DIR;
if (process.argv[3] === 'bff-session.key') {
  const readSync = fs.readSync;
  fs.readSync = function (fd, ...args) {
    if (fs.readlinkSync('/proc/self/fd/' + fd) === runtime + '/bff-session.key') {
      fs.renameSync(runtime, runtime + '-original');
      fs.renameSync(${JSON.stringify(replacement)}, runtime);
    }
    return readSync.call(this, fd, ...args);
  };
}
`);
    writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '-e') process.exit(0);
if (args[0].endsWith('/firebase.js')) {
  require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'observed'))},
    String(process.env.BFF_SESSION_SECRET === 'x'.repeat(64)));
  process.exit(73);
}
const { status } = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, args, { stdio: 'inherit' });
process.exit(status ?? 1);
`, { mode: 0o700 });
    writeFileSync(path.join(dir, 'java'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./tronclass.sh', import.meta.url))], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TRONCLASS_RUNTIME_DIR: runtime,
        NODE_OPTIONS: `--require=${preload}` },
    });
    assert.equal(result.error, undefined);
    assert.equal(statSync(path.join(runtime, 'bff-session.key')).mode & 0o777, 0o644);
    assert.equal(readFileSync(path.join(dir, 'observed'), 'utf8'), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher refuses a reused session key that is not mode 0600', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-mode-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'), 0o644);
  try {
    writeForwardingNodeStub(dir);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /0600|mode/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher refuses a hard-linked session key file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-nlink-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  const outside = path.join(dir, 'outside.key');
  writeSessionKey(outside);
  linkSync(outside, path.join(runtime, 'bff-session.key'));
  try {
    writeForwardingNodeStub(dir);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /hard-linked|nlink/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const logTestRunId = '1234567890abcdef'.repeat(2);

function stubLogTestRunId(dir) {
  writeFileSync(path.join(dir, 'openssl'), `#!/bin/bash
echo ${logTestRunId}
`, { mode: 0o700 });
}

test('launcher refuses a symbolic link log file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-log-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'));
  writeSessionKey(path.join(runtime, 'tronclass-session.key'));
  const outside = path.join(dir, 'outside.log');
  writeFileSync(outside, 'preserve-me');
  symlinkSync(outside, path.join(runtime, `emulators.log.${logTestRunId}`));
  try {
    stubLogTestRunId(dir);
    writeForwardingNodeStub(dir);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /symbolic link or unusable log/i);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-me');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('launcher refuses a hard-linked log file without truncating the other link', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-log-hl-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'));
  writeSessionKey(path.join(runtime, 'tronclass-session.key'));
  const outside = path.join(dir, 'outside.log');
  writeFileSync(outside, 'preserve-hard-link');
  linkSync(outside, path.join(runtime, `emulators.log.${logTestRunId}`));
  try {
    stubLogTestRunId(dir);
    writeForwardingNodeStub(dir);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /symbolic link or unusable log/i);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-hard-link');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent launchers keep their logs and emulator readiness isolated', { timeout: 20000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { default: process } = await import('node:process');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-concurrent-logs-'));
  const script = fileURLToPath(import.meta.resolve('./tronclass.sh'));
  const launchers = [];
  const waitFor = async (condition, description) => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline) await delay(20);
    assert.ok(condition(), description);
  };
  const launch = label => {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        BASH_ENV: path.join(dir, 'bash-env'),
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_LOG_TEST_LABEL: label,
        TRONCLASS_SIGNAL_SELFTEST: '0',
        TRONCLASS_VERIFY_RUNTIME: '0',
        TRONCLASS_CHECK_HEALTH: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(proc, 'exit');
    const launcher = { proc, exited, output: '' };
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.on('data', chunk => { launcher.output += chunk; });
    }
    launchers.push(launcher);
    return launcher;
  };
  const logPath = (launcher, name) => path.join(dir, `${name}.log.${launcher.output.match(/RUN_ID=([a-f0-9]{32})/)?.[1]}`);
  const marker = name => path.join(dir, name);
  try {
    writeForwardingNodeStub(dir);
    writeSessionKey(path.join(dir, 'bff-session.key'));
    writeSessionKey(path.join(dir, 'tronclass-session.key'));
    writeFileSync(marker('bash-env'), `
grep() {
  command grep "$@"
  local status=$?
  if [[ "$TRONCLASS_LOG_TEST_LABEL" = second && "\${2:-}" = 'All emulators ready' && "$status" = 1 ]]; then
    touch "$TRONCLASS_RUNTIME_DIR/second-unready"
  fi
  return "$status"
}
`);
    writeFileSync(marker('node'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [arg, ...args] = process.argv.slice(2);
if (arg === '-') {
  const stdio = args[0]?.includes('.log.') ? [0, 1, 2, 3] : 'inherit';
  const { status } = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, [arg, ...args], { stdio });
  process.exit(status ?? 1);
}
const { TRONCLASS_RUNTIME_DIR: dir, TRONCLASS_LOG_TEST_LABEL: label } = process.env;
const marker = name => path.join(dir, name);
if (arg.endsWith('/firebase.js')) {
  console.log(label + ' emulator started');
  if (label === 'first') console.log('All emulators ready');
  let continued = false;
  setInterval(() => {
    if (continued || !fs.existsSync(marker(label + '-continue'))) return;
    continued = true;
    console.log(label === 'first' ? 'first emulator still writing' : 'All emulators ready');
  }, 20);
} else if (arg.endsWith('/seed.cjs')) {
  fs.writeFileSync(marker(label + '-seeded'), '');
} else if (arg.endsWith('/next')) {
  console.log(label + ' web started');
  let continued = false;
  setInterval(() => {
    if (continued || label !== 'first' || !fs.existsSync(marker('first-continue'))) return;
    continued = true;
    console.log('first web still writing');
  }, 20);
}
`, { mode: 0o700 });

    const first = launch('first');
    await waitFor(() => existsSync(logPath(first, 'web')), 'first launcher reached web startup');
    const firstEmulatorLog = logPath(first, 'emulators');
    const firstWebLog = logPath(first, 'web');
    await waitFor(() => readFileSync(firstWebLog, 'utf8').includes('first web started'), 'first web wrote its log');
    const firstEmulatorStart = readFileSync(firstEmulatorLog, 'utf8');
    assert.match(firstEmulatorStart, /first emulator started\nAll emulators ready/);

    const second = launch('second');
    const secondEmulatorLog = () => logPath(second, 'emulators');
    await waitFor(() => existsSync(secondEmulatorLog()) &&
      readFileSync(secondEmulatorLog(), 'utf8').includes('second emulator started') &&
      existsSync(marker('second-unready')), 'second launcher checked readiness while its emulator was unready');
    assert.equal(existsSync(marker('second-seeded')), false);
    assert.equal(readFileSync(firstEmulatorLog, 'utf8'), firstEmulatorStart);

    writeFileSync(marker('second-continue'), '');
    await waitFor(() => existsSync(logPath(second, 'web')), 'second launcher reached web startup after its own ready message');
    assert.ok(existsSync(marker('second-seeded')));
    assert.ok(second.proc.kill('SIGTERM'));
    assert.deepEqual(await second.exited, [143, null]);

    writeFileSync(marker('first-continue'), '');
    await waitFor(() => readFileSync(firstEmulatorLog, 'utf8').includes('first emulator still writing'), 'first emulator can still write after second cleanup');
    assert.ok(readFileSync(firstEmulatorLog, 'utf8').startsWith(firstEmulatorStart));
    await waitFor(() => readFileSync(firstWebLog, 'utf8').includes('first web still writing'), 'first web can still write after second cleanup');
    assert.equal(readFileSync(firstWebLog, 'utf8'), 'first web started\nfirst web still writing\n');
  } finally {
    for (const { proc } of launchers) proc.kill('SIGTERM');
    await Promise.all(launchers.map(({ exited }) => exited));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleanup kills a process-group descendant after the wrapper exits', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-signal-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => { stdout += chunk; });
    const started = Date.now();
    let childPid;
    let grandchildPid;
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile)) {
        childPid = Number(readFileSync(childPidFile, 'utf8').trim());
      }
      if (existsSync(grandchildPidFile)) {
        grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8').trim());
      }
      if (Number.isInteger(childPid) && childPid > 0 &&
          Number.isInteger(grandchildPid) && grandchildPid > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const wrap = /WRAPPER_PID=(\d+)/.exec(stdout);
    assert.ok(wrap, stdout);
    const wrapperPid = Number(wrap[1]);
    assert.ok(childPid && childPid !== wrapperPid, `child=${childPid} wrapper=${wrapperPid}`);
    assert.ok(grandchildPid && grandchildPid !== childPid, `grandchild=${grandchildPid}`);
    try { process.kill(wrapperPid, 'SIGTERM'); } catch (error) { assert.fail(String(error)); }
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.throws(() => process.kill(childPid, 0));
    assert.throws(() => process.kill(wrapperPid, 0));
    assert.throws(() => process.kill(grandchildPid, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher skips a reused wrapper PID and kills its registered detached group', { timeout: 12000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-wrapper-reuse-'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const grandchildFile = path.join(dir, 'grandchild.pid');
  const childFile = path.join(dir, 'child.pid');
  const registeredFile = path.join(dir, 'registered');
  const replacementFile = path.join(dir, 'replacement');
  const victimReady = path.join(dir, 'victim-ready');
  const original = readFileSync(script, 'utf8');
  // Supply the replacement PID while retaining the exited wrapper's start
  // time. This models PID reuse without relying on kernel PID allocation.
  const stubbornLeader = original.replace(
    'process.on("SIGTERM",()=>process.exit(0)); process.on("SIGINT",()=>process.exit(0));',
    'process.on("SIGTERM",()=>{}); process.on("SIGINT",()=>{});',
  );
  assert.notEqual(stubbornLeader, original);
  const fixture = stubbornLeader.replace('  wait "$TRONCLASS_SELFTEST_WRAPPER"\n', () => `
    printf '%s %s\n' "$TRONCLASS_SELFTEST_WRAPPER" "$TRONCLASS_SELFTEST_START" > "$WRAPPER_REGISTERED"
    while [ ! -s "$WRAPPER_REPLACEMENT" ]; do sleep 0.02; done
    builtin kill -KILL "$TRONCLASS_SELFTEST_WRAPPER"
    wait "$TRONCLASS_SELFTEST_WRAPPER" 2>/dev/null || true
    read -r TRONCLASS_SELFTEST_WRAPPER < "$WRAPPER_REPLACEMENT"
    kill -TERM "$$"
  `);
  assert.notEqual(fixture, stubbornLeader);
  const launcher = spawn('bash', ['-c', fixture, script], {
    env: {
      ...process.env,
      TRONCLASS_RUNTIME_DIR: dir,
      TRONCLASS_SIGNAL_SELFTEST: '1',
      TRONCLASS_SELFTEST_CHILD: childFile,
      TRONCLASS_SELFTEST_GRANDCHILD: grandchildFile,
      WRAPPER_REGISTERED: registeredFile,
      WRAPPER_REPLACEMENT: replacementFile,
    },
    stdio: 'ignore',
  });
  const launcherExited = once(launcher, 'exit');
  let victim;
  let victimExited;
  let leader;
  let grandchild;
  try {
    const deadline = Date.now() + 4000;
    while (![registeredFile, childFile, grandchildFile].every(existsSync) && Date.now() < deadline) await delay(20);
    const [wrapper, wrapperStart] = readFileSync(registeredFile, 'utf8').trim().split(' ');
    assert.match(wrapperStart, /^\d+$/);
    leader = Number(readFileSync(childFile, 'utf8'));
    grandchild = Number(readFileSync(grandchildFile, 'utf8'));
    process.kill(-leader, 0);
    victim = spawn(process.execPath, ['-e', `
      process.on('SIGTERM', () => {});
      process.on('SIGINT', () => {});
      require('node:fs').writeFileSync(process.argv[1], '');
      setInterval(() => {}, 1000);
    `, victimReady], { detached: true, stdio: 'ignore' });
    victimExited = once(victim, 'exit');
    while (!existsSync(victimReady) && Date.now() < deadline) await delay(20);
    assert.ok(existsSync(victimReady));
    const stat = readFileSync(`/proc/${victim.pid}/stat`, 'utf8');
    assert.notEqual(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19], wrapperStart);
    writeFileSync(replacementFile, `${victim.pid}\n`);
    assert.deepEqual(await launcherExited, [143, null]);
    assert.equal(existsSync(`/proc/${wrapper}`), false);
    process.kill(-victim.pid, 0);
    const reapDeadline = Date.now() + 1000;
    while (existsSync(`/proc/${grandchild}`) && Date.now() < reapDeadline) await delay(20);
    assert.throws(() => process.kill(-leader, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(grandchild, 0), { code: 'ESRCH' });
  } finally {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGTERM');
    if (victim?.exitCode === null && victim.signalCode === null) victim.kill('SIGKILL');
    await Promise.all([launcherExited, victimExited]);
    for (const pid of [leader, grandchild]) {
      if (pid && existsSync(`/proc/${pid}`)) process.kill(pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleans up marked descendants when the leader exits before capture', async (t) => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));

  for (const recordKind of ['current run', 'reused group', 'concurrent run', 'unreadable leader environ', 'old run', 'mismatched starttime', 'publication failure']) {
    await t.test(recordKind, { timeout: 14000 }, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-orphan-sidecar-'));
      const childFile = path.join(dir, 'child.pid');
      const descendantFile = path.join(dir, 'grandchild.pid');
      const findSidecar = () => readdirSync(dir).find(name => /^selftest\.log\.([a-f0-9]{32})\.pgid\.\1$/.test(name));
      const victim = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
      const victimExited = once(victim, 'exit');
      let launcher;
      let launcherExited;
      let descendant;
      let leader;
      let concurrent;
      let concurrentExited;
      try {
        // Suppress child discovery until the leader has exited, including when
        // launcher startup runs faster than the test can send TERM.
        writeFileSync(path.join(dir, 'ps'), `#!/bin/bash
if [[ "$*" == *--ppid* ]]; then exit 1; fi
exec /bin/ps "$@"
`, { mode: 0o755 });
        const failedPublication = path.join(dir, 'publication-failed');
        if (recordKind === 'publication failure') {
          writeFileSync(path.join(dir, 'python3'), `#!/bin/bash
if [[ "$2" != -c ]]; then exec ${JSON.stringify(python)} "$@"; fi
touch ${JSON.stringify(failedPublication)}
exit 1
`, { mode: 0o755 });
        }
        let args = [script];
        if (recordKind === 'reused group') {
          // Model a reused group number at the /proc boundary. The victim is
          // a real, unrelated process and any positive signal reaches it.
          const fixture = readFileSync(script, 'utf8').replace('source scripts/process-identity.sh', `$&
eval "$(declare -f proc_identity | sed '1s/proc_identity/real_proc_identity/')"
proc_identity() {
  real_proc_identity "$1" || return 1
  if [ "$1" = "${victim.pid}" ]; then
    real_proc_identity "$(cat "$TRONCLASS_SELFTEST_GRANDCHILD")" || return 1
    # Use the current member's group and start time to isolate provenance.
    [[ "$proc_state" != Z ]] || return 1
  fi
}
kill() {
  if [[ "\${1:-}" == -KILL && "\${3:-}" == "-$(cat "$TRONCLASS_SELFTEST_CHILD")" ]]; then
    touch "$TRONCLASS_RUNTIME_DIR/unverified-group-kill"
  fi
  builtin kill "$@"
}
`);
          args = ['-c', fixture, script];
        }
        launcher = spawn('bash', args, {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            TRONCLASS_RUNTIME_DIR: dir,
            TRONCLASS_SIGNAL_SELFTEST: '1',
            TRONCLASS_SELFTEST_CHILD: childFile,
            TRONCLASS_SELFTEST_GRANDCHILD: descendantFile,
          },
          stdio: 'ignore',
        });
        launcherExited = once(launcher, 'exit');
        const deadline = Date.now() + 4000;
        const published = () => recordKind === 'publication failure' ? existsSync(failedPublication) : findSidecar();
        while (!(published() && existsSync(descendantFile) && existsSync(childFile)) && Date.now() < deadline) {
          await delay(15);
        }
        assert.ok(published());
        descendant = Number(readFileSync(descendantFile, 'utf8'));
        process.kill(descendant, 0);
        leader = readFileSync(childFile, 'utf8');
        let sidecar, run, start;
        if (recordKind === 'publication failure') {
          assert.equal(findSidecar(), undefined);
        } else {
          sidecar = path.join(dir, findSidecar());
          const [recordRun, recordedLeader, recordStart, recordedGroup] = readFileSync(sidecar, 'utf8').trim().split(' ');
          run = recordRun;
          start = recordStart;
          assert.match(run, /^[a-f0-9]{32}$/);
          assert.match(start, /^\d+$/);
          assert.equal(recordedLeader, leader);
          assert.equal(recordedGroup, leader);
        }
        const victimStat = readFileSync(`/proc/${victim.pid}/stat`, 'utf8');
        const victimStart = victimStat.slice(victimStat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
        if (recordKind === 'old run') {
          const oldRun = (run[0] === 'a' ? 'b' : 'a') + run.slice(1);
          writeFileSync(sidecar, `${oldRun} ${victim.pid} ${victimStart}\n`);
        }
        if (recordKind === 'mismatched starttime') {
          writeFileSync(sidecar, `${run} ${victim.pid} ${BigInt(victimStart) + 1n}\n`);
        }
        if (recordKind === 'concurrent run' || recordKind === 'unreadable leader environ') {
          launcher.kill('SIGSTOP');
          // Model either a leader exiting during the marker check or a read
          // error while both the leader and its member remain alive.
          writeFileSync(path.join(dir, 'grep'), `#!/bin/bash
if [[ "\${@: -1}" == /proc/${leader}/environ ]]; then
  ${recordKind === 'concurrent run' ? `kill -TERM ${leader}
  while [[ -d /proc/${leader} ]]; do sleep 0.01; done
  exit 1` : 'exit 2'}
fi
if [[ "\${@: -1}" == /proc/${descendant}/environ ]]; then
  touch ${JSON.stringify(path.join(dir, 'member-checked'))}
fi
exec /bin/grep "$@"
`, { mode: 0o755 });
          concurrent = spawn('bash', [script], {
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH}`,
              TRONCLASS_RUNTIME_DIR: dir,
              TRONCLASS_SIGNAL_SELFTEST: '1',
              TRONCLASS_SELFTEST_CHILD: path.join(dir, 'concurrent-child.pid'),
              TRONCLASS_SELFTEST_GRANDCHILD: path.join(dir, 'concurrent-grandchild.pid'),
            },
            stdio: 'ignore',
          });
          concurrentExited = once(concurrent, 'exit');
          const findConcurrentRecord = () => readdirSync(dir).find(name =>
            /^selftest\.log\.([a-f0-9]{32})\.pgid\.\1$/.test(name) && name !== path.basename(sidecar));
          const concurrentDeadline = Date.now() + 4000;
          while (!findConcurrentRecord() && Date.now() < concurrentDeadline) await delay(15);
          assert.ok(findConcurrentRecord());
          assert.equal(readFileSync(sidecar, 'utf8').trim(), `${run} ${leader} ${start} ${leader}`);
          concurrent.kill('SIGTERM');
          assert.deepEqual(await concurrentExited, [143, null]);
          process.kill(descendant, 0);
          if (recordKind === 'unreadable leader environ') {
            assert.ok(existsSync(path.join(dir, 'member-checked')));
            process.kill(Number(leader), 'SIGTERM');
          }
          launcher.kill('SIGCONT');
        } else {
          process.kill(Number(leader), 'SIGTERM');
        }
        const [code, signal] = await launcherExited;
        assert.equal(code, 0);
        assert.equal(signal, null);
        process.kill(victim.pid, 0);
        assert.equal(existsSync(`/proc/${leader}`), false);
        assert.equal(existsSync(path.join(dir, 'unverified-group-kill')), false);
        const reapDeadline = Date.now() + 1000;
        while (existsSync(`/proc/${descendant}`) && Date.now() < reapDeadline) await delay(15);
        assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
      } finally {
        for (const pid of [descendant, Number(leader), victim.pid]) {
          if (pid && existsSync(`/proc/${pid}`)) process.kill(pid, 'SIGKILL');
        }
        if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
          launcher.kill('SIGTERM');
          launcher.kill('SIGCONT');
        }
        if (concurrent && concurrent.exitCode === null && concurrent.signalCode === null) concurrent.kill('SIGTERM');
        await Promise.all([victimExited, launcherExited, concurrentExited]);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test('launcher cleans up a detached port holder when signalled before assigning the wrapper PID', async (t) => {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const source = readFileSync(script, 'utf8').replace(
    String.raw`require(\"node:fs\").writeFileSync(process.env.TRONCLASS_SELFTEST_GRANDCHILD,String(process.pid));setInterval(()=>{},1000);`,
    String.raw`require(\"node:net\").createServer().listen(0,\"127.0.0.1\",function(){require(\"node:fs\").writeFileSync(process.env.TRONCLASS_SELFTEST_GRANDCHILD,process.pid+\" \"+this.address().port);});`,
  );
  assert.notEqual(source, readFileSync(script, 'utf8'));
  for (const [signal, expected] of [['INT', 130], ['TERM', 143]]) {
    await t.test(signal, { timeout: 12000 }, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-before-pid-'));
      const descendantFile = path.join(dir, 'descendant');
      const fixture = source.replace('  TRONCLASS_SELFTEST_WRAPPER=$!', () => `
        deadline=$((SECONDS + 4))
        until [ -s "$TRONCLASS_SELFTEST_GRANDCHILD" ]; do
          [ "$SECONDS" -lt "$deadline" ] || exit 1
          sleep 0.02
        done
        rm -- "$TRONCLASS_LAUNCHING_LOG.pgid.$TRONCLASS_RUN_ID"
        kill -${signal} "$$"
        TRONCLASS_SELFTEST_WRAPPER=$!`);
      assert.notEqual(fixture, source);
      const launcher = spawn('bash', ['-c', fixture, script], {
        env: {
          ...process.env,
          TRONCLASS_RUNTIME_DIR: dir,
          TRONCLASS_SIGNAL_SELFTEST: '1',
          TRONCLASS_TEST_DELAY_SPAWN_MS: '300',
          TRONCLASS_SELFTEST_CHILD: path.join(dir, 'child'),
          TRONCLASS_SELFTEST_GRANDCHILD: descendantFile,
        },
        stdio: 'ignore',
      });
      let descendant;
      try {
        const exit = await once(launcher, 'exit');
        let port;
        [descendant, port] = readFileSync(descendantFile, 'utf8').split(' ').map(Number);
        assert.deepEqual(exit, [expected, null]);
        const reapDeadline = Date.now() + 1000;
        while (existsSync(`/proc/${descendant}`) && Date.now() < reapDeadline) await delay(15);
        assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
        const server = createServer().listen(port, '127.0.0.1');
        await once(server, 'listening');
        await new Promise(resolve => server.close(resolve));
      } finally {
        if (descendant) {
          try { process.kill(descendant, 'SIGKILL'); } catch { /* already exited */ }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test('launcher INT/TERM cleanup exits with 128+signo and does not continue', async (t) => {
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    await t.test(`${signal} exits ${code}`, async () => {
      const { spawn } = await import('node:child_process');
      const { existsSync } = await import('node:fs');
      const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-term-'));
      const childPidFile = path.join(dir, 'child.pid');
      const grandchildPidFile = path.join(dir, 'grandchild.pid');
      const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
      try {
        const proc = spawn('bash', [script], {
          env: {
            ...process.env,
            TRONCLASS_RUNTIME_DIR: dir,
            TRONCLASS_SIGNAL_SELFTEST: '1',
            TRONCLASS_SELFTEST_CHILD: childPidFile,
            TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const started = Date.now();
        let childPid;
        let grandchildPid;
        while (Date.now() - started < 5000) {
          if (existsSync(childPidFile)) childPid = Number(readFileSync(childPidFile, 'utf8').trim());
          if (existsSync(grandchildPidFile)) grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8').trim());
          if (Number.isInteger(childPid) && childPid > 0 && Number.isInteger(grandchildPid) && grandchildPid > 0) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(childPid && grandchildPid);
        proc.kill(signal);
        const exited = await new Promise(resolve => {
          const timer = setTimeout(() => resolve('timeout'), 5000);
          proc.on('exit', (exitCode, exitSignal) => {
            clearTimeout(timer);
            resolve({ code: exitCode, signal: exitSignal });
          });
        });
        assert.notEqual(exited, 'timeout');
        assert.equal(exited.code, code);
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.throws(() => process.kill(childPid, 0));
        assert.throws(() => process.kill(grandchildPid, 0));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test('launcher cleanup ignores a stale pgid whose start-time does not match', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-stale-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const victim = spawn('sleep', ['30'], { stdio: 'ignore' });
  const staleRun = 'aa11bb22cc33dd44ee55ff6677889900';
  const stale = path.join(dir, `web.log.pgid.${staleRun}`);
  writeFileSync(stale, `${staleRun} ${victim.pid} 1\n`);
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile) && existsSync(grandchildPidFile)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(existsSync(stale), false);
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    process.kill(victim.pid, 0);
    victim.kill('SIGKILL');
    await new Promise(resolve => victim.once('exit', resolve));
  } finally {
    try { process.kill(victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher ignores a replaced current-run record for an unmarked live group', { timeout: 12000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-replaced-sidecar-'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const childFile = path.join(dir, 'child.pid');
  const grandchildFile = path.join(dir, 'grandchild.pid');
  const victim = spawn('env', ['-u', 'TRONCLASS_LAUNCHED_RUN', 'sleep', '30'], { detached: true, stdio: 'ignore' });
  const victimExited = once(victim, 'exit');
  const launcher = spawn('bash', [script], {
    env: { ...process.env, TRONCLASS_RUNTIME_DIR: dir, TRONCLASS_SIGNAL_SELFTEST: '1',
      TRONCLASS_SELFTEST_CHILD: childFile, TRONCLASS_SELFTEST_GRANDCHILD: grandchildFile },
    stdio: 'ignore',
  });
  const launcherExited = once(launcher, 'exit');
  let child;
  let grandchild;
  try {
    const deadline = Date.now() + 4000;
    let sidecar;
    while (Date.now() < deadline) {
      sidecar = readdirSync(dir).find(name => /^selftest\.log\.([a-f0-9]{32})\.pgid\.\1$/.test(name));
      if (sidecar && existsSync(childFile) && existsSync(grandchildFile)) break;
      await delay(15);
    }
    assert.ok(sidecar && existsSync(childFile) && existsSync(grandchildFile));
    child = Number(readFileSync(childFile, 'utf8'));
    grandchild = Number(readFileSync(grandchildFile, 'utf8'));
    const record = path.join(dir, sidecar);
    const [run] = readFileSync(record, 'utf8').trim().split(' ');
    const victimStat = readFileSync(`/proc/${victim.pid}/stat`, 'utf8');
    const fields = victimStat.slice(victimStat.lastIndexOf(')') + 1).trim().split(/\s+/);
    assert.equal(fields[2], String(victim.pid));
    const replaced = path.join(dir, 'replacement');
    writeFileSync(replaced, `${run} ${victim.pid} ${fields[19]}\n`, { mode: 0o600 });
    renameSync(replaced, record);

    assert.ok(launcher.kill('SIGTERM'));
    assert.deepEqual(await launcherExited, [143, null]);
    process.kill(-victim.pid, 0);
    assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(grandchild, 0), { code: 'ESRCH' });
  } finally {
    launcher.kill('SIGTERM');
    victim.kill('SIGKILL');
    await Promise.all([launcherExited, victimExited]);
    for (const pid of [child, grandchild]) {
      if (pid && existsSync(`/proc/${pid}`)) process.kill(pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher still stops the group when the pgid sidecar is a symbolic link', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-pgidlink-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const target = path.join(dir, 'other.pgid');
  writeFileSync(target, 'ignored\n');
  symlinkSync(target, path.join(dir, 'selftest.log.pgid'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    let childPid;
    let grandchildPid;
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile)) childPid = Number(readFileSync(childPidFile, 'utf8').trim());
      if (existsSync(grandchildPidFile)) grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8').trim());
      if (Number.isInteger(childPid) && childPid > 0 && Number.isInteger(grandchildPid) && grandchildPid > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      // Cleanup shares a 6-second deadline across groups; wait past that.
      const timer = setTimeout(() => resolve('timeout'), 8000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    assert.equal(exited.code, 143);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.throws(() => process.kill(childPid, 0));
    assert.throws(() => process.kill(grandchildPid, 0));
    assert.equal(readFileSync(target, 'utf8'), 'ignored\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleanup does not kill a previous run from a leftover matching web.pgid', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-leftover-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const victim = spawn('sleep', ['30'], { stdio: 'ignore', detached: true });
  victim.unref();
  const start = readFileSync(`/proc/${victim.pid}/stat`, 'utf8');
  const startTime = start.slice(start.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  writeFileSync(path.join(dir, 'web.log.pgid'), `${victim.pid} ${startTime}\n`);
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile) && existsSync(grandchildPidFile)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    process.kill(victim.pid, 0);
    assert.equal(existsSync(path.join(dir, 'web.log.pgid')), false);
    victim.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally {
    try { process.kill(-victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
    try { process.kill(victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleanup does not kill a previous run from a leftover three-column web.pgid', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-leftover3-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const victim = spawn('sleep', ['30'], { stdio: 'ignore', detached: true });
  victim.unref();
  const start = readFileSync(`/proc/${victim.pid}/stat`, 'utf8');
  const startTime = start.slice(start.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  const leftover = path.join(dir, 'web.log.pgid');
  writeFileSync(leftover, `aa11bb22cc33dd44ee55ff6677889900 ${victim.pid} ${startTime}\n`);
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile) && existsSync(grandchildPidFile)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(existsSync(childPidFile) && existsSync(grandchildPidFile), true);
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    process.kill(victim.pid, 0);
    assert.equal(existsSync(leftover), false);
    victim.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally {
    try { process.kill(-victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
    try { process.kill(victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleanup stops this-run descendants when the memory record is not yet assigned', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-early-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
        TRONCLASS_TEST_PAUSE_BEFORE_CAPTURE: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    let childPid;
    let grandchildPid;
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile)) childPid = Number(readFileSync(childPidFile, 'utf8').trim());
      if (existsSync(grandchildPidFile)) grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8').trim());
      if (Number.isInteger(childPid) && childPid > 0 && Number.isInteger(grandchildPid) && grandchildPid > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(childPid && grandchildPid);
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    assert.equal(exited.code, 143);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.throws(() => process.kill(childPid, 0));
    assert.throws(() => process.kill(grandchildPid, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent launchers preserve a live PGID write and remove dead-writer temporaries', { timeout: 20000 }, async () => {
  const { spawn, execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { env } = await import('node:process');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { URL } = await import('node:url');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-pgid-tmp-'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const preload = path.join(dir, 'pause.cjs');
  const opened = path.join(dir, 'opened');
  const resume = path.join(dir, 'resume');
  const published = path.join(dir, 'published');
  const finishPublication = path.join(dir, 'finish-publication');
  const collision = path.join(dir, 'collision');
  const launchers = [];
  const waitFor = async (condition, description) => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline) await delay(15);
    assert.ok(condition(), description);
  };
  const launch = (name, extraEnv = {}) => {
    const childFile = path.join(dir, `${name}.pid`);
    const proc = spawn('bash', [script], {
      env: {
        ...env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childFile,
        TRONCLASS_SELFTEST_GRANDCHILD: path.join(dir, `${name}-grandchild.pid`),
        ...extraEnv,
      },
      stdio: 'ignore',
    });
    const exited = once(proc, 'exit');
    launchers.push({ proc, exited });
    return { childFile };
  };
  let exits;
  try {
    writeFileSync(preload, `
const fs = require('node:fs');
const childProcess = require('node:child_process');
const wait = new Int32Array(new SharedArrayBuffer(4));
const pauseAfterPublish = target => {
  fs.writeFileSync(${JSON.stringify(published)}, target);
  while (!fs.existsSync(${JSON.stringify(finishPublication)})) Atomics.wait(wait, 0, 0, 15);
};
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  const result = spawnSync(command, args, options);
  const record = args.at(-1);
  if (command === 'python3' && record?.includes('.pgid.')) {
    if (process.env.TEST_PGID_COLLISION) {
      fs.writeFileSync(${JSON.stringify(collision)}, JSON.stringify({ record, status: result.status }));
    } else if (result.status === 0) {
      pauseAfterPublish(record);
    }
  }
  return result;
};
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  linkSync(source, target);
  if (target.includes('.pgid.')) pauseAfterPublish(target);
};
const fsync = fs.fsyncSync;
fs.fsyncSync = fd => {
  fsync(fd);
  const target = fs.readlinkSync('/proc/self/fd/' + fd);
  if (!target.includes('/.pgid-')) return;
  if (process.env.TEST_PGID_COLLISION) {
    const run = process.env.TRONCLASS_RUN_ID;
    const record = ${JSON.stringify(dir)} + '/selftest.log.' + run + '.pgid.' + run;
    fs.symlinkSync(${JSON.stringify(resume)}, record);
    return;
  }
  fs.writeFileSync(${JSON.stringify(opened)}, target);
  while (!fs.existsSync(${JSON.stringify(resume)})) Atomics.wait(wait, 0, 0, 15);
};
`);
    const first = launch('first', {
      NODE_OPTIONS: [env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(' '),
    });
    await waitFor(() => existsSync(opened) && readFileSync(opened, 'utf8'), 'first wrapper opened its temporary file');
    const active = readFileSync(opened, 'utf8');
    const [run] = readFileSync(active, 'utf8').trim().split(' ');
    const firstRecord = path.join(dir, `selftest.log.${run}.pgid.${run}`);
    assert.equal(existsSync(firstRecord), false);

    const writer = spawn('true');
    await once(writer, 'exit');
    const stale = ['aa', 'bb', 'cc'].map(suffix => path.join(dir, `.pgid-${writer.pid}-${suffix}.tmp`));
    writeFileSync(stale[0], readFileSync(active));
    execFileSync('mkfifo', [stale[1]]);
    symlinkSync(active, stale[2]);

    const second = launch('second');
    const records = () => readdirSync(dir).filter(name => /^selftest\.log\.([a-f0-9]{32})\.pgid\.\1$/.test(name));
    await waitFor(() => existsSync(second.childFile) && records().length === 1, 'second launcher published its own record');
    assert.ok(lstatSync(active).isFile());
    assert.deepEqual(readdirSync(dir).filter(name => name.startsWith(`.pgid-${writer.pid}-`)), []);
    writeFileSync(resume, '');
    await waitFor(() => existsSync(firstRecord) && existsSync(first.childFile), 'first wrapper published its own record');
    assert.equal(readFileSync(firstRecord, 'utf8').trim().split(' ')[1], readFileSync(first.childFile, 'utf8'));
    await waitFor(() => existsSync(published), 'first wrapper paused immediately after publication');
    assert.equal(lstatSync(firstRecord).nlink, 1);
    assert.equal(existsSync(active), false);
    const third = launch('third');
    await waitFor(() => existsSync(third.childFile) && records().length === 3, 'third launcher retained the first live record');
    assert.equal(lstatSync(firstRecord).nlink, 1);
    const fourth = launch('fourth', { TEST_PGID_COLLISION: '1', NODE_OPTIONS: `--require=${preload}` });
    await waitFor(() => existsSync(fourth.childFile) && existsSync(collision) && readFileSync(collision, 'utf8'),
      'fourth wrapper attempted publication over an existing symlink');
    const refused = JSON.parse(readFileSync(collision, 'utf8'));
    assert.equal(refused.status, 1);
    assert.ok(lstatSync(refused.record).isSymbolicLink());
    assert.equal(readFileSync(resume, 'utf8'), '');
  } finally {
    writeFileSync(resume, '');
    writeFileSync(finishPublication, '');
    for (const { proc } of launchers) proc.kill('SIGTERM');
    exits = await Promise.all(launchers.map(({ exited }) => exited));
    rmSync(dir, { recursive: true, force: true });
  }
  for (const exit of exits) assert.deepEqual(exit, [143, null]);
});

test('launcher startup unlinks a leftover FIFO pgid without blocking', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-fifo-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const leftover = path.join(dir, 'web.log.pgid');
  execSync(`mkfifo "${leftover}"`);
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (existsSync(childPidFile) && existsSync(grandchildPidFile)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(existsSync(leftover), false);
    assert.ok(existsSync(childPidFile) && existsSync(grandchildPidFile));
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    assert.equal(exited.code, 143);
  } finally {
    try { rmSync(leftover, { force: true }); } catch (error) { /* already unlinked */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher cleanup tracks a group spawned after the initial two-second polling window', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-latespawn-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  try {
    // Let the fixture finish installing its signal handlers before discovery.
    writeFileSync(path.join(dir, 'ps'), `#!/bin/bash
if [[ "$*" == *--ppid* && ! -s "$TRONCLASS_SELFTEST_GRANDCHILD" ]]; then
  exit 1
fi
exec /bin/ps "$@"
`, { mode: 0o755 });
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TRONCLASS_RUNTIME_DIR: dir,
        TRONCLASS_SIGNAL_SELFTEST: '1',
        TRONCLASS_SELFTEST_CHILD: childPidFile,
        TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
        TRONCLASS_TEST_DELAY_SPAWN_MS: '3000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let wrapperLine = '';
    proc.stdout.on('data', chunk => { wrapperLine += String(chunk); });
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (/WRAPPER_PID=\d+/.test(wrapperLine)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.match(wrapperLine, /WRAPPER_PID=\d+/);
    assert.equal(existsSync(childPidFile), false);
    proc.kill('SIGTERM');
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 9000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    assert.equal(exited.code, 143);
    await new Promise(resolve => setTimeout(resolve, 200));
    for (const pidFile of [childPidFile, grandchildPidFile]) {
      assert.ok(existsSync(pidFile), `Expected ${path.basename(pidFile)} to appear after SIGTERM`);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher exits with 143 when the wrapper stalls before spawning', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-stalled-wrapper-'));
  const childPidFile = path.join(dir, 'child.pid');
  const grandchildPidFile = path.join(dir, 'grandchild.pid');
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const proc = spawn('bash', [script], {
    env: {
      ...process.env,
      TRONCLASS_RUNTIME_DIR: dir,
      TRONCLASS_SIGNAL_SELFTEST: '1',
      TRONCLASS_SELFTEST_CHILD: childPidFile,
      TRONCLASS_SELFTEST_GRANDCHILD: grandchildPidFile,
      TRONCLASS_TEST_DELAY_SPAWN_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let wrapperLine = '';
  const selftestLogExists = () => readdirSync(dir).some(name => /^selftest\.log\.[a-f0-9]{32}$/.test(name));
  proc.stdout.on('data', chunk => { wrapperLine += String(chunk); });
  let timer;
  try {
    const startupDeadline = Date.now() + 5000;
    while (Date.now() < startupDeadline) {
      if (/WRAPPER_PID=\d+/.test(wrapperLine) && selftestLogExists()) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.match(wrapperLine, /WRAPPER_PID=\d+/);
    assert.ok(selftestLogExists());
    assert.equal(existsSync(childPidFile), false);
    const exited = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Launcher cleanup timed out')), 12000);
      proc.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.ok(proc.kill('SIGTERM'));
    assert.deepEqual(await exited, { code: 143, signal: null });
    assert.equal(existsSync(childPidFile), false);
    assert.equal(existsSync(grandchildPidFile), false);
    const wrapperPid = Number(wrapperLine.match(/WRAPPER_PID=(\d+)/)[1]);
    assert.throws(() => process.kill(wrapperPid, 0), { code: 'ESRCH' });
  } finally {
    clearTimeout(timer);
    if (proc.exitCode === null && proc.signalCode === null) {
      const wrapper = wrapperLine.match(/WRAPPER_PID=(\d+)/);
      if (wrapper) {
        try { process.kill(Number(wrapper[1]), 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      proc.kill('SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent launchers initialize session keys in an empty shared runtime directory', { timeout: 20000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-concurrent-keys-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const preload = path.join(dir, 'delay-wx.cjs');
  writeFileSync(preload, `const fs = require('node:fs');
const orig = fs.writeFileSync;
fs.writeFileSync = function writeFileSync(target, data, options) {
  if (options && options.flag === 'wx') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
  }
  return orig.apply(this, arguments);
};
`);
  writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const args = process.argv;
if (args.includes('-e')) process.exit(0);
const dash = args.indexOf('-');
if (dash < 0) process.exit(73);
require('node:child_process').execFileSync(${JSON.stringify(process.execPath)}, args.slice(dash), {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require=${preload}'].filter(Boolean).join(' ') },
});
`, { mode: 0o700 });
  writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
  const launch = () => {
    const proc = spawn('bash', [script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TMPDIR: dir,
        HOME: dir,
        TRONCLASS_RUNTIME_DIR: runtime,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.on('data', chunk => { output += chunk; });
    }
    return { proc, exited: once(proc, 'exit'), output: () => output };
  };
  try {
    const first = launch();
    const second = launch();
    const [firstExit, secondExit] = await Promise.all([first.exited, second.exited]);
    const combined = `${first.output()}\n${second.output()}`;
    assert.equal(firstExit[1], null, first.output());
    assert.equal(secondExit[1], null, second.output());
    assert.doesNotMatch(combined, /EEXIST|Invalid local session key|Refusing a /i);
    const keys = ['bff-session.key', 'tronclass-session.key'].map(name => path.join(runtime, name));
    const bodies = [];
    for (const file of keys) {
      const body = readFileSync(file, 'utf8');
      assert.match(body, /^[A-Za-z0-9_-]{64}$/);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(lstatSync(file).nlink, 1);
      bodies.push(body);
    }
    // The second launcher must reuse the first writer's keys, not fail with EEXIST.
    assert.equal(new Set(bodies).size, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function assertServiceCleanup(signal, helperFailure = false) {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-health-cleanup-'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const marker = name => path.join(dir, name);
  if (helperFailure) {
    writeFileSync(marker('bash-env'), `
source() {
  if [[ "$0" = signal-process-group ]]; then return 1; fi
  builtin source "$@"
}
`);
  }
  writeSessionKey(path.join(dir, 'bff-session.key'));
  writeSessionKey(path.join(dir, 'tronclass-session.key'));
  writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
  writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [arg, ...args] = process.argv.slice(2);
if (arg === '-') {
  const stdio = args[0]?.includes('.log.') ? [0, 1, 2, 3] : 'inherit';
  const { status } = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, [arg, ...args], { stdio });
  process.exit(status ?? 1);
}
if (arg === '-e') process.exit(0);
const dir = process.env.TRONCLASS_RUNTIME_DIR;
const writePid = name => fs.writeFileSync(path.join(dir, name), String(process.pid));
if (arg.endsWith('/firebase.js')) {
  writePid('emulator.pid');
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  console.log('All emulators ready');
  setInterval(() => {}, 1000);
} else if (arg.endsWith('/seed.cjs')) {
  writePid('seed.pid');
} else if (arg.endsWith('/next')) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      fs.writeFileSync(path.join(dir, 'web-signal'), signal);
      process.exit();
    });
  }
  writePid('web.pid');
  require('node:net').createServer().listen(0, '127.0.0.1', function () {
    fs.writeFileSync(path.join(dir, 'web-port'), String(this.address().port));
  });
} else if (arg.endsWith('/health-tronclass.cjs')) {
  writePid('health.pid');
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  fs.writeFileSync(path.join(dir, 'health-started'), '');
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  const proc = spawn('bash', [script], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      TMPDIR: dir,
      HOME: dir,
      TRONCLASS_RUNTIME_DIR: dir,
      TRONCLASS_CHECK_HEALTH: signal === 'health cleanup' ? '1' : '0',
      TRONCLASS_VERIFY_RUNTIME: '0',
      ...(helperFailure ? { BASH_ENV: marker('bash-env') } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(proc, 'exit');
  let output = '';
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on('data', chunk => { output += chunk; });
  }
  try {
    const deadline = Date.now() + 8000;
    const health = signal === 'health cleanup';
    const ready = marker(health ? 'health-started' : 'web-port');
    while (!existsSync(ready) && Date.now() < deadline) await delay(20);
    assert.ok(existsSync(ready), output);
    const pids = ['web.pid', 'emulator.pid', ...(health ? ['health.pid'] : [])]
      .map(name => Number(readFileSync(marker(name), 'utf8')));
    for (const pid of pids) process.kill(pid, 0);
    const started = Date.now();
    if (health) {
      assert.ok(proc.kill('SIGTERM'));
    } else {
      const wrapperPid = Number(readFileSync(`/proc/${pids[0]}/status`, 'utf8').match(/^PPid:\s+(\d+)/m)?.[1]);
      assert.ok(wrapperPid > 1);
      process.kill(wrapperPid, signal);
      const signalDeadline = Date.now() + 4000;
      while (!existsSync(marker('web-signal')) && Date.now() < signalDeadline) await delay(20);
      assert.ok(existsSync(marker('web-signal')), output);
    }
    assert.deepEqual(await exited, [health ? 143 : helperFailure ? 1 : 0, null], output);
    if (helperFailure) assert.match(output, /Unable to forward the signal/);
    assert.equal(readFileSync(marker('web-signal'), 'utf8'), health ? 'SIGTERM' : signal);
    assert.ok(Date.now() - started < 8000, 'cleanup should not wait for the health loop to finish on its own');
    for (const pid of pids) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `pid ${pid} still alive`);
    }
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM');
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('launcher TERM during a foreground health check stops health, web, and emulators', { timeout: 20000 },
  () => assertServiceCleanup('health cleanup'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`launcher forwards ${signal} sent directly to the Next wrapper`, { timeout: 20000 },
    () => assertServiceCleanup(signal));
}
test('launcher cleans up the verified Next group if the wrapper cannot load the identity helper', { timeout: 20000 },
  () => assertServiceCleanup('SIGTERM', true));

test('launcher cleanup stops web, emulator, and health in parallel under a shared 6-second deadline', { timeout: 20000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-parallel-cleanup-'));
  const script = fileURLToPath(new URL('./tronclass.sh', import.meta.url));
  const marker = name => path.join(dir, name);
  writeSessionKey(path.join(dir, 'bff-session.key'));
  writeSessionKey(path.join(dir, 'tronclass-session.key'));
  writeFileSync(path.join(dir, 'java'), `#!${process.execPath}
process.exit(0);
`, { mode: 0o700 });
  writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [arg, ...args] = process.argv.slice(2);
if (arg === '-') {
  const stdio = args[0]?.includes('.log.') ? [0, 1, 2, 3] : 'inherit';
  const { status } = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, [arg, ...args], { stdio });
  process.exit(status ?? 1);
}
if (arg === '-e') process.exit(0);
const dir = process.env.TRONCLASS_RUNTIME_DIR;
const writePid = name => fs.writeFileSync(path.join(dir, name), String(process.pid));
const ignoreStop = () => {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  setInterval(() => {}, 1000);
};
if (arg && arg.endsWith('/firebase.js')) {
  ignoreStop();
  writePid('emulator.pid');
  console.log('All emulators ready');
} else if (arg && arg.endsWith('/seed.cjs')) {
  writePid('seed.pid');
} else if (arg && arg.endsWith('/next')) {
  ignoreStop();
  writePid('web.pid');
} else if (arg && arg.endsWith('/health-tronclass.cjs')) {
  ignoreStop();
  writePid('health.pid');
  const detached = require('node:child_process').spawn(process.execPath, ['-e', \`
    process.on('SIGTERM', () => {});
    process.on('SIGINT', () => {});
    require('node:fs').writeFileSync(process.argv[1], String(process.pid));
    setInterval(() => {}, 1000);
  \`, path.join(dir, 'detached.pid')], { detached: true, stdio: 'ignore' });
  detached.unref();
}
`, { mode: 0o700 });
  // Pause the helpers until the parent has escalated while discovery is active.
  const shellHooks = marker('cleanup-hooks.bash');
  writeFileSync(shellHooks, `kill() {
  if [[ "$1" == -0 && -n "\${spawn_deadline:-}" && "$BASHPID" != "$$" &&
        -n "\${records[0]:-}" && "\${wrapper:-}" == "\${2:-}" &&
        "$EPOCHSECONDS" -ge "$((spawn_deadline - 1))" && -z "\${paused_cleanup:-}" ]]; then
    paused_cleanup=1
    printf '%s\\n' "$BASHPID" >> "$TRONCLASS_RUNTIME_DIR/helpers-paused"
    local cutoff=$((\${EPOCHREALTIME/./} + 1800000)) name pid complete
    while [[ "\${EPOCHREALTIME/./}" -lt "$cutoff" ]]; do
      complete=1
      for name in web emulator health detached; do
        read -r pid < "$TRONCLASS_RUNTIME_DIR/$name.pid" || true
        if ! grep -Fqx -- "-- $pid" "$TRONCLASS_RUNTIME_DIR/launcher-kills" 2>/dev/null; then
          complete=0
          break
        fi
      done
      [[ "$complete" = 0 ]] || break
      sleep 0.02
    done
    printf '%s\\n' "$BASHPID" >> "$TRONCLASS_RUNTIME_DIR/helpers-finished"
  fi
  if [[ "$1" == -KILL && "$BASHPID" == "$$" ]]; then
    printf '%s\\n' "\${*:2}" >> "$TRONCLASS_RUNTIME_DIR/launcher-kills"
  fi
  builtin kill "$@"
}
`);
  const proc = spawn('bash', [script], {
    env: {
      ...process.env,
      BASH_ENV: shellHooks,
      PATH: `${dir}:${process.env.PATH}`,
      TMPDIR: dir,
      HOME: dir,
      TRONCLASS_RUNTIME_DIR: dir,
      TRONCLASS_CHECK_HEALTH: '1',
      TRONCLASS_VERIFY_RUNTIME: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(proc, 'exit');
  let output = '';
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on('data', chunk => { output += chunk; });
  }
  try {
    const readyDeadline = Date.now() + 8000;
    const pidFiles = ['health.pid', 'web.pid', 'emulator.pid', 'detached.pid'].map(marker);
    while (!pidFiles.every(existsSync) && Date.now() < readyDeadline) await delay(20);
    assert.ok(pidFiles.every(existsSync), output);
    const pids = pidFiles.map(file => Number(readFileSync(file, 'utf8')));
    for (const pid of pids) process.kill(-pid, 0);
    const started = Date.now();
    assert.ok(proc.kill('SIGTERM'));
    assert.deepEqual(await exited, [143, null], output);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 8000, `cleanup took ${elapsed}ms; shared deadline should finish near 6s, not 6s per group`);
    const paused = readFileSync(marker('helpers-paused'), 'utf8').trim().split('\n').sort();
    const finished = readFileSync(marker('helpers-finished'), 'utf8').trim().split('\n').sort();
    assert.equal(paused.length, 3);
    assert.deepEqual(finished, paused, 'cleanup helpers completed after the shared deadline');
    const kills = readFileSync(marker('launcher-kills'), 'utf8').trim().split('\n');
    for (const pid of pids) {
      assert.ok(kills.includes(`-- ${pid}`), `launcher omitted SIGKILL to verified member ${pid}`);
      assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' }, `group ${pid} still alive`);
    }
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    for (const name of ['health.pid', 'web.pid', 'emulator.pid', 'detached.pid']) {
      if (!existsSync(marker(name))) continue;
      const pid = Number(readFileSync(marker(name), 'utf8'));
      if (pid > 1) {
        try { process.kill(-pid, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
