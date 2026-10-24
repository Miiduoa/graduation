import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('source.json binds production tree b0a10ac, rollback digest, and patch checksums', () => {
  assert.equal(manifest.productionTree, 'b0a10ac814cd03fbfb45132566035acce8339f17');
  assert.equal(manifest.baseCommit, '9de47b4b3492325e430562c37bcad552867162db');
  assert.equal(manifest.candidateTree, 'd006ec857bd1b5be5b0281c94077d61f9af51d05');
  assert.equal(
    manifest.rollbackImage,
    'registry.fly.io/nuni-api@sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2',
  );
  assert.equal(manifest.imageTag, 'nuni-api-security:20261024');
  assert.equal(manifest.platform, 'linux/amd64');
  assert.equal(
    manifest.runtimeNodeImage,
    'node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53',
  );
  assert.equal(manifest.patchedVersions.fastify, '5.12.7');
  assert.equal(manifest.patchedVersions.zod, '4.6.7');
  assert.equal(manifest.patchedVersions['@grpc/grpc-js'], '1.14.5');
  assert.equal(manifest.patchedVersions['brace-expansion'], '5.0.12');
  assert.equal(manifest.runtimeGrantInventory.sourceHash, manifest.productionTree);
  assert.equal(manifest.patches.length, 2);
  for (const patch of manifest.patches) {
    assert.equal(sha256(join(root, 'patches', patch.file)), patch.sha256, patch.file);
  }
  assert.match(manifest.sourceBinding.certainty, /proven/);
});

test('security patches mention patched pins and forbid vulnerable runtime versions', () => {
  const depPatch = readFileSync(join(root, 'patches/0001-runtime-deps-security.patch'), 'utf8');
  assert.match(depPatch, /fastify@5\.12\.7|"fastify": "5\.12\.7"/);
  assert.match(depPatch, /zod@4\.6\.7|"zod": "4\.6\.7"/);
  assert.match(depPatch, /brace-expansion": "5\.0\.12"|brace-expansion: 5\.0\.12/);
  assert.match(depPatch, /@grpc\/grpc-js": "1\.14\.5"|'@grpc\/grpc-js': 1\.14\.5/);
  assert.match(depPatch, /fast-uri": "3\.1\.9"|fast-uri: 3\.1\.9/);
  assert.match(depPatch, /fast-uri": "4\.2\.3"|fast-uri: 4\.2\.3/);
  assert.match(depPatch, /24\.22\.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53/);
  assert.match(depPatch, /ca-certificates>=20261020-r0/);
  assert.doesNotMatch(depPatch, /npm install --force|pnpm add --force|forced runtime install/i);
  for (const bad of manifest.forbiddenVulnerableVersions) {
    // Removals (-) of vulnerable pins are expected; additions (+) must not reintroduce them.
    const added = depPatch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');
    assert.doesNotMatch(added, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('prepare.py materializes candidate tree when local archived source is available', (t) => {
  const source = process.env.NUNI_API_SECURITY_SOURCE;
  if (!source || !existsSync(join(source, '.git'))) {
    t.skip('NUNI_API_SECURITY_SOURCE not set');
    return;
  }
  const result = spawnSync(
    'python3',
    [join(root, 'prepare.py'), '--source', source, '--skip-docker', '--print-plan'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.candidateTree, manifest.candidateTree);
  assert.equal(plan.productionTree, manifest.productionTree);
  assert.equal(plan.imageTag, manifest.imageTag);
  assert.equal(plan.deploys, false);
  assert.equal(plan.runsMigrations, false);
});
