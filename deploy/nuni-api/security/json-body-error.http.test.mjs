// Focused HTTP inject runner for the 0002 JSON body parser fix.
// Requires a materialized security candidate checkout with frozen deps installed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));

function resolveSource() {
  const args = process.argv.slice(2);
  if (args.includes('--source')) return args[args.indexOf('--source') + 1];
  return process.env.NUNI_API_JSON_ERROR_SOURCE || process.env.NUNI_API_SECURITY_SOURCE;
}

test('focused vitest json-body-parser-errors HTTP inject contracts', (t) => {
  const source = resolveSource();
  if (!source || !existsSync(join(source, 'apps/api/src/json-body-parser-errors.test.ts'))) {
    t.skip('materialized candidate source with 0002 test not set');
    return;
  }
  const tree = spawnSync('git', ['write-tree'], { cwd: source, encoding: 'utf8' });
  assert.equal(tree.status, 0, tree.stderr);
  assert.equal(tree.stdout.trim(), manifest.candidateTree, 'Only the JSON-fixed security candidate may run');
  const vitestCandidates = [
    join(source, 'apps/api/node_modules/.bin/vitest'),
    join(source, 'node_modules/.bin/vitest'),
  ];
  const vitest = vitestCandidates.find((path) => existsSync(path));
  assert.ok(vitest, `Install frozen deps in ${source} before running`);
  const result = spawnSync(
    vitest,
    ['run', '--maxWorkers=1', 'src/json-body-parser-errors.test.ts'],
    {
      cwd: join(source, 'apps/api'),
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH },
    },
  );
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'json-body-parser-errors vitest must pass without weakening expectations');
});
