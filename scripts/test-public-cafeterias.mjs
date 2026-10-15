#!/usr/bin/env node
import { mkdtempSync, cpSync, mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'public-cafeteria-test-'));
let status = 1;
try {
  const deps = resolve(process.env.PUBLIC_CAFETERIA_TEST_DEPS || join(root, 'node_modules'));
  for (const dependency of ['fastify', 'pg']) {
    if (!existsSync(join(deps, dependency))) {
      throw new Error(
        `Missing ${dependency}; set PUBLIC_CAFETERIA_TEST_DEPS to the test dependencies directory`,
      );
    }
  }
  if (!process.env.PUBLIC_CAFETERIA_TEST_DATABASE_URL) {
    throw new Error(
      'PUBLIC_CAFETERIA_TEST_DATABASE_URL must point to an isolated PostgreSQL test database',
    );
  }
  symlinkSync(deps, join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, 'src'));
  for (const path of [
    'packages/shared/src/cafeteriaCatalog.ts',
    'packages/shared/src/merchantMode.ts',
    'deploy/nuni-api/public-cafeterias/service.ts',
    'deploy/nuni-api/public-cafeterias/routes.ts',
  ]) {
    cpSync(join(root, path), join(dir, 'src', path.split('/').pop()));
  }
  const typeRoots = process.env.PUBLIC_CAFETERIA_TEST_TYPE_ROOTS || join(deps, '@types');
  const args = [
    join(dir, 'src/cafeteriaCatalog.ts'),
    join(dir, 'src/merchantMode.ts'),
    join(dir, 'src/service.ts'),
    join(dir, 'src/routes.ts'),
    '--strict',
    '--exactOptionalPropertyTypes',
    '--noUncheckedIndexedAccess',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--skipLibCheck',
    '--outDir',
    join(dir, 'out'),
    '--typeRoots',
    typeRoots,
    '--types',
    'node',
  ];
  const compiler =
    process.env.PUBLIC_CAFETERIA_TEST_TSC ||
    [
      join(deps, '.bin/tsc'),
      join(root, 'node_modules/.bin/tsc'),
      join(root, 'packages/shared/node_modules/typescript/bin/tsc'),
      join(root, 'apps/web/node_modules/typescript/bin/tsc'),
    ].find((path) => existsSync(path)) ||
    'tsc';
  const compiled = spawnSync(compiler, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(deps ? { NODE_PATH: [deps, process.env.NODE_PATH].filter(Boolean).join(':') } : {}),
    },
  });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw new Error('Public cafeteria TypeScript compilation failed');
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      'scripts/public-cafeterias/policy.test.cjs',
      'scripts/public-cafeterias/routes.test.cjs',
      'scripts/public-cafeterias/postgres.test.cjs',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_CAFETERIA_COMPILED: join(dir, 'out'),
        ...(deps ? { NODE_PATH: [deps, process.env.NODE_PATH].filter(Boolean).join(':') } : {}),
      },
    },
  );
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = status;
