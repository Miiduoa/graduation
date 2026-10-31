/* global require, __dirname, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads CommonJS tooling. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = resolve(__dirname, '..');
const profile = JSON.parse(readFileSync(resolve(appRoot, 'eas.json'), 'utf8')).build.production;
const schoolFeatures = ['SSO', 'COURSES', 'GRADES', 'PAYMENTS', 'WIDGETS', 'DEEPLINKS'];
const mandatory = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'EAS_PROJECT_ID',
  'LEGAL_BASE_URL',
].map((key) => `EXPO_PUBLIC_${key}`);

// Resolve the real TypeScript config in a fresh process: neither an Expo module
// cache nor a developer's local dotenv values may make a release test pass.
function evaluate(overrides = {}, skipPlugins = true) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(EXPO_PUBLIC_|APP_ENV$|IOS_|ANDROID_|DOTENV_)/.test(key),
    ),
  );
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const {createRequire}=require('node:module');
       const expoRequire=createRequire(require.resolve('expo/package.json'));
       const {getConfig}=expoRequire('@expo/config');
       try { process.stdout.write(JSON.stringify(getConfig(process.cwd(), {skipPlugins:${skipPlugins}}).exp)); }
       catch (error) { process.stderr.write(error.message); process.exitCode=1; }`,
    ],
    {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...inherited,
        ...profile.env,
        EXPO_NO_DOTENV: '1',
        DOTENV_CONFIG_PATH: '/dev/null',
        ...overrides,
      },
    },
  );
}

function config(overrides, skipPlugins) {
  const result = evaluate(overrides, skipPlugins);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('production resolves with public service configuration and no school account dependency', () => {
  const app = config({}, false);
  assert.equal(profile.environment, 'production');
  assert.equal(app.android.package, 'com.nuni.app');
  assert.equal(app.ios.bundleIdentifier, 'com.nuni.app');
  assert.equal(app.extra.eas.projectId, '8955b97c-802c-463c-bd1d-d5f02e30a966');
  assert.equal(app.runtimeVersion, 'campus-one-native-photo-pdf-1');
  assert.equal(app.updates.url, `https://u.expo.dev/${app.extra.eas.projectId}`);
  assert.equal(app.extra.firebase.projectId, 'campus-one-tw');
  assert.equal(app.extra.legalBaseUrl, 'https://nuni.tw');
  assert.deepEqual(app.extra.release.releasedSchoolIds, []);
  assert.equal(app.extra.release.features.enabled, true);
  for (const feature of schoolFeatures)
    assert.equal(app.extra.release.features[feature.toLowerCase()], false);
  assert.equal(app.extra.errorReportingEndpoint, undefined);
  assert.equal(app.android.config?.googleMaps, undefined);
  assert.equal(app.ios.config?.googleMapsApiKey, undefined);
  assert.equal(app.extra.enableMockSSO, false);
  assert.equal(app.extra.enableUniversalDevAccounts, false);
  assert.equal(app.extra.allowLocalMockAuth, false);
});

test('each school capability remains gated by an explicit verified-school allowlist', () => {
  for (const feature of schoolFeatures) {
    const result = evaluate({ [`EXPO_PUBLIC_FEATURE_${feature}`]: 'true' });
    assert.equal(result.status, 1, feature);
    assert.match(result.stderr, /Enabled school features require verified schools/);
  }
  // This ID is a test-only fixture; it is never added to the production profile.
  const app = config({
    EXPO_PUBLIC_FEATURE_SSO: 'true',
    EXPO_PUBLIC_RELEASED_SCHOOL_IDS: 'verified-test-school',
  });
  assert.equal(app.extra.release.features.sso, true);
  assert.deepEqual(app.extra.release.releasedSchoolIds, ['verified-test-school']);
  assert.equal(app.extra.release.features.grades, false);
});

test('preview also permits platform-only access and rejects unreleased school capabilities', () => {
  assert.deepEqual(config({ APP_ENV: 'preview' }).extra.release.releasedSchoolIds, []);
  const result = evaluate({ APP_ENV: 'preview', EXPO_PUBLIC_FEATURE_COURSES: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verified schools/);
});

test('Firebase identity and legal requirements still fail closed', () => {
  for (const name of mandatory) {
    const result = evaluate({ [name]: '' });
    assert.equal(result.status, 1, name);
    assert.ok(result.stderr.includes(`Missing required release env: ${name}`), name);
  }
});

test('remote reporting requires explicit enablement and a valid HTTPS destination', () => {
  for (const enabled of ['', 'false']) {
    const app = config({
      EXPO_PUBLIC_ERROR_REPORTING_ENABLED: enabled,
      EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT: 'https://diagnostics.example.test/errors',
    });
    assert.equal(app.extra.errorReportingEndpoint, undefined);
  }
  for (const endpoint of [
    '',
    'not-a-url',
    'http://diagnostics.example.test/errors',
    'https://user:password@diagnostics.example.test/errors',
    'https://diagnostics.example.test/#secret',
  ]) {
    const result = evaluate({
      EXPO_PUBLIC_ERROR_REPORTING_ENABLED: 'true',
      EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT: endpoint,
    });
    assert.equal(result.status, 1, endpoint);
    assert.match(result.stderr, /ERROR_REPORTING_ENDPOINT/);
  }
  const endpoint = 'https://diagnostics.example.test/errors';
  assert.equal(
    config({
      EXPO_PUBLIC_ERROR_REPORTING_ENABLED: 'true',
      EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT: endpoint,
    }).extra.errorReportingEndpoint,
    endpoint,
  );
});

test('optional native Maps configuration and Google bundle validation still work', () => {
  const app = config({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'test-only-maps-key' });
  assert.equal(app.android.config.googleMaps.apiKey, 'test-only-maps-key');
  assert.equal(app.ios.config.googleMapsApiKey, 'test-only-maps-key');
  const result = evaluate({ IOS_BUNDLE_IDENTIFIER: 'com.campus.app.dev' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /registered production Google iOS client requires com.nuni.app/);
});

test('預覽與正式版使用獨立且包含影像模組的新執行版本', () => {
  const preview = config({ APP_ENV: 'preview' });
  assert.equal(preview.runtimeVersion, 'campus-preview-native-photo-pdf-1');
  assert.notEqual(preview.runtimeVersion, config().runtimeVersion);
  const updates = readFileSync(resolve(appRoot, 'ios/mobile/Supporting/Expo.plist'), 'utf8');
  assert.ok(updates.includes(preview.runtimeVersion));
});
