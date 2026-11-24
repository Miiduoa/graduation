import assert from 'node:assert/strict';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('launcher refuses a symbolic link log file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-launcher-log-'));
  const runtime = path.join(dir, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  writeSessionKey(path.join(runtime, 'bff-session.key'));
  writeSessionKey(path.join(runtime, 'tronclass-session.key'));
  const outside = path.join(dir, 'outside.log');
  writeFileSync(outside, 'preserve-me');
  symlinkSync(outside, path.join(runtime, 'emulators.log'));
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
  linkSync(outside, path.join(runtime, 'emulators.log'));
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
    assert.match(`${result.stderr}\n${result.stdout}`, /symbolic link or unusable log/i);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-hard-link');
  } finally {
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
  writeFileSync(path.join(dir, 'web.log.pgid'), `${victim.pid} 1\n`);
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
    victim.kill('SIGKILL');
    await new Promise(resolve => victim.once('exit', resolve));
  } finally {
    try { process.kill(victim.pid, 'SIGKILL'); } catch (error) { /* already exited */ }
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
    assert.equal(existsSync(leftover), false);
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

test('launcher cleanup tracks a group spawned after the first child scan', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-latespawn-'));
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
        TRONCLASS_TEST_DELAY_SPAWN_MS: '800',
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
      const timer = setTimeout(() => resolve('timeout'), 6000);
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.notEqual(exited, 'timeout');
    assert.equal(exited.code, 143);
    await new Promise(resolve => setTimeout(resolve, 200));
    if (existsSync(childPidFile)) {
      const childPid = Number(readFileSync(childPidFile, 'utf8').trim());
      assert.throws(() => process.kill(childPid, 0));
    }
    if (existsSync(grandchildPidFile)) {
      const grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8').trim());
      assert.throws(() => process.kill(grandchildPid, 0));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
