'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { classify, inventory } = require('./audit-group-post-visibility.cjs');

const record = (id, data) => ({ path: 'groups/synthetic/posts/' + id, data });

test('inventory separates explicit visible, hidden and ambiguous legacy posts without exposing content', () => {
  const rows = [
    record('visible', { published: true, status: 'published', deleted: false, deletedAt: null, authorId: 'PRIVATE' }),
    record('draft', { published: false, status: 'draft', title: 'PRIVATE TITLE' }),
    record('archived', { published: true, status: 'archived', deleted: false, deletedAt: null }),
    record('legacy', { title: 'PRIVATE LEGACY' }),
    record('conflict', { published: true, status: 'published', deleted: false, deletedAt: new Date().toISOString() }),
  ];
  const summary = inventory(rows.map((r) => JSON.stringify(r)).join('\n'));
  assert.deepEqual(summary, { total: 5, canonicalVisible: 1, hidden: 3, reviewRequired: 1 });
  assert.equal(JSON.stringify(summary).includes('PRIVATE'), false);
});

test('unknown status, missing deletion flags, and partial metadata cannot be auto-published', () => {
  for (const data of [
    { published: true, status: 'unknown', deleted: false, deletedAt: null },
    { published: true, status: 'published', deletedAt: null },
    { published: true, status: 'published', deleted: false },
    { published: true, status: 'published', deleted: 'false', deletedAt: null },
  ]) assert.equal(classify(record('ambiguous', data)), 'reviewRequired');
});

test('rejects invalid source paths and malformed input', () => {
  assert.throws(() => classify({ path: 'users/test', data: {} }));
  assert.throws(() => classify({ path: 'groups/a/posts/b', data: null }));
  assert.throws(() => inventory('{oops'), /Invalid NDJSON record/);
});

test('duplicate paths reject inconsistent export counts instead of double-counting', () => {
  const first = record('same', { published: true, status: 'published', deleted: false, deletedAt: null });
  const second = record('same', { published: false, status: 'draft' });
  assert.throws(() => inventory([first, second].map(JSON.stringify).join('\n')), /Duplicate group post record/);
  assert.deepEqual(inventory([first, record('other', {})].map(JSON.stringify).join('\n')),
    { total: 2, canonicalVisible: 1, hidden: 0, reviewRequired: 1 });
});

test('invalid JSON cannot echo sensitive source text in CLI errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'post-visibility-'));
  const filepath = path.join(root, 'synthetic.ndjson');
  const secret = 'PRIVATE-STUDENT-RECORD-123';
  try {
    fs.writeFileSync(filepath, '{"title":"' + secret + '", BROKEN JSON\n');
    const run = spawnSync(process.execPath,
      [path.join(__dirname, 'audit-group-post-visibility.cjs'), filepath],
      { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /Invalid NDJSON record/);
    assert.equal(run.stderr.includes(secret), false);
    assert.equal(run.stderr.includes('BROKEN JSON'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded input rejects oversized direct inventory even without CLI', () => {
  assert.throws(() => inventory(' '.repeat(32 * 1024 * 1024 + 1)), /within 32 MiB/);
  assert.throws(() => inventory(null), /must be UTF-8 text/);
});
