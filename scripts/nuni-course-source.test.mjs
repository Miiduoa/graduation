import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertPinnedNuniSource } from './lib/nuni-course-source.mjs';

function fixture(t) {
  const source = mkdtempSync(path.join(os.tmpdir(), 'nuni-course-source-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  const put = (relative, body = 'SELECT 1;\n') => {
    const file = path.join(source, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  git('init', '--quiet');
  put('.gitignore', 'node_modules/\n*.local.sql\n');
  put('apps/api/src/migrations/002_learning.sql');
  put('apps/api/src/app.ts', 'export const app = true;\n');
  put('packages/contracts/src/index.ts', 'export const contract = true;\n');
  git('add', '.');
  const tree = git('write-tree').trim();
  return { source, git, put, tree };
}

test('accepts an exact staged reconstruction with installed dependencies outside source', (t) => {
  const { source, put, tree } = fixture(t);
  put('node_modules/test-package/index.js', 'module.exports = {};\n');
  put('apps/api/node_modules/pg/package.json', '{}\n');
  assert.equal(assertPinnedNuniSource(source, tree), tree);
});

test('rejects an unstaged change to a pinned runtime file', (t) => {
  const { source, put, tree } = fixture(t);
  put('apps/api/src/app.ts', 'export const changed = true;\n');
  assert.throws(() => assertPinnedNuniSource(source, tree));
});

test('rejects a staged change to the pinned tree', (t) => {
  const { source, put, tree, git } = fixture(t);
  put('apps/api/src/app.ts', 'export const changed = true;\n');
  git('add', '.');
  assert.throws(() => assertPinnedNuniSource(source, tree), /pinned, reconstructed API tree/);
});

for (const relative of [
  'apps/api/src/migrations/999_untracked.sql',
  'apps/api/src/migrations/999_ignored.local.sql',
  'apps/api/src/app.js',
  'packages/contracts/src/index.js',
  'apps/api/src/node_modules/pg/index.js',
]) {
  test(`rejects runtime input missing from the pinned tree: ${relative}`, (t) => {
    const { source, put, tree, git } = fixture(t);
    put(relative);
    // Both former checks still succeed: this extra runtime input is absent from Git's index.
    git('diff', '--quiet');
    assert.equal(git('write-tree').trim(), tree);
    assert.throws(() => assertPinnedNuniSource(source, tree), /Untracked runtime source/);
  });
}
