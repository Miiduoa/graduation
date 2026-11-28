import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/preview-deploy.yml', import.meta.url),
  'utf8',
);
const publish = workflow.split('      - name: Publish EAS Update\n')[1]
  ?.split('\n      - name: ')[0] ?? '';

test('preview publication passes PR metadata via the environment, not shell source', () => {
  assert.match(publish, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(publish, /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
  const run = publish.match(/        run: \|\n([\s\S]*?)\n        env:/)?.[1];
  assert.ok(run, 'Expected the preview publish shell block');
  assert.doesNotMatch(run, /\$\{\{/);
  // A local shell function captures arguments; no CLI, network or credentials.
  const title = 'Preview "quoted" $(printf SHOULD_NOT_EXPAND) `literal` ; &';
  const result = spawnSync('bash', ['-e', '-c', 'npx() { printf "%s\\0" "$@"; }\n' + run], {
    encoding: 'utf8',
    env: { ...process.env, PR_NUMBER: '42', PR_TITLE: title },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.split('\0').slice(0, -1), [
    'eas-cli', 'update', '--branch', 'pr-42', '--message', 'PR #42: ' + title,
    '--non-interactive',
  ]);
});
