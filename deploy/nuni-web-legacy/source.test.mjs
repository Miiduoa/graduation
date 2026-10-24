import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('source.json pins rollback digest, Next 16.4.2, sharp/source-map overrides, and patch checksums', () => {
  assert.equal(
    manifest.rollbackLegacyImage,
    'registry.fly.io/nuni-web@sha256:120b9d015a94810d6180bce0af6f03442963fd7fd52c0570235d2f54609c208c',
  );
  assert.equal(manifest.rollbackLegacyNextVersion, '16.2.11');
  assert.equal(manifest.targetNextVersion, '16.4.2');
  assert.equal(manifest.imageTag, 'nuni-legacy-security:20261024');
  assert.equal(manifest.platform, 'linux/amd64');
  assert.equal(manifest.candidateTree, '48f4e7e2d70d0446624b69498680d0749540a3ac');
  assert.deepEqual(manifest.expectedRootOverrides, {
    sharp: '0.35.5',
    'source-map-js': '1.2.2',
  });
  assert.match(manifest.sourceBinding.certainty, /not-label-proven/);
  assert.equal(manifest.patches.length, 2);
  assert.equal(manifest.patches[0].file, '0001-next-16.4.2-security.patch');
  assert.equal(manifest.patches[1].file, '0002-sharp-source-map-js-security.patch');
  for (const patch of manifest.patches) {
    const path = join(root, 'patches', patch.file);
    assert.equal(sha256(path), patch.sha256, patch.file);
  }
  assert.equal(manifest.publicBuildArgs.NEXT_PUBLIC_API_URL, 'https://api.nuni.tw');
  assert.equal(manifest.publicBuildArgs.NEXT_PUBLIC_AUTH_MODE, 'campus-account');
  assert.equal(manifest.publicBuildArgs.NEXT_PUBLIC_PRIVACY_NOTICE_VERSION, 'privacy-notice-2026-09-14');
  for (const value of Object.values(manifest.publicBuildArgs)) {
    assert.doesNotMatch(String(value), /secret|password|private[_-]?key/i);
  }
});

test('Dockerfile pins Node digest and verifies Next/sharp/source-map-js through next require', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, new RegExp(`FROM ${manifest.runtimeNodeImage} AS base`));
  assert.match(dockerfile, /ca-certificates>=20261020-r0/);
  assert.match(dockerfile, /Runtime Next must be 16\.4\.2/);
  assert.match(dockerfile, /Runtime sharp must be 0\.35\.5/);
  assert.match(dockerfile, /source-map-js versions must be exactly \[1\.2\.2\]/);
  assert.match(dockerfile, /createRequire\(serverRequire\.resolve\(["']next["']\)\)/);
  assert.match(dockerfile, /inventoryVersions\(["']source-map-js["']\)/);
  assert.doesNotMatch(dockerfile, /npm install.*sharp|pnpm add.*sharp|forced runtime install/i);
  assert.match(dockerfile, /CMD \["node", "apps\/web\/server\.js"\]/);
  assert.doesNotMatch(dockerfile, /16\.2\.11/);
});

test('build.py materializes candidate tree when local archived source is available', (t) => {
  const source = process.env.NUNI_WEB_LEGACY_SOURCE;
  if (!source || !existsSync(join(source, '.git'))) {
    t.skip('NUNI_WEB_LEGACY_SOURCE not set');
    return;
  }
  const result = spawnSync(
    'python3',
    [join(root, 'build.py'), '--source', source, '--skip-docker'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.candidateTree, manifest.candidateTree);
  assert.equal(plan.baseCommit, manifest.baseCommit);
  assert.deepEqual(plan.patches, [
    '0001-next-16.4.2-security.patch',
    '0002-sharp-source-map-js-security.patch',
  ]);
});
