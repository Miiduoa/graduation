#!/usr/bin/env node
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'deploy/nuni-api/platform-public-agent');
const tests = join(root, 'scripts/platform-public-agent');
const out = mkdtempSync(join(tmpdir(), 'platform-public-agent-test-'));
try {
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  const sources = readdirSync(source)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(source, name));
  const compiled = spawnSync(
    process.execPath,
    [
      compiler,
      ...sources,
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--types',
      'node',
      '--typeRoots',
      realpathSync(join(root, 'node_modules/@types')),
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--skipLibCheck',
      '--outDir',
      out,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0)
    throw new Error('Platform public admission TypeScript compilation failed');
  const files = readdirSync(tests)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => join(tests, name));
  if (!files.length) throw new Error('No platform public admission tests found');
  // This runner never connects to a database or applies the candidate SQL schema.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PLATFORM_AGENT_COMPILED: out },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
