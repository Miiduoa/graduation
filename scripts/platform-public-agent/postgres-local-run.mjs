#!/usr/bin/env node
/** Creates and destroys its own isolated local PostgreSQL cluster. Never accepts a DB URL. */
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pg = '/opt/homebrew/opt/postgresql@17/bin';
// Explicit opt-in to a locally installed Fastify package; never a DB connection URL.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--fastify-root' || !isAbsolute(args[1])))
  throw new Error('Usage: postgres-local-run.mjs [--fastify-root /absolute/package/root]');
const fastifyRoot = args.length ? realpathSync(args[1]) : undefined;
const folder = mkdtempSync('/tmp/c1pg-');
const data = join(folder, 'data'),
  socket = join(folder, 'socket'),
  compiled = join(folder, 'compiled');
let startAttempted = false;
const env = { PATH: `${pg}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C', TMPDIR: folder };
function run(binary, args, opts = {}) {
  const result = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
try {
  chmodSync(folder, 0o700);
  mkdirSync(socket, { mode: 0o700 });
  mkdirSync(compiled, { mode: 0o700 });
  run(join(pg, 'initdb'), [
    '-D',
    data,
    '-U',
    'campus_synthetic',
    '-A',
    'trust',
    '--no-instructions',
  ]);
  // No TCP listener. The random 0700 socket directory belongs only to this test process.
  startAttempted = true;
  run(join(pg, 'pg_ctl'), [
    '-D',
    data,
    '-l',
    join(folder, 'server.log'),
    '-w',
    '-t',
    '20',
    '-o',
    `-c listen_addresses='' -c unix_socket_directories=${socket} -c unix_socket_permissions=0700 -p 55432`,
    'start',
  ]);
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  const source = join(root, 'deploy/nuni-api/platform-public-agent');
  run(process.execPath, [
    compiler,
    ...readdirSync(source)
      .filter((n) => n.endsWith('.ts'))
      .map((n) => join(source, n)),
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
    compiled,
  ]);
  writeFileSync(join(folder, 'owner'), `${process.pid}\n`, { mode: 0o600 });
  const tests = spawnSync(
    process.execPath,
    [join(root, 'scripts/platform-public-agent/postgres-local.test.mjs')],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...env,
        CAMPUS_AGENT_PG_FOLDER: realpathSync(folder),
        CAMPUS_AGENT_PG_PARENT: String(process.pid),
        CAMPUS_AGENT_PG_COMPILED: compiled,
        ...(fastifyRoot ? { CAMPUS_AGENT_FASTIFY_ROOT: fastifyRoot } : {}),
      },
    },
  );
  if (tests.error) throw tests.error;
  if (tests.status !== 0) process.exitCode = tests.status ?? 1;
} catch (error) {
  process.stderr.write(`Isolated PostgreSQL test runner: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (startAttempted) {
    const status = spawnSync(join(pg, 'pg_ctl'), ['-D', data, 'status'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    if (status.error || (status.status !== 0 && status.status !== 3)) {
      process.stderr.write(
        `Cannot establish owned cluster status; preserved ${folder} for inspection.\n`,
      );
      process.exit(1);
    }
    if (status.status === 0) {
      try {
        run(join(pg, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'fast', 'stop']);
      } catch (error) {
        process.stderr.write(
          `Unable to stop owned temporary cluster; preserved ${folder}: ${error.message}\n`,
        );
        process.exit(1);
      }
    }
  }
  rmSync(folder, { recursive: true, force: true });
}
