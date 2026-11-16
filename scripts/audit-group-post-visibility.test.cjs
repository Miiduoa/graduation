'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
  assert.throws(() => inventory('{oops'), SyntaxError);
});
