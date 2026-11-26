import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { policy, SELF } from './gate.mjs';

const root = new URL('../../', import.meta.url);
function blob(path) {
  const content = readFileSync(new URL(path, root));
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

test('reviewed workflow pins match the complete committed workflow inventory', () => {
  const paths = readdirSync(new URL('.github/workflows/', root), { withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => `.github/workflows/${entry.name}`);
  assert.deepEqual(paths.filter(path => !SELF.includes(path)).sort(), Object.keys(policy.workflowBlobs).sort(),
    'A changed workflow inventory requires an explicit policy review');
  for (const path of SELF) assert.ok(paths.includes(path), `Missing gate workflow: ${path}`);
  for (const [path, sha] of Object.entries(policy.workflowBlobs)) {
    assert.equal(blob(path), sha, `Reviewed workflow content drifted: ${path}`);
  }
});

test('reviewed evidence script pins match the actual classifier and report validator', () => {
  for (const [path, sha] of Object.entries(policy.evidenceScriptBlobs)) {
    assert.equal(blob(path), sha, `Reviewed evidence script drifted: ${path}`);
  }
});
