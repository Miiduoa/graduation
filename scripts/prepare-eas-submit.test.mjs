import assert from 'node:assert/strict';
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { prepareSubmitConfig } from './prepare-eas-submit.mjs';

const base = JSON.parse(readFileSync(new URL('../apps/mobile/eas.json', import.meta.url), 'utf8'));
const iosEnv = {
  BUILD_PLATFORM: 'ios',
  EXPECTED_APP_IDENTIFIER: 'com.example.campus',
  APPLE_ID: 'campus.release+store@example.com',
  ASC_APP_ID: '1234567890',
  APPLE_TEAM_ID: 'AB12CD34EF',
};

test('writes verified iOS values without touching build or Android settings', () => {
  const original = structuredClone(base);
  const result = prepareSubmitConfig(base, iosEnv);
  assert.deepEqual(result.submit.production.ios, {
    ...base.submit.production.ios,
    appleId: iosEnv.APPLE_ID,
    ascAppId: iosEnv.ASC_APP_ID,
    appleTeamId: iosEnv.APPLE_TEAM_ID,
    bundleIdentifier: iosEnv.EXPECTED_APP_IDENTIFIER,
  });
  assert.deepEqual(result.build, base.build);
  assert.deepEqual(result.submit.production.android, base.submit.production.android);
  assert.deepEqual(base, original, 'Input configuration must not be mutated.');
});

for (const name of ['APPLE_ID', 'ASC_APP_ID', 'APPLE_TEAM_ID']) {
  test(`requires explicit ${name}, even if a previous profile has a value`, () => {
    const stale = prepareSubmitConfig(base, iosEnv);
    assert.throws(() => prepareSubmitConfig(stale, { ...iosEnv, [name]: '' }), new RegExp(name));
  });
}

test('rejects malformed Apple account, app and team values without echoing them', () => {
  const values = [
    ['APPLE_ID', 'not-an-email'],
    ['APPLE_ID', 'private..email@example.com'],
    ['APPLE_ID', 'private@example-.com'],
    ['APPLE_ID', 'private@example'],
    ['APPLE_ID', 'private\ninjected@example.com'],
    ['APPLE_ID', '${APPLE_ID}'],
    ['ASC_APP_ID', 'private-not-digits'],
    ['ASC_APP_ID', '1'.repeat(31)],
    ['ASC_APP_ID', '${ASC_APP_ID}'],
    ['APPLE_TEAM_ID', 'private123'],
    ['APPLE_TEAM_ID', 'ABC'],
    ['APPLE_TEAM_ID', '${APPLE_TEAM_ID}'],
  ];
  for (const [name, value] of values) {
    assert.throws(
      () => prepareSubmitConfig(base, { ...iosEnv, [name]: value }),
      (error) => {
        assert.match(error.message, new RegExp(name));
        assert.ok(!error.message.includes(value));
        return true;
      },
    );
  }
});

test('Android without a supplied path uses remote credential resolution and preserves draft/internal release policy', () => {
  const stale = structuredClone(base);
  stale.submit.production.android.serviceAccountKeyPath = '${GOOGLE_SERVICE_ACCOUNT_KEY_PATH}';
  const result = prepareSubmitConfig(stale, { ...iosEnv, BUILD_PLATFORM: 'android' });
  assert.ok(!Object.hasOwn(result.submit.production.android, 'serviceAccountKeyPath'));
  assert.equal(result.submit.production.android.applicationId, iosEnv.EXPECTED_APP_IDENTIFIER);
  assert.equal(result.submit.production.android.track, 'internal');
  assert.equal(result.submit.production.android.releaseStatus, 'draft');
  assert.equal(result.submit.production.android.changesNotSentForReview, true);
  assert.deepEqual(result.submit.production.ios, base.submit.production.ios);
});

test('Android only includes an explicit absolute readable service account file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'campus-submit-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = join(directory, 'service-account.json');
  writeFileSync(key, 'private-test-content', { mode: 0o600 });
  const result = prepareSubmitConfig(base, {
    ...iosEnv,
    BUILD_PLATFORM: 'android',
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: key,
  });
  assert.equal(result.submit.production.android.serviceAccountKeyPath, realpathSync(key));
  assert.equal(readFileSync(key, 'utf8'), 'private-test-content');
  const expandable = join(directory, '${OTHER_ACCOUNT}.json');
  writeFileSync(expandable, 'private-test-content');
  for (const invalid of [
    'relative-key.json',
    join(directory, 'missing.json'),
    directory,
    expandable,
  ]) {
    assert.throws(
      () =>
        prepareSubmitConfig(base, {
          ...iosEnv,
          BUILD_PLATFORM: 'android',
          GOOGLE_SERVICE_ACCOUNT_KEY_PATH: invalid,
        }),
      (error) => {
        assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_KEY_PATH/);
        assert.ok(!error.message.includes(invalid));
        return true;
      },
    );
  }
});

test('requires the verified production native identity and replaces stale credential lookup IDs', () => {
  for (const platform of ['ios', 'android']) {
    const field = platform === 'ios' ? 'bundleIdentifier' : 'applicationId';
    const stale = structuredClone(base);
    stale.submit.production[platform][field] = 'com.example.previous';
    const env = { ...iosEnv, BUILD_PLATFORM: platform };
    const prepared = prepareSubmitConfig(stale, env);
    assert.equal(prepared.submit.production[platform][field], iosEnv.EXPECTED_APP_IDENTIFIER);
    for (const appIdentifier of [
      undefined,
      '',
      'not-an-id',
      'com.example app',
      'com.example.dev',
      'com.example.demo',
      'com.example.test',
      'com.example.preview',
      'com.example.staging',
      'com.example.DEV',
    ]) {
      assert.throws(
        () =>
          prepareSubmitConfig(stale, {
            ...env,
            EXPECTED_APP_IDENTIFIER: appIdentifier,
          }),
        /app identifier/,
      );
    }
  }
});

test('refuses unsupported platforms and absent production submit profiles', () => {
  for (const platform of [undefined, '', 'all', 'web']) {
    assert.throws(() => prepareSubmitConfig(base, { ...iosEnv, BUILD_PLATFORM: platform }));
  }
  for (const config of [
    null,
    [],
    {},
    { submit: { production: [] } },
    { submit: { production: {} } },
  ]) {
    assert.throws(() => prepareSubmitConfig(config, iosEnv));
  }
});

test('the committed config contains no unsupported store account placeholders', () => {
  const ios = base.submit.production.ios;
  for (const key of ['appleId', 'ascAppId', 'appleTeamId']) assert.ok(!Object.hasOwn(ios, key));
  assert.ok(!Object.hasOwn(base.submit.production.android, 'serviceAccountKeyPath'));
});

test('CLI validates before writing and never logs personal values or file contents', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'campus-submit-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'eas.json');
  const original = `${JSON.stringify(base)}\n`;
  writeFileSync(configPath, original);
  const run = (env) =>
    spawnSync(
      process.execPath,
      [new URL('./prepare-eas-submit.mjs', import.meta.url).pathname, configPath],
      { encoding: 'utf8', env: { ...process.env, ...env } },
    );
  const failed = run({ ...iosEnv, ASC_APP_ID: 'private-invalid' });
  assert.equal(failed.status, 1);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.doesNotMatch(failed.stdout + failed.stderr, /private-invalid|campus.release/);
  const success = run(iosEnv);
  assert.equal(success.status, 0, success.stderr);
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(saved.submit.production.ios.ascAppId, iosEnv.ASC_APP_ID);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['eas.json']);
  for (const value of Object.values(iosEnv).slice(1)) {
    assert.ok(!(success.stdout + success.stderr).includes(value));
  }
  accessSync(configPath, constants.R_OK);
  assert.ok(existsSync(configPath));
});

test(
  'EAS CLI 24.12.0 dependency resolves and validates the prepared profiles',
  {
    skip:
      !process.env.EAS_JSON_PACKAGE_ROOT &&
      'Set EAS_JSON_PACKAGE_ROOT to @expo/eas-json 24.9.0 from EAS CLI 24.12.0 for the schema check.',
  },
  () => {
    const require = createRequire(import.meta.url);
    const root = process.env.EAS_JSON_PACKAGE_ROOT;
    assert.equal(require(join(root, 'package.json')).version, '24.9.0');
    const { resolveSubmitProfile } = require(join(root, 'build/submit/resolver.js'));
    const { ResolvedIosSubmitProfileSchema, AndroidSubmitProfileSchema } = require(
      join(root, 'build/submit/schema.js'),
    );
    const legacy = structuredClone(base);
    Object.assign(legacy.submit.production.ios, {
      appleId: '${APPLE_ID}',
      ascAppId: '${ASC_APP_ID}',
      appleTeamId: '${APPLE_TEAM_ID}',
    });
    const unresolved = resolveSubmitProfile({
      easJson: legacy,
      platform: 'ios',
      profileName: 'production',
    });
    const failure = ResolvedIosSubmitProfileSchema.validate(unresolved, { abortEarly: false });
    assert.deepEqual(
      failure.error.details.map((detail) => detail.path[0]),
      ['appleId', 'ascAppId', 'appleTeamId'],
    );
    for (const platform of ['ios', 'android']) {
      const prepared = prepareSubmitConfig(base, { ...iosEnv, BUILD_PLATFORM: platform });
      const resolved = resolveSubmitProfile({
        easJson: prepared,
        platform,
        profileName: 'production',
      });
      const schema =
        platform === 'ios' ? ResolvedIosSubmitProfileSchema : AndroidSubmitProfileSchema;
      assert.equal(schema.validate(resolved, { abortEarly: false }).error, undefined);
      if (platform === 'ios') {
        assert.equal(resolved.appleId, iosEnv.APPLE_ID);
        assert.equal(resolved.ascAppId, iosEnv.ASC_APP_ID);
        assert.equal(resolved.appleTeamId, iosEnv.APPLE_TEAM_ID);
        assert.equal(resolved.bundleIdentifier, iosEnv.EXPECTED_APP_IDENTIFIER);
      } else {
        assert.ok(!Object.hasOwn(resolved, 'serviceAccountKeyPath'));
        assert.equal(resolved.applicationId, iosEnv.EXPECTED_APP_IDENTIFIER);
      }
    }
  },
);
