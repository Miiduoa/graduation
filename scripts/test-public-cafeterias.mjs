#!/usr/bin/env node
import { mkdtempSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'public-cafeteria-test-'));
let status = 1;
try {
  mkdirSync(join(dir, 'src'));
  for (const path of [
    'packages/shared/src/cafeteriaCatalog.ts',
    'packages/shared/src/merchantMode.ts',
    'deploy/nuni-api/public-cafeterias/service.ts',
  ]) {
    cpSync(join(root, path), join(dir, 'src', path.split('/').pop()));
  }
  const typeRoots = process.env.PUBLIC_CAFETERIA_TEST_TYPE_ROOTS;
  const args = [
    join(dir, 'src/cafeteriaCatalog.ts'),
    join(dir, 'src/merchantMode.ts'),
    join(dir, 'src/service.ts'),
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--skipLibCheck',
    '--outDir',
    join(dir, 'out'),
    ...(typeRoots ? ['--typeRoots', typeRoots, '--types', 'node'] : []),
  ];
  const compiler =
    process.env.PUBLIC_CAFETERIA_TEST_TSC ||
    [
      join(root, 'node_modules/.bin/tsc'),
      join(root, 'packages/shared/node_modules/typescript/bin/tsc'),
      join(root, 'apps/web/node_modules/typescript/bin/tsc'),
    ].find((path) => existsSync(path)) ||
    'tsc';
  const compiled = spawnSync(compiler, args, { cwd: root, stdio: 'inherit' });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw new Error('Public cafeteria TypeScript compilation failed');
  if (process.env.PUBLIC_CAFETERIA_TEST_DEPS && !existsSync(join(process.env.PUBLIC_CAFETERIA_TEST_DEPS, 'pg'))) {
    throw new Error('PostgreSQL test dependency is missing');
  }
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      'scripts/public-cafeterias/policy.test.cjs',
      'scripts/public-cafeterias/postgres.test.cjs',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PUBLIC_CAFETERIA_COMPILED: join(dir, 'out') },
    },
  );
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = status;
