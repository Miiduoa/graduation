#!/usr/bin/env node
import { mkdtempSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'course-access-test-'));
let status = 1;
try {
  mkdirSync(join(dir, 'src'));
  for (const path of ['packages/shared/src/courseAccess.ts', 'packages/shared/src/courseAccessClient.ts', 'deploy/nuni-api/course-access/service.ts'])
    cpSync(join(root, path), join(dir, 'src', path.split('/').pop()));
  const typeRoots = process.env.COURSE_TEST_TYPE_ROOTS;
  const args = [join(dir, 'src/courseAccess.ts'), join(dir, 'src/courseAccessClient.ts'), join(dir, 'src/service.ts'),
    '--strict', '--target', 'ES2022', '--module', 'commonjs', '--skipLibCheck', '--outDir', join(dir, 'out'),
    ...(typeRoots ? ['--typeRoots', typeRoots, '--types', 'node'] : [])];
  const compiler = process.env.COURSE_TEST_TSC || 'tsc';
  const compiled = spawnSync(compiler, args, { cwd: root, stdio: 'inherit' });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) throw new Error('Course access TypeScript compilation failed');
  if (process.env.COURSE_TEST_DEPS && !existsSync(join(process.env.COURSE_TEST_DEPS, 'pg')))
    throw new Error('PostgreSQL test dependency is missing');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/course-access/policy.test.cjs', 'scripts/course-access/postgres.test.cjs'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, COURSE_COMPILED: join(dir, 'out') } });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
process.exitCode = status;
