import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { releaseTarget, verifyBuild } from './verify-eas-build.mjs';

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
