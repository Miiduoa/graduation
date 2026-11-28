/* global process, URL */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  releaseEnvironment,
  releaseTarget,
  verifyBuild,
  verifyReleaseRequest,
} from './verify-eas-build.mjs';

const env = {
  BUILD_PLATFORM: 'ios',
  BUILD_PROFILE: 'production',
  EXPECTED_EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
  EXPECTED_APP_IDENTIFIER: 'com.example.campus',
  GITHUB_SHA: 'a'.repeat(40),
};
const target = releaseTarget(env);
function build(patch = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'FINISHED',
    platform: 'IOS',
    buildProfile: 'production',
    gitCommitHash: target.commit,
    appIdentifier: target.appIdentifier,
    distribution: 'STORE',
    app: { id: target.projectId },
    isForIosSimulator: false,
    artifacts: { applicationArchiveUrl: 'https://example.com/campus.ipa' },
    ...patch,
  };
}

test('returns only the ID of this successful source, project and native app', () => {
  assert.equal(verifyBuild([build()], target), build().id);
});
for (const [label, patch] of [
  ['concurrent source build', { gitCommitHash: 'b'.repeat(40) }],
  ['different EAS project', { app: { id: '33333333-3333-4333-8333-333333333333' } }],
  ['wrong native bundle', { appIdentifier: 'com.campus.app.dev' }],
  ['different platform', { platform: 'ANDROID' }],
  ['different profile', { buildProfile: 'preview' }],
  ['internal distribution', { distribution: 'INTERNAL' }],
  ['still queued', { status: 'IN_QUEUE' }],
  ['failed', { status: 'ERRORED' }],
  ['simulator', { isForIosSimulator: true }],
  ['missing device evidence', { isForIosSimulator: undefined }],
  ['no artifact', { artifacts: {} }],
  ['insecure artifact', { artifacts: { buildUrl: 'http://example.com/app.ipa' } }],
  ['credential URL', { artifacts: { buildUrl: 'https://user:secret@example.com/app.ipa' } }],
  ['output injection', { id: 'valid\nother_id=bad' }],
]) {
  test(`rejects ${label}`, () => assert.throws(() => verifyBuild([build(patch)], target)));
}
test('rejects empty, ambiguous or malformed build records', () => {
  for (const records of [[], [build(), build()], null, {}, [null]]) {
    assert.throws(() => verifyBuild(records, target));
  }
});
test('requires explicit project, native identity, platform, profile and source before building', () => {
  for (const key of Object.keys(env)) assert.throws(() => releaseTarget({ ...env, [key]: '' }));
  assert.throws(() => releaseTarget({ ...env, EXPECTED_APP_IDENTIFIER: 'com.campus.app.dev' }));
  assert.throws(() => releaseTarget({ ...env, GITHUB_SHA: 'main' }));
});
test('accepts preview internal device builds without claiming store distribution', () => {
  const preview = releaseTarget({
    ...env,
    BUILD_PROFILE: 'preview',
    BUILD_PLATFORM: 'android',
    EXPECTED_APP_IDENTIFIER: 'com.example.campus.preview',
  });
  assert.equal(
    verifyBuild(
      [
        build({
          platform: 'ANDROID',
          buildProfile: 'preview',
          appIdentifier: preview.appIdentifier,
          distribution: 'INTERNAL',
          isForIosSimulator: undefined,
        }),
      ],
      preview,
    ),
    build().id,
  );
});
test('production-device keeps production identity and signed distribution but requires an APK', () => {
  const device = releaseTarget({
    ...env,
    BUILD_PLATFORM: 'android',
    BUILD_PROFILE: 'production-device',
  });
  assert.equal(releaseEnvironment(device.profile), 'production');
  const record = build({
    platform: 'ANDROID',
    buildProfile: 'production-device',
    artifacts: { applicationArchiveUrl: 'https://example.com/campus.apk' },
  });
  assert.equal(verifyBuild([record], device), record.id);
  for (const patch of [
    { artifacts: { applicationArchiveUrl: 'https://example.com/campus.aab' } },
    { buildProfile: 'production' },
    { distribution: 'INTERNAL' },
    { appIdentifier: 'com.example.dev' },
  ])
    assert.throws(() => verifyBuild([{ ...record, ...patch }], device));
  assert.throws(() => releaseTarget({ ...env, BUILD_PROFILE: 'production-device' }), /Android/);
  assert.throws(
    () =>
      releaseTarget({
        ...env,
        BUILD_PROFILE: 'production-device',
        BUILD_PLATFORM: 'android',
        EXPECTED_APP_IDENTIFIER: 'com.example.dev',
      }),
    /development app identifier/,
  );
});
test('device APK dispatch refuses store submission and every non-Android target', () => {
  const request = {
    BUILD_PLATFORM: 'android',
    BUILD_PROFILE: 'production-device',
    SUBMIT_TO_STORE: 'false',
  };
  verifyReleaseRequest(request);
  for (const submit of ['true', '', undefined])
    assert.throws(() => verifyReleaseRequest({ ...request, SUBMIT_TO_STORE: submit }), /submit/);
  for (const platform of ['all', 'ios'])
    assert.throws(() => verifyReleaseRequest({ ...request, BUILD_PLATFORM: platform }), /Android/);
  verifyReleaseRequest({
    BUILD_PLATFORM: 'all',
    BUILD_PROFILE: 'production',
    SUBMIT_TO_STORE: 'true',
  });
});
test('CLI emits a build ID only on successful verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-release-'));
  try {
    const input = join(dir, 'build.json');
    const output = join(dir, 'output');
    writeFileSync(output, '');
    writeFileSync(input, JSON.stringify([build({ gitCommitHash: 'b'.repeat(40) })]));
    const options = { env: { ...process.env, ...env, GITHUB_OUTPUT: output }, encoding: 'utf8' };
    const script = new URL('./verify-eas-build.mjs', import.meta.url);
    const run = () => spawnSync(process.execPath, [script.pathname, input], options);
    assert.equal(run().status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
    writeFileSync(input, JSON.stringify([build()]));
    assert.equal(run().status, 0);
    assert.equal(readFileSync(output, 'utf8'), `build_id=${build().id}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-only requests bind the selected commit before either native build starts', () => {
  const request = {
    ...env,
    BUILD_PLATFORM: 'all',
    BUILD_ONLY_SHA: env.GITHUB_SHA,
    SUBMIT_TO_STORE: 'false',
  };
  verifyReleaseRequest(request);
  for (const patch of [
    { GITHUB_SHA: 'b'.repeat(40) },
    { BUILD_ONLY_SHA: 'main' },
    { SUBMIT_TO_STORE: 'true' },
    { BUILD_PROFILE: 'preview' },
    { BUILD_PROFILE: 'production-device' },
  ])
    assert.throws(() => verifyReleaseRequest({ ...request, ...patch }));

  // Manual Release dispatches retain their original behavior when the new input is omitted.
  verifyReleaseRequest({ ...env, SUBMIT_TO_STORE: 'true' });
  verifyReleaseRequest({ ...env, BUILD_PROFILE: 'preview', SUBMIT_TO_STORE: 'false' });
});

test('the production command watches its own build-only run and propagates failures', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'production-command-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, 'checkout');
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls');
  mkdirSync(checkout);
  mkdirSync(bin);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-qm',
    'Build source',
  );
  const commit = git('rev-parse', 'HEAD');
  const repository = 'Miiduoa/graduation';
  const api = ['api', '--hostname', 'github.com', '-H', 'X-GitHub-Api-Version: 2026-03-10'];
  const ref = [...api, 'repos/' + repository + '/git/ref/heads/main', '--jq', '.object.sha'];
  const dispatch = [
    ...api,
    '--method',
    'POST',
    'repos/' + repository + '/actions/workflows/release.yml/dispatches',
    '-f',
    'ref=main',
    '-f',
    'inputs[platform]=all',
    '-f',
    'inputs[profile]=production',
    '-f',
    'inputs[submit]=false',
    '-f',
    'inputs[build_only_sha]=' + commit,
    '--jq',
    '.workflow_run_id',
  ];
  const watch = [
    'run',
    'watch',
    '1324',
    '--repo',
    'github.com/' + repository,
    '--exit-status',
    '--interval',
    '15',
  ];
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
require('node:fs').appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'run') process.exit(Number(process.env.WATCH_STATUS || 0));
if (args.includes('POST')) {
  console.log(process.env.RUN_ID || '1324');
  process.exit(Number(process.env.DISPATCH_STATUS || 0));
}
console.log(process.env.MAIN_SHA);
`,
    { mode: 0o755 },
  );
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['release:production'], 'node scripts/release-production.mjs');
  const launcher = fileURLToPath(new URL('../scripts/release-production.mjs', import.meta.url));
  const run = (overrides = {}) => {
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [launcher], {
      cwd: checkout,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + delimiter + process.env.PATH,
        CALL_LOG: log,
        MAIN_SHA: commit,
        ...overrides,
      },
    });
    return {
      ...result,
      calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    };
  };

  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(success.calls, [ref, dispatch, watch]);
  assert.match(success.stdout, /github\.com\/Miiduoa\/graduation\/actions\/runs\/1324/);
  const failed = run({ WATCH_STATUS: '9' });
  assert.equal(failed.status, 9);
  assert.deepEqual(failed.calls, success.calls);
  const refused = run({ DISPATCH_STATUS: '4' });
  assert.equal(refused.status, 4);
  assert.deepEqual(refused.calls, [ref, dispatch]);
  const missing = run({ RUN_ID: 'null' });
  assert.notEqual(missing.status, 0);
  assert.deepEqual(missing.calls, [ref, dispatch]);
  const moved = run({ MAIN_SHA: 'f'.repeat(40) });
  assert.notEqual(moved.status, 0);
  assert.deepEqual(moved.calls, [ref]);
  writeFileSync(join(checkout, 'local.js'), 'pending changes');
  const dirty = run();
  assert.notEqual(dirty.status, 0);
  assert.deepEqual(dirty.calls, []);
});
