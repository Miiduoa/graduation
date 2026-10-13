const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const {
  assertSafeCafeteriaSeedTarget,
  resolveSeedProjectId,
  DEFAULT_TEST_PROJECT,
} = require('./seed-cafeterias.js');

const script = path.join(__dirname, 'seed-cafeterias.js');

function env(overrides = {}) {
  return {
    GCLOUD_PROJECT: 'demo-campus-one',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    NODE_ENV: 'development',
    ...overrides,
  };
}

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 5000,
    env: {
      PATH: process.env.PATH,
      ...env(overrides),
    },
  });
}

test('defaults the seed project to the local demo id', () => {
  assert.equal(resolveSeedProjectId({}), DEFAULT_TEST_PROJECT);
  assert.equal(DEFAULT_TEST_PROJECT, 'campus-demo-3a869');
});

test('allows a local Firestore emulator with a demo project', () => {
  assert.doesNotThrow(() => assertSafeCafeteriaSeedTarget(env()));
  assert.doesNotThrow(() =>
    assertSafeCafeteriaSeedTarget(env({ FIRESTORE_EMULATOR_HOST: 'localhost:8080' })),
  );
  assert.doesNotThrow(() =>
    assertSafeCafeteriaSeedTarget(env({ FIRESTORE_EMULATOR_HOST: '[::1]:8080' })),
  );
});

test('allows an explicit test environment without an emulator', () => {
  assert.doesNotThrow(() =>
    assertSafeCafeteriaSeedTarget(
      env({
        NODE_ENV: 'test',
        GCLOUD_PROJECT: 'campus-demo-3a869',
        FIRESTORE_EMULATOR_HOST: '',
      }),
    ),
  );
});

test('refuses NODE_ENV=production even with a local emulator', () => {
  assert.throws(
    () => assertSafeCafeteriaSeedTarget(env({ NODE_ENV: 'production' })),
    /NODE_ENV=production/,
  );
});

test('refuses APP_ENV=production even when NODE_ENV is unset', () => {
  assert.throws(
    () => assertSafeCafeteriaSeedTarget(env({ NODE_ENV: '', APP_ENV: 'production' })),
    /APP_ENV=production/,
  );
});

test('refuses the production Firebase project even with a local emulator', () => {
  assert.throws(
    () => assertSafeCafeteriaSeedTarget(env({ GCLOUD_PROJECT: 'campus-one-tw' })),
    /campus-one-tw/,
  );
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({ GCLOUD_PROJECT: 'demo-campus-one', FIREBASE_PROJECT_ID: 'campus-one-tw' }),
      ),
    /campus-one-tw/,
  );
});

test('refuses a remote DATABASE_URL even with a local emulator', () => {
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({ DATABASE_URL: 'postgresql://db.nuni.tw:5432/campus' }),
      ),
    /DATABASE_URL/,
  );
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({
          DATABASE_URL:
            'postgresql://127.0.0.1:5432/campus?host=db.nuni.tw',
        }),
      ),
    /DATABASE_URL/,
  );
});

test('accepts a loopback DATABASE_URL alongside a local emulator', () => {
  assert.doesNotThrow(() =>
    assertSafeCafeteriaSeedTarget(
      env({ DATABASE_URL: 'postgresql://127.0.0.1:5432/campus_test' }),
    ),
  );
});

test('refuses a remote emulator host', () => {
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }),
      ),
    /不是本機/,
  );
});

test('refuses credentials against a cloud project when no local emulator or test env is set', () => {
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({
          FIRESTORE_EMULATOR_HOST: '',
          NODE_ENV: 'development',
          GCLOUD_PROJECT: 'campus-demo-3a869',
          GOOGLE_APPLICATION_CREDENTIALS: '/tmp/sa.json',
        }),
      ),
    /沒有本機模擬器/,
  );
});

test('does not honor bypass flags for the production project', () => {
  assert.throws(
    () =>
      assertSafeCafeteriaSeedTarget(
        env({
          GCLOUD_PROJECT: 'campus-one-tw',
          ALLOW_PRODUCTION_SEED: '1',
          FORCE: '1',
          FORCE_SEED: 'true',
          I_UNDERSTAND: 'yes',
        }),
      ),
    /campus-one-tw/,
  );
});

test('the CLI stops before writing when the target is production', () => {
  const result = run({
    NODE_ENV: 'production',
    GCLOUD_PROJECT: 'campus-one-tw',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    ALLOW_PRODUCTION_SEED: '1',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /拒絕寫入正式資料庫/);
  assert.doesNotMatch(result.stdout + result.stderr, /DONE|Using Firestore|✔ cafeteria/);
});

test('the CLI stops when only a service account is pointed at a cloud project', () => {
  const result = run({
    FIRESTORE_EMULATOR_HOST: '',
    NODE_ENV: 'development',
    GCLOUD_PROJECT: 'campus-demo-3a869',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/sa.json',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /沒有本機模擬器/);
  assert.doesNotMatch(result.stdout + result.stderr, /DONE|Using service account|✔ cafeteria/);
});
