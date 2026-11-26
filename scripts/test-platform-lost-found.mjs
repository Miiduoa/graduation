#!/usr/bin/env node
import process from 'node:process';
import { mkdtempSync, cpSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const embedded = process.argv.includes('--embedded');
if (process.argv.slice(2).some(argument => argument !== '--embedded')) throw new Error('Only --embedded is supported');
if (!embedded && !process.env.LOST_FOUND_TEST_DATABASE_URL)
  throw new Error('Pass LOST_FOUND_TEST_DATABASE_URL for an owned loopback database, or --embedded for disposable PGlite');
const directory = mkdtempSync(join(tmpdir(), 'platform-lost-found-test-'));
let status = 1;
try {
  mkdirSync(join(directory, 'src/lost-found'), { recursive: true });
  const sources = {
    'contracts.ts': 'packages/shared/src/nuniLostFound.ts',
    'nuni.ts': 'packages/shared/src/nuni.ts',
    'taipeiTime.ts': 'packages/shared/src/taipeiTime.ts',
    'lostFoundFields.ts': 'packages/shared/src/lostFoundFields.ts',
    'service.ts': 'deploy/nuni-api/lost-found/service.ts',
    'routes.ts': 'deploy/nuni-api/lost-found/routes.ts',
  };
  for (const [target, source] of Object.entries(sources)) cpSync(join(root, source), join(directory, 'src/lost-found', target));
  cpSync(join(root, 'scripts/platform-lost-found/domain-error.fixture.ts'), join(directory, 'src/domain-error.ts'));
  const fastifyDeps = process.env.LOST_FOUND_TEST_FASTIFY_DEPS || process.env.LOST_FOUND_TEST_DEPS || join(root, 'node_modules');
  if (!existsSync(join(fastifyDeps, 'fastify/package.json'))) throw new Error('Install the isolated Fastify test dependency and set LOST_FOUND_TEST_FASTIFY_DEPS');
  mkdirSync(join(directory, 'node_modules'));
  symlinkSync(join(fastifyDeps, 'fastify'), join(directory, 'node_modules/fastify'), 'dir');
  const compiler = process.env.LOST_FOUND_TEST_TSC || join(root, 'node_modules/.bin/tsc');
  const typeRoots = process.env.LOST_FOUND_TEST_TYPE_ROOTS || join(root, 'node_modules/@types');
  const compile = spawnSync(compiler, [join(directory, 'src/lost-found/service.ts'), join(directory, 'src/lost-found/routes.ts'), '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--target', 'ES2022',
    '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--types', 'node', '--typeRoots', typeRoots,
    '--outDir', join(directory, 'out')], { cwd: root, stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('Lost-found contracts/service TypeScript compilation failed');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap',
    'packages/shared/tests/nuniLostFound.test.cjs', 'scripts/platform-lost-found/database.test.cjs'],
  { cwd: root, stdio: 'inherit', env: { ...process.env,
    LOST_FOUND_COMPILED: join(directory, 'out/lost-found'), LOST_FOUND_TEST_FASTIFY_DEPS: fastifyDeps,
    LOST_FOUND_TEST_DRIVER: embedded ? 'pglite' : 'postgres' } });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
process.exitCode = status;
