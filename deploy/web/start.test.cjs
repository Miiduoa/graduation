'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } = require('node:fs/promises');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');

const supervisor = join(__dirname, 'start.cjs');
const fakeServer = `
const http = require('node:http');
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
const server = http.createServer((request, response) => {
  response.end('ready');
  if (request.url === '/exit') setImmediate(() => process.exit(settings.exitCode ?? 0));
  if (request.url === '/crash') setImmediate(() => { throw new Error('test server failure'); });
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    fs.writeFileSync('signal.txt', signal);
    if (!settings.ignoreSignals) server.close(() => process.exit(settings.signalExitCodes?.[signal] ?? 0));
  });
}
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => {
  fs.writeFileSync('ready.json', JSON.stringify({
    pid: process.pid,
    port: server.address().port,
    hostname: server.address().address,
    origin: process.env.WEB_PUBLIC_ORIGIN,
    credential: process.env.TEST_SERVER_CREDENTIAL,
  }));
});
`;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function launch(
  t,
  { legacy = true, legacySettings = {}, customLegacyNode = false, overrides = {} } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'campus-web-supervisor-'));
  const directories = { current: join(root, 'current'), legacy: join(root, 'legacy') };
  const legacyNode = join(root, 'legacy-node');
  const runtimeMarker = join(root, 'runtime.txt');
  if (customLegacyNode) {
    await writeFile(
      legacyNode,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(runtimeMarker)}, process.cwd());\nrequire(require('node:path').resolve(process.argv[2]));\n`,
    );
    await chmod(legacyNode, 0o700);
  }
  for (const [name, directory] of Object.entries(directories)) {
    await mkdir(directory);
    await writeFile(join(directory, 'server.js'), fakeServer);
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify(name === 'legacy' ? legacySettings : {}),
    );
  }
  const port = await freePort();
  let legacyPort = await freePort();
  while (legacyPort === port) legacyPort = await freePort();
  const child = spawn(process.execPath, [supervisor], {
    env: {
      ...process.env,
      CURRENT_WEB_ROOT: directories.current,
      LEGACY_WEB_ROOT: legacy ? directories.legacy : '',
      PORT: String(port),
      LEGACY_WEB_PORT: String(legacyPort),
      WEB_PUBLIC_ORIGIN: 'https://public-origin.example',
      TEST_SERVER_CREDENTIAL: 'test-server-secret',
      WEB_SHUTDOWN_TIMEOUT_MS: '500',
      LEGACY_NODE_EXECUTABLE: customLegacyNode ? legacyNode : undefined,
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const pids = new Set();
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.race([done, delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    await done;
    await rm(root, { recursive: true, force: true });
  });
  async function ready(name) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const result = JSON.parse(await readFile(join(directories[name], 'ready.json'), 'utf8'));
        pids.add(result.pid);
        return result;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (child.exitCode !== null)
        assert.fail(`Supervisor exited before ${name} was ready: ${output}`);
      await delay(20);
    }
    assert.fail(`${name} did not start: ${output}`);
  }
  async function waitForExit() {
    const result = await Promise.race([done, delay(3000).then(() => 'timeout')]);
    assert.notEqual(result, 'timeout', `Supervisor failed to exit: ${output}`);
    assert.doesNotMatch(output, /test-server-secret/);
    return result;
  }
  return { child, ready, waitForExit, directories, port, legacyPort, runtimeMarker };
}

test('runs both servers on their assigned interfaces and preserves the public origin and credentials', async (t) => {
  const run = await launch(t);
  const current = await run.ready('current');
  const legacy = await run.ready('legacy');
  assert.equal(current.hostname, '0.0.0.0');
  assert.equal(legacy.hostname, '127.0.0.1');
  assert.equal(current.port, run.port);
  assert.equal(legacy.port, run.legacyPort);
  for (const server of [current, legacy]) {
    assert.equal(server.origin, 'https://public-origin.example');
    assert.equal(server.credential, 'test-server-secret');
  }
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.waitForExit(), { code: 0, signal: null });
  for (const name of ['current', 'legacy']) {
    assert.equal(await readFile(join(run.directories[name], 'signal.txt'), 'utf8'), 'SIGTERM');
  }
  assert.equal(alive(current.pid), false);
  assert.equal(alive(legacy.pid), false);
});

test('supports one current server and forwards SIGINT', async (t) => {
  const run = await launch(t, { legacy: false });
  const current = await run.ready('current');
  run.child.kill('SIGINT');
  assert.deepEqual(await run.waitForExit(), { code: 0, signal: null });
  assert.equal(await readFile(join(run.directories.current, 'signal.txt'), 'utf8'), 'SIGINT');
  assert.equal(alive(current.pid), false);
});

for (const [signal, exitCode] of [
  ['SIGTERM', 143],
  ['SIGINT', 130],
]) {
  test(`accepts a child exit code ${exitCode} only after forwarding ${signal}`, async (t) => {
    const run = await launch(t, { legacySettings: { signalExitCodes: { [signal]: exitCode } } });
    await run.ready('current');
    const legacy = await run.ready('legacy');
    run.child.kill(signal);
    assert.deepEqual(await run.waitForExit(), { code: 0, signal: null });
    assert.equal(await readFile(join(run.directories.legacy, 'signal.txt'), 'utf8'), signal);
    assert.equal(alive(legacy.pid), false);
  });

  test(`an unexpected exit code ${exitCode} still fails the container`, async (t) => {
    const run = await launch(t, { legacySettings: { exitCode } });
    const current = await run.ready('current');
    const legacy = await run.ready('legacy');
    await fetch(`http://127.0.0.1:${legacy.port}/exit`);
    assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
    assert.equal(alive(current.pid), false);
  });
}

for (const [signal, exitCode] of [
  ['SIGTERM', 130],
  ['SIGINT', 143],
  ['SIGTERM', 23],
]) {
  test(`rejects unrelated exit code ${exitCode} during ${signal} shutdown`, async (t) => {
    const run = await launch(t, { legacySettings: { signalExitCodes: { [signal]: exitCode } } });
    await run.ready('current');
    await run.ready('legacy');
    run.child.kill(signal);
    assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
  });
}

test('an unexpected successful current-server exit still fails the container and stops legacy', async (t) => {
  const run = await launch(t);
  const current = await run.ready('current');
  const legacy = await run.ready('legacy');
  await fetch(`http://127.0.0.1:${current.port}/exit`);
  assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
  assert.equal(alive(legacy.pid), false);
});

test('a legacy crash fails the container and stops the current server', async (t) => {
  const run = await launch(t);
  const current = await run.ready('current');
  const legacy = await run.ready('legacy');
  await fetch(`http://127.0.0.1:${legacy.port}/crash`);
  assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
  assert.equal(alive(current.pid), false);
});

test('kills an unresponsive child within the shutdown deadline and fails the exit', async (t) => {
  const run = await launch(t, { legacySettings: { ignoreSignals: true } });
  await run.ready('current');
  const legacy = await run.ready('legacy');
  const started = Date.now();
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
  assert.ok(Date.now() - started < 2500);
  assert.equal(alive(legacy.pid), false);
});

test('rejects an invalid target before launching any server', async (t) => {
  const run = await launch(t, { overrides: { LEGACY_WEB_ROOT: 'relative/path' } });
  assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
  await assert.rejects(readFile(join(run.directories.current, 'ready.json')), { code: 'ENOENT' });
});

test('uses the explicit legacy Node executable only for the legacy server', async (t) => {
  const run = await launch(t, { customLegacyNode: true });
  await run.ready('current');
  await run.ready('legacy');
  assert.equal(await readFile(run.runtimeMarker, 'utf8'), await realpath(run.directories.legacy));
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.waitForExit(), { code: 0, signal: null });
});

for (const executable of ['relative/node', '/missing-campus-runtime']) {
  test(`rejects unavailable legacy runtime ${executable} before starting either server`, async (t) => {
    const run = await launch(t, { overrides: { LEGACY_NODE_EXECUTABLE: executable } });
    assert.deepEqual(await run.waitForExit(), { code: 1, signal: null });
    await assert.rejects(readFile(join(run.directories.current, 'ready.json')), { code: 'ENOENT' });
  });
}
