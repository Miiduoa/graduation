import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folder = join(root, 'deploy/nuni-api/platform-public-agent');
const manifest = JSON.parse(readFileSync(join(folder, 'production-source-security.json'), 'utf8'));
const patch = readFileSync(join(folder, manifest.patch), 'utf8');

test('source patch is pinned, excludes migrations, and matches reviewed agent modules', () => {
  assert.equal(manifest.baseTree, 'add9614a93c65b4587ca5649a83803614c786f28');
  assert.equal(manifest.resultTree, 'e51d9c556093c3570aaaab6804086b63a1e8db3d');
  assert.equal(manifest.migration, null);
  assert.equal(manifest.providerWired, false);
  assert.equal(createHash('sha256').update(patch).digest('hex'), manifest.sha256);
  const sourceFiles = readdirSync(folder)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const expected = ['app.ts', ...sourceFiles, 'providenceCampus.ts'].sort();
  const sections = patch.split(/^diff --git /mu).slice(1);
  const files = sections.map((section) => section.match(/^a\/apps\/api\/src\/(\S+) b\//u)?.[1]);
  assert.deepEqual(
    files.map((file) => file?.replace('platform-public-agent/', '')).sort(),
    expected,
  );
  assert.match(sections[0], /hostAllowsPublicTask/u);
  assert.match(sections[0], /installPublicTaskHost/u);
  for (const section of sections.slice(1)) {
    const filename = section.match(/^a\/apps\/api\/src\/platform-public-agent\/(\S+) b\//u)?.[1];
    assert.ok(filename);
    assert.match(section, /^new file mode /mu);
    const source =
      filename === 'providenceCampus.ts'
        ? join(root, 'packages/shared/src/providenceCampus.ts')
        : join(folder, filename);
    const lines = section.split('\n');
    const hunk = lines.findIndex((line) => line.startsWith('@@ '));
    assert.ok(hunk >= 0);
    const content = `${lines
      .slice(hunk + 1)
      .filter((line) => line.startsWith('+'))
      .map((line) => line.slice(1))
      .join('\n')}\n`;
    assert.equal(content, readFileSync(source, 'utf8'), filename);
  }
});
