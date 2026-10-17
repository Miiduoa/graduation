import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertPinnedNuniSource } from './lib/nuni-course-source.mjs';

const requiredPatches = [
  '0001-platform-admin-and-public-social.patch',
  '0002-runtime-grant-inventory.patch',
  '0003-social-schema-installation.patch',
  '0004-existing-platform-personas.patch',
  '0005-existing-food-order-access.patch',
  '0006-food-order-realms.patch',
];

export function assertFoodOrderingSource(source, manifest) {
  assert.deepEqual(
    manifest.patches.map((patch) => patch.file),
    requiredPatches,
    'Food acceptance requires all six reviewed patches in order',
  );
  return assertPinnedNuniSource(source, manifest.candidateTree);
}

export async function loadFoodOrderingCandidate(repository) {
  const deployment = path.join(repository, 'deploy/nuni-api');
  const manifest = JSON.parse(
    await readFile(path.join(deployment, 'food-ordering/source.json'), 'utf8'),
  );
  assert.deepEqual(
    manifest.patches.map((patch) => patch.file),
    requiredPatches,
    'Food acceptance requires all six reviewed patches in order',
  );
  for (const patch of manifest.patches) {
    const bytes = await readFile(path.join(deployment, 'patches', patch.file));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      patch.sha256,
      `Food candidate patch checksum mismatch: ${patch.file}`,
    );
  }
  return manifest;
}
