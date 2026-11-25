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
  for (const outDir of [root, path.join(root, 'backend/firestore')]) {
    assert.throws(() => prepareTronClassTtlProfile({ outDir }), /outside the repository/);
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
  try {
    const alias = path.join(parent, 'repo-link');
    fs.symlinkSync(root, alias, 'dir');
    assert.throws(() => prepareTronClassTtlProfile({ outDir: path.join(alias, 'profile') }), /outside the repository/);
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

test('rejects output under a parent owned by another user', () => {
  const uid = process.getuid();
  const fixture = uid === 0 ? fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-foreign-')) : null;
  try {
    if (fixture) fs.chownSync(fixture, 65534, -1);
    const parent = fixture ?? '/';
    assert.notEqual(fs.statSync(parent).uid, uid);
    assert.throws(() => prepareTronClassTtlProfile({ outDir: path.join(parent, 'ttl-profile') }), /controlled by the current user/);
  } finally {
    if (fixture) fs.rmdirSync(fixture);
  }
});
