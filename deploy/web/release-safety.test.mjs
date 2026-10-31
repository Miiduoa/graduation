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

// Web 的校務讀取共用這些純來源檔，不應把整個 Functions 部署內容帶進映像。
const schoolReaderSources = [
  'backend/functions/puScraper.js',
  'backend/functions/tronClassScraper.js',
  'backend/functions/lib/puGradeDocument.js',
  'backend/functions/lib/puCreditSummary.js',
  'backend/functions/lib/puCourseTime.js',
  'backend/functions/lib/taipeiDay.js',
  'backend/functions/lib/puSessionStore.js',
  'backend/functions/lib/puCampusTransport.js',
  'backend/functions/lib/ecampusFetchPause.js',
];
const schoolReaderDirectories = ['backend/', 'backend/functions/', 'backend/functions/lib/'];

for (const recipe of ['Dockerfile', 'Dockerfile.nuni']) {
  test(`school-reader packaging: ${recipe} supplies only the required backend sources before building`, () => {
    const source = read(`deploy/web/${recipe}`);
    const buildStart = source.indexOf('FROM base AS build');
    const buildEnd = source.indexOf('FROM base AS runtime');
    assert.ok(buildStart >= 0 && buildEnd > buildStart, 'build and runtime must remain separate');
    const build = source.slice(buildStart, buildEnd);
    const compileAt = build.indexOf('RUN pnpm --filter web build');
    assert.ok(compileAt >= 0, 'the production build must remain enabled');
    const copied = [];
    for (const match of source.matchAll(/^COPY\s+(.+)$/gm)) {
      const parts = match[1].trim().split(/\s+/);
      const sources = parts.slice(0, -1).filter((part) => !part.startsWith('--'));
      const backend = sources.filter((part) => part.startsWith('backend/'));
      if (!backend.length) continue;
      assert.ok(match.index > buildStart && match.index < buildStart + compileAt,
        'school sources belong before compilation, not in the runtime stage');
      for (const path of backend) {
        assert.ok(schoolReaderSources.includes(path), `unexpected backend copy: ${path}`);
        assert.equal(parts.at(-1), `./${dirname(path)}/`, `source layout changed: ${path}`);
        copied.push(path);
      }
    }
    assert.deepEqual(copied.sort(), [...schoolReaderSources].sort(), 'missing or duplicate school source');
    assert.doesNotMatch(source, /^COPY\s+(?:\.\s|backend\/?\s|backend\/functions\/?\s)/m);
    assert.match(source, /^USER node$/m, 'runtime must remain unprivileged');
  });

  test(`school-reader packaging: ${recipe} context retains its exact allowlist and credential exclusions`, () => {
    const lines = read(`deploy/web/${recipe}.dockerignore`).split(/\r?\n/)
      .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    assert.equal(lines[0], '**', 'context must start denied');
    const backend = lines.filter((line) => line.startsWith('!backend'));
    assert.deepEqual(backend.sort(), [...schoolReaderDirectories, ...schoolReaderSources]
      .map((path) => `!${path}`).sort(), 'do not broaden the backend context');
    const lastInclude = Math.max(...lines.map((line, index) => line.startsWith('!') ? index : -1));
    for (const pattern of ['**/node_modules', '**/.next', '**/.env', '**/.env.*',
      '**/coverage', '**/*.tsbuildinfo', '**/*serviceAccount*.json', '**/*.pem', '**/*.key']) {
      assert.ok(lines.lastIndexOf(pattern) > lastInclude, `credential/build exclusion must win: ${pattern}`);
    }
  });
}
