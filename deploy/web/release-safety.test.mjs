import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const forbidden = /neon-migrate|APPLY_SECRETS|firebase deploy|food-ordering-candidate|DATABASE_URL|ONLINE_ORDERING|NEXT_PUBLIC_ONLINE_ORDERING/;

test('Web release does not migrate databases, deploy Firebase, enable ordering, or build the food-ordering candidate', () => {
  const files = {
    workflow: read('.github/workflows/web-release.yml'),
    dockerfile: read('deploy/web/Dockerfile.nuni'),
    fly: read('deploy/web/fly.nuni.toml'),
    start: read('deploy/web/start.cjs'),
    check: read('deploy/web/release-check.mjs'),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.equal(forbidden.test(source), false, `${name} must not enable ordering, migrations, or extra deploys`);
  }
  assert.match(files.workflow, /Restore previous Web image after failed verification/);
  assert.match(files.workflow, /release-check\.mjs rollback/);
  assert.match(files.workflow, /release-check\.mjs smoke/);
  assert.match(files.fly, /app = "nuni-web"/);
  assert.match(files.dockerfile, /CMD \["node", "\/app\/deploy\/web\/start\.cjs"\]/);
  assert.equal(files.dockerfile.includes('entry.js'), false);
});

test('functions package keeps index.js as the upload entry', () => {
  const pkg = JSON.parse(read('backend/functions/package.json'));
  assert.equal(pkg.main, 'index.js');
  assert.equal(read('deploy/functions-server/Dockerfile').includes('CMD ["node", "server.js"]'), true);
  assert.equal(read('deploy/functions-server/fly.toml').includes('ONLINE_ORDERING_ENABLED is intentionally unset'), true);
});

for (const name of ['Dockerfile', 'Dockerfile.nuni']) {
  test(`${name} prepares and ships the same-origin import AI runtime`, () => {
    const dockerfile = read(`deploy/web/${name}`);
    const ignore = read(`deploy/web/${name}.dockerignore`).split(/\r?\n/);
    const prepare = dockerfile.indexOf('COPY scripts/import-ai/ ./scripts/import-ai/');
    const build = dockerfile.indexOf('RUN pnpm --filter web build');
    assert.ok(prepare >= 0 && build > prepare, 'the build must receive its runtime preparation script');
    for (const include of ['!scripts/', '!scripts/import-ai/', '!scripts/import-ai/**']) {
      assert.ok(ignore.includes(include), `build context must include ${include}`);
    }
    assert.match(dockerfile, /COPY --from=build[^\n]*\/build\/apps\/web\/public\/ \.\/apps\/web\/public\//);
    const pkg = JSON.parse(read('apps/web/package.json'));
    assert.match(pkg.scripts.build, /scripts\/import-ai\/prepare-assets\.mjs.*next build/);
  });
}
