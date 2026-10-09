/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads CommonJS tooling. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { resolve, join, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { buildPlan, main, production } = require('./prepare-native-release.cjs');
const appRoot = resolve(__dirname, '..');
const files = [
  'eas.json',
  'ios/mobile.xcodeproj/project.pbxproj',
  'ios/mobile/Info.plist',
  'ios/mobile/Supporting/Expo.plist',
];
function fixture(t, ci = false) {
  const workspace = mkdtempSync(join(tmpdir(), 'campus-native-release-'));
  const path = ci ? join(workspace, 'apps/mobile') : workspace;
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    copyFileSync(join(appRoot, file), join(path, file));
  }
  return path;
}
function ciEnvironment(path) {
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW: 'Release',
    GITHUB_WORKSPACE: resolve(path, '../..'),
    BUILD_PLATFORM: 'ios',
    BUILD_PROFILE: 'production',
  };
}
test('dry check reports missing production synchronization without changing the development files', (t) => {
  const path = fixture(t);
  const before = files.map((file) => readFileSync(join(path, file), 'utf8'));
  assert.throws(() => main(['--check', path]), /synchronization required/);
  assert.deepEqual(
    files.map((file) => readFileSync(join(path, file), 'utf8')),
    before,
  );
  assert.throws(() => main(['--write', appRoot]), /isolated release checkout/);
});
test('an isolated release has matching bundle, Google callback, channel and a distinct native runtime', (t) => {
  const path = fixture(t);
  const plan = buildPlan(path);
  assert.equal(plan.length, 3);
  main(['--write', path]);
  assert.equal(buildPlan(path).length, 0);
  main(['--check', path]);
  const project = readFileSync(join(path, files[1]), 'utf8');
  assert.equal([...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = com.nuni.app;/g)].length, 2);
  assert.ok(!project.includes('PRODUCT_BUNDLE_IDENTIFIER = com.campus.app.dev;'));
  const info = readFileSync(join(path, files[2]), 'utf8');
  assert.ok(info.includes(production.iosClientId));
  assert.ok(info.includes(production.iosClientId.split('.').reverse().join('.')));
  const updates = readFileSync(join(path, files[3]), 'utf8');
  assert.ok(updates.includes(production.runtimeVersion));
  assert.ok(updates.includes(`https://u.expo.dev/${production.projectId}`));
  assert.ok(updates.includes('expo-channel-name'));
  assert.ok(updates.includes('production'));
});
test('unrecognized existing native identities fail before any file changes', (t) => {
  const path = fixture(t);
  const projectPath = join(path, files[1]);
  writeFileSync(
    projectPath,
    readFileSync(projectPath, 'utf8').replaceAll('com.campus.app.dev', 'com.other.production'),
  );
  const before = files.map((file) => readFileSync(join(path, file), 'utf8'));
  assert.throws(() => main(['--write', path]), /unrecognized native target/);
  assert.deepEqual(
    files.map((file) => readFileSync(join(path, file), 'utf8')),
    before,
  );
});
test('a mismatched Google production client fails closed', (t) => {
  const path = fixture(t);
  const easPath = join(path, 'eas.json');
  const eas = JSON.parse(readFileSync(easPath, 'utf8'));
  eas.build.production.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID =
    '123-other.apps.googleusercontent.com';
  writeFileSync(easPath, JSON.stringify(eas));
  assert.throws(() => buildPlan(path), /verified EAS and Google clients/);
});
test('CI synchronization is restricted to the production iOS Release checkout', (t) => {
  const path = fixture(t, true);
  const env = ciEnvironment(path);
  const before = files.map((file) => readFileSync(join(path, file), 'utf8'));
  for (const key of Object.keys(env)) {
    assert.throws(() => main(['--ci-write', path], { ...env, [key]: '' }), /Release job checkout/);
  }
  assert.throws(
    () => main(['--ci-write', path], { ...env, BUILD_PROFILE: 'preview' }),
    /Release job checkout/,
  );
  assert.throws(
    () => main(['--ci-write', path], { ...env, BUILD_PLATFORM: 'android' }),
    /Release job checkout/,
  );
  assert.deepEqual(
    files.map((file) => readFileSync(join(path, file), 'utf8')),
    before,
  );
  main(['--ci-write', path], env);
  assert.equal(buildPlan(path).length, 0);
});
test('the production workflow synchronizes native identity before the existing release guard', async (t) => {
  const path = fixture(t, true);
  copyFileSync(join(appRoot, 'package.json'), join(path, 'package.json'));
  symlinkSync(resolve(appRoot, '../../node_modules'), join(path, 'node_modules'), 'dir');
  const { main: prepareBuild } = await import('../../../scripts/prepare-eas-build.mjs');
  const env = {
    ...ciEnvironment(path),
    EXPECTED_EAS_PROJECT_ID: production.projectId,
    EXPECTED_APP_IDENTIFIER: production.identifier,
    GITHUB_SHA: 'a'.repeat(40),
  };
  await assert.rejects(prepareBuild(['--prepare', path], env), /Native project identifier/);
  main(['--ci-write', path], env);
  await prepareBuild(['--prepare', path], env);
  const receipt = JSON.parse(readFileSync(join(path, '.release-build-target.json'), 'utf8'));
  assert.equal(receipt.platform, 'ios');
  assert.equal(receipt.appIdentifier, production.identifier);
  const workflow = readFileSync(resolve(appRoot, '../../.github/workflows/release.yml'), 'utf8');
  const ios = workflow.split('      - name: Build iOS\n')[1].split('      - name: Verify')[0];
  assert.match(ios, /if \[ "\$BUILD_PROFILE" = "production" \]/);
  assert.ok(
    ios.indexOf('prepare-native-release.cjs --ci-write .') <
      ios.indexOf('prepare-eas-build.mjs --prepare .'),
  );
});
