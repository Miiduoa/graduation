import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));
const pinnedFixture = join(root, 'fixtures/pinned-app-path-routes-manifest.json');
const image = manifest.imageTag;

function docker(...args) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function imageExists() {
  return docker('image', 'inspect', image, '--format', '{{.Id}}').status === 0;
}

function productRoutes(manifestObj) {
  return Object.values(manifestObj)
    .filter((route) => typeof route === 'string')
    .filter((route) => !route.startsWith('/_') && route !== '/sitemap.xml' && route !== '/icon')
    .sort();
}

test('pinned fixture records exact product route set from the live legacy stage', () => {
  assert.equal(existsSync(pinnedFixture), true, 'checked-in pinned fixture must exist');
  const routes = JSON.parse(readFileSync(pinnedFixture, 'utf8'));
  const values = Object.values(routes);
  assert.equal(values.length, 131);
  for (const required of [
    '/auth/account',
    '/auth/account/token',
    '/auth/account/callback',
    '/auth/logout',
    '/auth/session',
    '/privacy',
    '/terms',
    '/support',
  ]) {
    assert.ok(values.includes(required), required);
  }
  assert.equal(manifest.rollbackLegacyBuildId, 'xVY40D5clmp9Yz0poHPFw');
});

test('rebuilt image app-path-routes-manifest matches pinned fixture product routes exactly', (t) => {
  if (!imageExists()) {
    t.skip(`local image ${image} not built yet — not a pass`);
    return;
  }
  const extractDir = mkdtempSync(join(tmpdir(), 'nuni-legacy-routes-'));
  try {
    const copied = docker(
      'run',
      '--rm',
      '--platform',
      'linux/amd64',
      '--entrypoint',
      'cat',
      image,
      '/app/apps/web/.next/app-path-routes-manifest.json',
    );
    assert.equal(copied.status, 0, copied.stderr);
    const rebuiltPath = join(extractDir, 'app-path-routes-manifest.json');
    writeFileSync(rebuiltPath, copied.stdout);
    const pinned = JSON.parse(readFileSync(pinnedFixture, 'utf8'));
    const rebuilt = JSON.parse(copied.stdout);
    const pinnedProduct = productRoutes(pinned);
    const rebuiltProduct = productRoutes(rebuilt);
    // Exact product-route parity with the frozen live-stage fixture (not a
    // vacuous subset). Next internals may differ after the 16.4.2 rebuild.
    assert.deepEqual(rebuiltProduct, pinnedProduct);
    assert.ok(pinnedProduct.length >= 120, `expected dense product route set, got ${pinnedProduct.length}`);
    const digest = createHash('sha256').update(JSON.stringify(rebuiltProduct)).digest('hex');
    assert.equal(digest.length, 64);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
});
