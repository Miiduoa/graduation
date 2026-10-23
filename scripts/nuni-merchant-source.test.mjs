import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertFoodOrderingSource, loadFoodOrderingCandidate } from './nuni-merchant-source.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const candidateFile = 'deploy/nuni-api/food-ordering/source.json';
const manifest = JSON.parse(readFileSync(path.join(repository, candidateFile), 'utf8'));

test('food candidate preserves the production base and adds the two order access patches', async () => {
  const candidate = await loadFoodOrderingCandidate(repository);
  const deployed = JSON.parse(
    readFileSync(path.join(repository, 'deploy/nuni-api/source.json'), 'utf8'),
  );
  assert.equal(candidate.repository, deployed.repository);
  assert.equal(candidate.baseCommit, deployed.baseCommit);
  assert.deepEqual(candidate.patches.slice(0, 4), deployed.patches);
  assert.equal(candidate.patches.length, 6);
  assert.notEqual(candidate.candidateTree, deployed.candidateTree);
});

test('a four- or five-patch manifest cannot qualify as the food candidate', () => {
  for (const count of [4, 5]) {
    assert.throws(
      () =>
        assertFoodOrderingSource('/must-not-read-source', {
          ...manifest,
          patches: manifest.patches.slice(0, count),
        }),
      /Food acceptance requires all six reviewed patches in order/,
    );
  }
});

test('even a six-patch manifest rejects a checkout before the last two patches are applied', (t) => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'nuni-merchant-tree-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  git('init', '--quiet');
  mkdirSync(path.join(source, 'apps/api/src'), { recursive: true });
  const app = path.join(source, 'apps/api/src/app.ts');
  writeFileSync(app, 'export const routes = ["public-realms"];\n');
  git('add', '.');
  const four = git('write-tree').trim();
  writeFileSync(app, 'export const routes = ["public-realms", "existing-order-actor"];\n');
  git('add', '.');
  const five = git('write-tree').trim();
  writeFileSync(
    app,
    'export const routes = ["public-realms", "existing-order-actor", "food-order-realms"];\n',
  );
  git('add', '.');
  const six = git('write-tree').trim();
  const candidate = { ...manifest, candidateTree: six };
  for (const tree of [four, five]) {
    git('read-tree', '--reset', '-u', tree);
    assert.throws(
      () => assertFoodOrderingSource(source, candidate),
      /Only the pinned, reconstructed API tree may run/,
    );
  }
  git('read-tree', '--reset', '-u', six);
  assert.equal(assertFoodOrderingSource(source, candidate), six);
});

test('tampering with a reviewed food patch fails before the source can run', async (t) => {
  const copy = mkdtempSync(path.join(os.tmpdir(), 'nuni-merchant-manifest-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  const deployment = path.join(copy, 'deploy/nuni-api');
  mkdirSync(path.join(deployment, 'food-ordering'), { recursive: true });
  cpSync(path.join(repository, candidateFile), path.join(deployment, 'food-ordering/source.json'));
  cpSync(path.join(repository, 'deploy/nuni-api/patches'), path.join(deployment, 'patches'), {
    recursive: true,
  });
  writeFileSync(path.join(deployment, 'patches/0006-food-order-realms.patch'), 'tampered\n');
  await assert.rejects(
    loadFoodOrderingCandidate(copy),
    /Food candidate patch checksum mismatch: 0006/,
  );
});
