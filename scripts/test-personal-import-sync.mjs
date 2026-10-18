#!/usr/bin/env node
import { mkdtempSync, cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'personal-import-sync-test-'));
let status = 1;
try {
  mkdirSync(join(dir, 'src/imports'), { recursive: true });
  mkdirSync(join(dir, 'src/timetable'));
  cpSync(
    join(root, 'deploy/nuni-api/personal-import-sync/service.ts'),
    join(dir, 'src/service.ts'),
  );
  for (const name of ['sync', 'backup', 'records', 'validation', 'types'])
    cpSync(
      join(root, `packages/shared/src/imports/${name}.ts`),
      join(dir, `src/imports/${name}.ts`),
    );
  for (const name of ['periods', 'schoolPeriods'])
    cpSync(
      join(root, `packages/shared/src/timetable/${name}.ts`),
      join(dir, `src/timetable/${name}.ts`),
    );
  const typeRoots = process.env.IMPORT_SYNC_TEST_TYPE_ROOTS;
  const args = [
    join(dir, 'src/service.ts'),
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--noUncheckedIndexedAccess',
    '--exactOptionalPropertyTypes',
    '--skipLibCheck',
    '--outDir',
    join(dir, 'out'),
    ...(typeRoots ? ['--typeRoots', typeRoots, '--types', 'node'] : []),
  ];
  const compiled = spawnSync(process.env.IMPORT_SYNC_TEST_TSC || 'tsc', args, {
    cwd: dir,
    stdio: 'inherit',
  });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw new Error('Personal import sync TypeScript compilation failed');
  const require = createRequire(import.meta.url);
  const ts = require(
    process.env.IMPORT_SYNC_TEST_DEPS
      ? join(process.env.IMPORT_SYNC_TEST_DEPS, 'typescript')
      : 'typescript',
  );
  const routeSource = readFileSync(
    join(root, 'deploy/nuni-api/personal-import-sync/routes.ts'),
    'utf8',
  );
  writeFileSync(
    join(dir, 'out/routes.js'),
    ts.transpileModule(routeSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
  );
  // The private API's DomainError contract. Full source typechecking is a separate release gate.
  writeFileSync(
    join(dir, 'domain-error.js'),
    'exports.DomainError = class DomainError extends Error { constructor(code,message,statusCode) { super(message); this.name="DomainError"; this.code=code; this.statusCode=statusCode; } };',
  );
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', 'scripts/personal-import-sync/postgres.test.cjs'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, IMPORT_SYNC_COMPILED: join(dir, 'out') },
    },
  );
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = status;
