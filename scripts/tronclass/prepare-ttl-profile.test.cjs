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
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-test-'));
  const original = fs.readFileSync(path.join(root, 'backend/firestore/firestore.indexes.json'), 'utf8');
  const base = loadDeployment(path.join(root, 'firebase.json'));
  try {
    const result = prepareTronClassTtlProfile({ outDir });
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
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('refuses implicit output and any attempt to replace a checked-in configuration', () => {
  for (const outDir of [undefined, '', root, path.join(root, 'backend/firestore')]) {
    assert.throws(() => prepareTronClassTtlProfile({ outDir }), /explicit output|outside the repository/);
  }
});

test('refuses symlinked repository output and never overwrites an existing configuration', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tronclass-ttl-safe-'));
  try {
    const alias = path.join(parent, 'repo-link');
    fs.symlinkSync(root, alias, 'dir');
    assert.throws(() => prepareTronClassTtlProfile({ outDir: alias }), /outside the repository/);
    fs.writeFileSync(path.join(parent, 'firebase.json'), 'existing operator configuration');
    assert.throws(() => prepareTronClassTtlProfile({ outDir: parent }), /empty output directory/);
    assert.equal(fs.readFileSync(path.join(parent, 'firebase.json'), 'utf8'), 'existing operator configuration');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
