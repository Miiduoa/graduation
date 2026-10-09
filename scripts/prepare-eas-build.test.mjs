import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  identityEnvironment,
  prepareBuildConfig,
  prepareBuildPackage,
  verifyAppConfig,
  verifyNativeIdentity,
  verifyResolvedBuildConfig,
} from './prepare-eas-build.mjs';
import { releaseTarget } from './verify-eas-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = join(root, 'apps/mobile');
const script = join(root, 'scripts/prepare-eas-build.mjs');
const base = JSON.parse(readFileSync(join(mobile, 'eas.json'), 'utf8'));
const env = {
  BUILD_PLATFORM: 'android',
  BUILD_PROFILE: 'production',
  EXPECTED_EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
  EXPECTED_APP_IDENTIFIER: 'com.example.campus',
  GITHUB_SHA: 'a'.repeat(40),
};
const target = releaseTarget(env);
const fixtureEnv = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'synthetic-public-key',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'fixture.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'fixture',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'fixture.appspot.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '12345678',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:12345678:web:fixture',
  EXPO_PUBLIC_LEGAL_BASE_URL: 'https://example.test/legal',
  EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT: 'https://example.test/errors',
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'synthetic-public-map-key',
  EXPO_PUBLIC_RELEASED_SCHOOL_IDS: 'pu',
};
function fixture(t, native = false) {
  const project = mkdtempSync(join(tmpdir(), 'campus-build-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const name of ['app.json', 'app.config.ts', 'package.json', 'eas.json'])
    copyFileSync(join(mobile, name), join(project, name));
  mkdirSync(join(project, 'scripts'), { recursive: true });
  copyFileSync(
    join(mobile, 'scripts/configure-nuni-google.cjs'),
    join(project, 'scripts/configure-nuni-google.cjs'),
  );
  symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
  if (native) {
    mkdirSync(join(project, 'ios/mobile.xcodeproj'), { recursive: true });
    copyFileSync(
      join(mobile, 'ios/mobile.xcodeproj/project.pbxproj'),
      join(project, 'ios/mobile.xcodeproj/project.pbxproj'),
    );
  }
  return project;
}
function run(args, environment = {}, cwd = root) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment },
    encoding: 'utf8',
  });
}
function actualExpoConfig(project, environment) {
  const program = `const {createRequire}=require('node:module'); const app=createRequire(process.argv[1]+'/package.json'); const expo=createRequire(app.resolve('expo/package.json')); const {getConfig}=expo('@expo/config'); console.log(JSON.stringify(getConfig(process.argv[1], {skipPlugins:true}).exp));`;
  const result = spawnSync(process.execPath, ['-e', program, project], {
    cwd: project,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...fixtureEnv, ...environment },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function resolved(appConfig) {
  return {
    appConfig,
    buildProfile: {
      environment: 'production',
      distribution: 'store',
      env: identityEnvironment(target),
    },
  };
}
function writeAndroid(
  project,
  contents = 'android { defaultConfig { applicationId "com.example.campus" } }',
) {
  mkdirSync(join(project, 'android/app'), { recursive: true });
  writeFileSync(join(project, 'android/app/build.gradle'), contents);
}

test('prepares both shared and platform env without changing unrelated profiles or input', () => {
  const original = structuredClone(base);
  const prepared = prepareBuildConfig(base, target);
  assert.deepEqual(base, original);
  assert.deepEqual(prepared.build.preview, base.build.preview);
  assert.deepEqual(prepared.submit, base.submit);
  for (const [key, value] of Object.entries(identityEnvironment(target))) {
    assert.equal(prepared.build.production.env[key], value);
    assert.equal(prepared.build.production.android.env[key], value);
  }
  assert.equal(prepared.build.production.environment, 'production');
  assert.equal(prepared.build.production.android.environment, 'production');
  assert.ok(!Object.hasOwn(prepared.build.production.env, 'IOS_BUNDLE_IDENTIFIER'));
});

test('actual dynamic Expo config reproduces the original gap and receives the prepared identity', (t) => {
  const project = fixture(t);
  const withoutBinding = actualExpoConfig(project, {
    APP_ENV: 'production',
    EXPO_PUBLIC_EAS_PROJECT_ID: target.projectId,
    EXPECTED_APP_IDENTIFIER: target.appIdentifier,
  });
  assert.notEqual(withoutBinding.android.package, target.appIdentifier);
  assert.throws(() => verifyAppConfig(withoutBinding, target), /identifier/);
  const withBinding = actualExpoConfig(
    project,
    prepareBuildConfig(base, target).build.production.android.env,
  );
  assert.equal(withBinding.android.package, target.appIdentifier);
  assert.equal(withBinding.extra.eas.projectId, target.projectId);
  verifyResolvedBuildConfig(resolved(withBinding), target);
});

test('rejects every missing or invalid target before changing any file', (t) => {
  const project = fixture(t);
  const original = readFileSync(join(project, 'eas.json'), 'utf8');
  const packageOriginal = readFileSync(join(project, 'package.json'), 'utf8');
  for (const key of Object.keys(env)) {
    const result = run(['--prepare', project], { ...env, [key]: '' });
    assert.equal(result.status, 1, key);
  }
  assert.equal(
    run(['--prepare', project], { ...env, EXPECTED_APP_IDENTIFIER: 'com.example.dev' }).status,
    1,
  );
  assert.equal(readFileSync(join(project, 'eas.json'), 'utf8'), original);
  assert.equal(readFileSync(join(project, 'package.json'), 'utf8'), packageOriginal);
  assert.equal(existsSync(join(project, '.release-build-target.json')), false);
});

test('release manifests omit development provider credentials and preserve export compliance', (t) => {
  const project = fixture(t);
  const key = 'development-only-provider-key';
  for (const appEnv of ['preview', 'production']) {
    const config = actualExpoConfig(project, {
      ...identityEnvironment(target),
      APP_ENV: appEnv,
      EXPO_PUBLIC_GEMINI_API_KEY: key,
    });
    assert.equal(config.extra.geminiApiKey, '');
    assert.equal(JSON.stringify(config).includes(key), false);
    assert.equal(config.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
    assert.ok(config.ios.infoPlist.NSCameraUsageDescription);
  }
  const development = actualExpoConfig(project, {
    APP_ENV: 'development',
    EXPO_PUBLIC_GEMINI_API_KEY: key,
  });
  assert.equal(development.extra.geminiApiKey, key);
});

test('local conflicting env and inherited malformed profile values fail closed', (t) => {
  const project = fixture(t);
  assert.equal(
    run(['--prepare', project], { ...env, ANDROID_PACKAGE_NAME: 'com.other.app' }).status,
    1,
  );
  for (const config of [
    {},
    { ...base, cli: { requireCommit: true } },
    { build: { production: { env: [] } } },
    { build: { production: { android: { env: [] } } } },
  ])
    assert.throws(() => prepareBuildConfig(config, target));
});

test('the generated monorepo hook executes the existing hook and the worker guard', (t) => {
  const checkout = mkdtempSync(join(tmpdir(), 'campus-hook-'));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const project = join(checkout, 'apps/mobile');
  mkdirSync(project, { recursive: true });
  for (const name of ['app.json', 'app.config.ts', 'package.json', 'eas.json'])
    copyFileSync(join(mobile, name), join(project, name));
  mkdirSync(join(project, 'scripts'), { recursive: true });
  copyFileSync(
    join(mobile, 'scripts/configure-nuni-google.cjs'),
    join(project, 'scripts/configure-nuni-google.cjs'),
  );
  symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  mkdirSync(join(checkout, 'scripts'));
  for (const name of ['prepare-eas-build.mjs', 'verify-eas-build.mjs'])
    copyFileSync(join(root, 'scripts', name), join(checkout, 'scripts', name));
  const manifestPath = join(project, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.scripts['eas-build-post-install'] =
    `node -e "require('fs').writeFileSync('prior-hook-ok', 'ok')"`;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(run(['--prepare', project], env).status, 0);
  writeAndroid(project);
  const hook = JSON.parse(readFileSync(manifestPath, 'utf8')).scripts['eas-build-post-install'];
  const invoke = () =>
    spawnSync('/bin/sh', ['-c', hook], {
      cwd: project,
      env: {
        PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
        HOME: process.env.HOME,
        ...fixtureEnv,
        ...identityEnvironment(target),
      },
      encoding: 'utf8',
    });
  const success = invoke();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(readFileSync(join(project, 'prior-hook-ok'), 'utf8'), 'ok');
  assert.match(success.stdout, /Worker Expo and native identities match/);
  writeAndroid(project, 'android { defaultConfig { applicationId "com.other.app" } }');
  assert.equal(invoke().status, 1);
});

test('preserves an existing hook and blocks a second preparation', (t) => {
  const manifest = {
    scripts: { 'eas-build-post-install': 'node validate-native.cjs', start: 'expo start' },
  };
  const prepared = prepareBuildPackage(manifest);
  assert.match(
    prepared.scripts['eas-build-post-install'],
    /^\( node validate-native.cjs \) && node .*--worker/,
  );
  assert.equal(prepared.scripts.start, 'expo start');
  assert.throws(() => prepareBuildPackage(prepared), /already prepared/);
  const project = fixture(t);
  assert.equal(run(['--prepare', project], env).status, 0);
  assert.equal(run(['--prepare', project], env).status, 1);
  assert.deepEqual(
    JSON.parse(readFileSync(join(project, '.release-build-target.json'), 'utf8')),
    target,
  );
});

test('tracked iOS .dev identity remains blocked without rewriting native or app config', async (t) => {
  const project = fixture(t, true);
  const paths = [
    'eas.json',
    'app.json',
    'app.config.ts',
    'package.json',
    'ios/mobile.xcodeproj/project.pbxproj',
  ];
  const originals = paths.map((name) => readFileSync(join(project, name), 'utf8'));
  const result = run(['--prepare', project], { ...env, BUILD_PLATFORM: 'ios' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Native project identifier does not match/);
  paths.forEach((name, index) =>
    assert.equal(readFileSync(join(project, name), 'utf8'), originals[index]),
  );
  assert.equal(existsSync(join(project, '.release-build-target.json')), false);
  await assert.rejects(verifyNativeIdentity(project, { ...target, platform: 'ios' }), /identifier/);
});

test('a worker validates actual Expo config and generated Android native identity', (t) => {
  const project = fixture(t);
  assert.equal(run(['--prepare', project], env).status, 0);
  writeAndroid(project);
  const receipt = join(project, '.release-build-target.json');
  const workerEnv = { ...fixtureEnv, ...identityEnvironment(target) };
  const success = run(['--worker', receipt], workerEnv, project);
  assert.equal(success.status, 0, success.stderr);
  // A remote environment secret can override profile env; compare against the file, not EXPECTED_*.
  for (const key of Object.keys(identityEnvironment(target))) {
    const failure = run(
      ['--worker', receipt],
      { ...workerEnv, [key]: 'wrong', EXPECTED_APP_IDENTIFIER: 'wrong' },
      project,
    );
    assert.equal(failure.status, 1, key);
    assert.match(failure.stderr, /does not match the release receipt/);
    assert.ok(!failure.stderr.includes('synthetic-public-key'));
  }
  writeAndroid(project, 'android { defaultConfig { applicationId "com.other.app" } }');
  assert.equal(run(['--worker', receipt], workerEnv, project).status, 1);
});

test('worker rejects missing native output, dynamic IDs and multi-flavor Android projects', async (t) => {
  const project = fixture(t);
  await assert.rejects(verifyNativeIdentity(project, target, {}, true), /no native project/);
  for (const contents of [
    'android { defaultConfig { applicationId System.getenv("ANDROID_PACKAGE_NAME") } }',
    'android { defaultConfig { applicationId "com.example.campus"; applicationIdSuffix ".dev" } }',
    'android { defaultConfig { applicationId "com.example.campus" }; productFlavors { free {} } }',
  ]) {
    writeAndroid(project, contents);
    await assert.rejects(verifyNativeIdentity(project, target, {}, true));
  }
});

test('rejects EAS configuration mismatches before building', (t) => {
  const project = fixture(t);
  const config = resolved(actualExpoConfig(project, identityEnvironment(target)));
  for (const patch of [
    { environment: 'preview' },
    { distribution: 'internal' },
    { env: {} },
    { simulator: true },
    { developmentClient: true },
    { withoutCredentials: true },
  ])
    assert.throws(() =>
      verifyResolvedBuildConfig(
        { ...config, buildProfile: { ...config.buildProfile, ...patch } },
        target,
      ),
    );
  for (const patch of [
    { android: { package: 'com.other.app' } },
    { extra: { ...config.appConfig.extra, eas: { projectId: 'wrong' } } },
    { extra: { ...config.appConfig.extra, appEnv: 'development' } },
    { updates: { url: 'https://u.expo.dev/wrong' } },
  ])
    assert.throws(() =>
      verifyResolvedBuildConfig(
        { ...config, appConfig: { ...config.appConfig, ...patch } },
        target,
      ),
    );
});

test(
  'EAS CLI 24.12.0 schema and resolver bind inherited platform overrides for local and worker config',
  {
    skip:
      !process.env.EAS_JSON_PACKAGE_ROOT &&
      'Set EAS_JSON_PACKAGE_ROOT to EAS CLI 24.12.0 dependency @expo/eas-json@24.9.0.',
  },
  (t) => {
    const require = createRequire(import.meta.url);
    const packageRoot = process.env.EAS_JSON_PACKAGE_ROOT;
    assert.equal(require(join(packageRoot, 'package.json')).version, '24.9.0');
    const { resolveBuildProfile } = require(join(packageRoot, 'build/build/resolver.js'));
    const { BuildProfileSchema } = require(join(packageRoot, 'build/build/schema.js'));
    const project = fixture(t);
    const inherited = structuredClone(base);
    inherited.build.base.env = { APP_ENV: 'development', EXPO_PUBLIC_EAS_PROJECT_ID: 'wrong' };
    inherited.build.base.android = {
      environment: 'development',
      env: { ANDROID_PACKAGE_NAME: 'com.other.dev', APP_ENV: 'development' },
    };
    inherited.build.base.ios = { env: { IOS_BUNDLE_IDENTIFIER: 'com.other.dev' } };
    for (const platform of ['android', 'ios']) {
      for (const profile of ['production', 'preview']) {
        const expected = { ...target, platform, profile };
        const prepared = prepareBuildConfig(inherited, expected);
        assert.equal(
          BuildProfileSchema.validate(prepared.build[profile], { abortEarly: false }).error,
          undefined,
        );
        const buildProfile = resolveBuildProfile({
          easJson: prepared,
          platform,
          profileName: profile,
        });
        const appConfig = actualExpoConfig(project, buildProfile.env);
        verifyResolvedBuildConfig({ buildProfile, appConfig }, expected);
        assert.equal(
          appConfig[platform][platform === 'ios' ? 'bundleIdentifier' : 'package'],
          expected.appIdentifier,
        );
        assert.equal(appConfig.extra.eas.projectId, expected.projectId);
      }
    }
  },
);
