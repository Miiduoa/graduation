'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareTronClassTtlProfile } = require('./prepare-ttl-profile.cjs');
const { loadDeployment } = require('../wait-for-firestore-indexes.cjs');
const root = path.resolve(__dirname, '../..');

test('optional TTL profile preserves every deployed index and leaves the Spark default untouched', () => {
  const original = fs.readFileSync(path.join(root, 'backend/firestore/firestore.indexes.json'), 'utf8');
  const base = loadDeployment(path.join(root, 'firebase.json'));
  const result = prepareTronClassTtlProfile();
  try {
    assert.equal(path.dirname(result.outDir), fs.realpathSync(os.tmpdir()));
    assertPrivateDirectory(result.outDir);
    assert.equal(path.dirname(result.configPath), result.outDir);
    assert.equal(path.dirname(result.indexPath), result.outDir);
    const prepared = loadDeployment(result.configPath);
    assert.deepEqual(prepared.indexes, base.indexes);
    assert.deepEqual(prepared.fieldOverrides.slice(0, base.fieldOverrides.length), base.fieldOverrides);
    assert.equal(fs.readFileSync(path.join(root, 'backend/firestore/firestore.indexes.json'), 'utf8'), original);
    const policies = prepared.fieldOverrides.filter(field => field.collectionGroup.startsWith('_tronClass'));
    assert.equal(policies.length, 4);
    for (const policy of policies) {
      assert.equal(policy.fieldPath, 'purgeAt');
      assert.equal(policy.ttl, policy.collectionGroup !== '_tronClassSubmissionLocks');
      // The bounded cleanup worker still needs its expiry range query if an
      // operator later enables TTL. Keep that exact ascending collection index.
      assert.deepEqual(policy.indexes, policy.ttl ? [{ order: 'ASCENDING', queryScope: 'COLLECTION' }] : []);
    }
    const config = JSON.parse(fs.readFileSync(result.configPath, 'utf8'));
    assert.deepEqual(Object.keys(config), ['firestore']);
    assert.ok(path.isAbsolute(config.firestore.rules));
    assert.ok(path.isAbsolute(config.firestore.indexes));
  } finally { fs.rmSync(result.outDir, { recursive: true, force: true }); }
});

function assertPrivateDirectory(directory) {
  const stat = fs.statSync(directory);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o7777, 0o700);
}

test('rejects repository output including through an alias', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
  try {
    // Isolate repository containment from the checkout host's ancestor ownership.
    const fixtureRoot = path.join(parent, 'repository');
    for (const relative of ['firebase.json', 'backend/firestore/firestore.indexes.json', 'deploy/tronclass/firestore-ttl-policy.json']) {
      const destination = path.join(fixtureRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, relative), destination);
    }
    for (const outDir of [fixtureRoot, path.join(fixtureRoot, 'backend/firestore')]) {
      assert.throws(() => prepareTronClassTtlProfile({ root: fixtureRoot, outDir }), /outside the repository/);
    }
    const alias = path.join(parent, 'repo-link');
    fs.symlinkSync(fixtureRoot, alias, 'dir');
    assert.throws(() => prepareTronClassTtlProfile({ root: fixtureRoot, outDir: path.join(alias, 'profile') }), /outside the repository/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('creates a fresh explicit private directory and rejects existing output without overwriting files', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
  try {
    const outDir = path.join(parent, 'profile');
    const empty = path.join(parent, 'empty');
    fs.mkdirSync(empty);
    assert.throws(() => prepareTronClassTtlProfile({ outDir: empty }), /already exists/);
    assert.deepEqual(fs.readdirSync(empty), []);
    const result = prepareTronClassTtlProfile({ outDir });
    assert.equal(result.outDir, path.join(fs.realpathSync(parent), 'profile'));
    assertPrivateDirectory(result.outDir);
    for (const file of [result.configPath, result.indexPath]) {
      fs.writeFileSync(file, `existing ${path.basename(file)}`);
    }
    assert.throws(() => prepareTronClassTtlProfile({ outDir }), /already exists/);
    for (const file of [result.configPath, result.indexPath]) {
      assert.equal(fs.readFileSync(file, 'utf8'), `existing ${path.basename(file)}`);
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('accepts a trusted parent alias and preserves the existing parent mode', t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const parent = path.join(workspace, 'parent');
  const alias = path.join(workspace, 'alias');
  fs.mkdirSync(parent);
  fs.chmodSync(parent, 0o755);
  fs.symlinkSync('parent', alias, 'dir');
  const result = prepareTronClassTtlProfile({ outDir: path.join(alias, 'profile') });
  assert.equal(result.outDir, path.join(fs.realpathSync(parent), 'profile'));
  assertPrivateDirectory(result.outDir);
  assert.equal(fs.statSync(parent).mode & 0o7777, 0o755);
});

test('rejects output under a parent owned by another user', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-foreign-'));
  try {
    const uid = process.getuid();
    if (uid === 0) {
      fs.chownSync(fixture, 65534, -1);
    } else {
      const fstat = fs.fstatSync;
      const expected = fs.statSync(fixture, { bigint: true });
      t.mock.method(fs, 'fstatSync', (fd, options) => {
        const stat = fstat(fd, options);
        if (stat.dev === expected.dev && stat.ino === expected.ino) stat.uid = BigInt(uid + 1);
        return stat;
      });
    }
    assert.throws(() => prepareTronClassTtlProfile({ outDir: path.join(fixture, 'ttl-profile') }), /controlled by the current user/);
  } finally {
    fs.rmdirSync(fixture);
  }
});

test('rejects an ancestor where other users can rename entries before creating or changing output', t => {
  const ancestor = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-unsafe-'));
  t.after(() => fs.rmSync(ancestor, { recursive: true, force: true }));
  const parent = path.join(ancestor, 'parent');
  fs.mkdirSync(parent, { mode: 0o755 });
  fs.chmodSync(ancestor, 0o777);
  const mode = fs.statSync(parent).mode;
  const open = fs.openSync;
  const entries = [];
  t.mock.method(fs, 'openSync', (filename, ...options) => {
    if (filename.startsWith('/proc/self/fd/')) entries.push(path.basename(filename));
    return open(filename, ...options);
  });
  for (const method of ['mkdirSync', 'chmodSync', 'writeFileSync']) {
    t.mock.method(fs, method, () => assert.fail(`Unexpected ${method}`));
  }
  assert.throws(() => prepareTronClassTtlProfile({ outDir: path.join(parent, 'profile') }), /controlled by the current user/);
  assert.ok(entries.includes(path.basename(ancestor)));
  assert.ok(!entries.includes(path.basename(parent)));
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.equal(fs.statSync(parent).mode, mode);
});

for (const scenario of ['fresh output', 'existing output', 'unsafe ancestor']) {
  test(`walks the symlink before '..' with ${scenario}`, t => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const parent = path.join(workspace, 'parent');
    const sub = path.join(parent, 'sub');
    const actualOutput = path.join(parent, 'profile');
    const normalizedOutput = path.join(workspace, 'profile');
    fs.mkdirSync(sub, { recursive: true });
    fs.symlinkSync('parent/sub', path.join(workspace, 'link'), 'dir');
    const outDir = `${workspace}/link/../profile`;

    if (scenario === 'fresh output') {
      const result = prepareTronClassTtlProfile({ outDir });
      assert.equal(result.outDir, path.join(fs.realpathSync(parent), 'profile'));
      assertPrivateDirectory(actualOutput);
    } else if (scenario === 'existing output') {
      fs.mkdirSync(actualOutput, { mode: 0o755 });
      const existingFile = path.join(actualOutput, 'firebase.json');
      fs.writeFileSync(existingFile, 'existing');
      const mode = fs.statSync(actualOutput).mode;
      assert.throws(() => prepareTronClassTtlProfile({ outDir }), /already exists/);
      assert.equal(fs.readFileSync(existingFile, 'utf8'), 'existing');
      assert.equal(fs.statSync(actualOutput).mode, mode);
    } else {
      fs.chmodSync(sub, 0o777);
      assert.throws(() => prepareTronClassTtlProfile({ outDir }), /controlled by the current user/);
      assert.equal(fs.existsSync(actualOutput), false);
    }
    assert.equal(fs.existsSync(normalizedOutput), false);
  });
}
