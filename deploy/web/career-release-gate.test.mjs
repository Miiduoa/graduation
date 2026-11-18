import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkCareerMachines, probeCareerRuntime } from './career-release-gate.mjs';
import { EXPECTED_MACHINES } from './release-check.mjs';

function settingsOptions(get = async () => ({ exists: false })) {
  const paths = [];
  const env = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'campus-one-tw', client_email: 'test@example.invalid', private_key: 'test\\nkey',
  }) };
  const requireFromWeb = (name) => name.endsWith('/app') ? {
    cert: (account) => { assert.equal(account.privateKey, 'test\nkey'); return {}; },
    initializeApp: () => ({}),
  } : { getFirestore: () => ({ doc: (path) => { paths.push(path); return { get }; } }) };
  return { env, requireFromWeb, paths };
}

test('cold runtime rejects absent, malformed and wrong-project credentials before accessing settings', async () => {
  for (const raw of [undefined, '', 'invalid', '{}', '{"project_id":"other"}']) {
    const options = settingsOptions();
    options.env.FIREBASE_SERVICE_ACCOUNT_JSON = raw;
    assert.deepEqual(await probeCareerRuntime('settings', options), { ready: false });
    assert.deepEqual(options.paths, []);
  }
});

test('settings gate requires a real successful read, accepts absent document and bounds failures', async () => {
  const options = settingsOptions();
  assert.deepEqual(await probeCareerRuntime('settings', options), { ready: true });
  assert.deepEqual(options.paths, ['schools/pu/settings/careerSources']);
  for (const get of [async () => { throw new Error('private SDK error'); }, () => new Promise(() => {})]) {
    assert.deepEqual(await probeCareerRuntime('settings', { ...settingsOptions(get), timeoutMs: 5 }), { ready: false });
  }
  const brokenSdk = settingsOptions();
  brokenSdk.requireFromWeb = () => { throw new Error('private credential error'); };
  assert.deepEqual(await probeCareerRuntime('settings', brokenSdk), { ready: false });
});

test('new Web process must serve fresh public feeds for both aliases without visitor credentials', async () => {
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(url);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers, undefined);
    return Response.json({ supported: true, sourceSettingsStale: false, announcements: [], jobs: [] });
  };
  assert.deepEqual(await probeCareerRuntime('feed', { fetcher }), { ready: true });
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get('school')), ['pu', 'tw-pu']);
  for (const response of [Response.json({}, { status: 503 }),
    Response.json({ supported: true, sourceSettingsStale: true, announcements: [], jobs: [] }),
    Response.json({ supported: false, sourceSettingsStale: false, announcements: [], jobs: [] })]) {
    assert.deepEqual(await probeCareerRuntime('feed', { fetcher: async () => response }), { ready: false });
  }
});

const rows = EXPECTED_MACHINES.map((id) => ({ id, state: 'started' }));
test('checks every approved machine and rejects failed/ambiguous/forged probe results without leaking output', () => {
  const targets = [];
  const execute = (binary, args, options) => {
    assert.equal(binary, 'flyctl');
    assert.equal(options.stdio[2], 'pipe');
    targets.push(args[2]);
    return JSON.stringify({ stdout: 'CAREER_RELEASE:{"ready":true}\n' });
  };
  assert.equal(checkCareerMachines(rows, 'settings', execute).length, 2);
  assert.deepEqual(targets, EXPECTED_MACHINES);
  for (const result of [
    { stdout: 'CAREER_RELEASE:{"ready":true}', exit_code: 1 },
    { stdout: 'CAREER_RELEASE:{"ready":false}' },
    { stdout: 'private credential output' },
    { stdout: 'CAREER_RELEASE:{"ready":true}\nCAREER_RELEASE:{"ready":true}' },
  ]) {
    assert.throws(() => checkCareerMachines(rows, 'feed', () => JSON.stringify(result)),
      { message: 'Career release probe failed; verify Web runtime credentials and settings access before release.' });
  }
  assert.throws(() => checkCareerMachines(rows, 'feed', () => { throw new Error('private CLI output'); }),
    { message: 'Career release probe failed; verify Web runtime credentials and settings access before release.' });
  for (const targets of [[], [rows[0], rows[0]], [{ id: 'other', state: 'started' }, rows[1]]]) {
    assert.throws(() => checkCareerMachines(targets, 'settings', execute), /Unexpected/);
  }
});

test('release blocks rollout on missing settings access and rolls back if fresh public feeds fail after rollout', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/web-release.yml', import.meta.url), 'utf8');
  const rollout = workflow.indexOf('      - name: Roll out to existing Web machines only');
  const before = workflow.indexOf('career-release-gate.mjs settings release-evidence/pre-rollout.json');
  const after = workflow.indexOf('career-release-gate.mjs feed release-evidence/after.json');
  const rollback = workflow.indexOf('      - name: Restore previous Web image after failed verification');
  assert.ok(before > 0 && before < rollout && rollout < after && after < rollback);
  assert.match(workflow.slice(rollback), /if: failure\(\) && steps\.rollout\.outcome == 'success'/);
});


test('generated machine command executes standalone and returns only a failure marker for missing credentials', () => {
  let command;
  checkCareerMachines(rows, 'settings', (_binary, args) => {
    command = args.at(-1);
    return JSON.stringify({ stdout: 'CAREER_RELEASE:{"ready":true}' });
  });
  assert.throws(() => execFileSync('bash', ['-c', command], {
    env: { ...process.env, FIREBASE_SERVICE_ACCOUNT_JSON: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), (error) => {
    assert.equal(error.status, 1);
    assert.equal(error.stdout, 'CAREER_RELEASE:{"ready":false}\n');
    assert.equal(error.stderr, '');
    return true;
  });
});
